import { MSG } from "@taskflow/shared";
import type {
    DataDirInfo,
    SettingsUpdatePayload,
    SettingsUpdatedEvent,
    WsEvent,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { SettingsStore } from "../services/settings-store";
import type { DataDirGate } from "../services/data-dir-gate";
import {
    hasExistingData,
    migrateDataDir,
    validateTargetDir,
    writeDataLocation,
    clearDataLocation,
} from "../services/data-dir-migrator";

/** Long enough for a title or worktree set up in the background to finish. */
const DRAIN_TIMEOUT_MS = 15_000;

interface SettingsHandlerDeps {
    router: Router;
    settingsStore: SettingsStore;
    broadcast: (event: WsEvent) => void;
    dataDir: {
        baseDir: string;
        /** The folder this backend's stores opened at startup. */
        current: string;
        gate: DataDirGate;
        /** Whether the desktop app will restart this backend after it exits. */
        restartable: boolean;
        /** Why the folder cannot change now (running sessions, flow runs), or null. */
        findBusyReason: () => Promise<string | null>;
        /** Exits so the desktop app restarts the backend on the new folder. */
        requestRestart: () => void;
        drainTimeoutMs?: number;
    };
}

export function registerSettingsHandlers(deps: SettingsHandlerDeps): void {
    const { router, settingsStore, broadcast, dataDir } = deps;
    const { baseDir, gate } = dataDir;
    const info = (path: string): DataDirInfo => ({
        dataDir: path,
        baseDir,
        isDefault: path === baseDir,
    });

    // Every write, HTTP included: other clients bake their cached defaults
    // into launch options, so they must not keep a stale copy.
    settingsStore.onUpdated((settings) => {
        const payload: SettingsUpdatedEvent = { settings };
        broadcast({ type: MSG.SETTINGS_UPDATED, payload });
    });

    router.register(MSG.SETTINGS_GET, async () => {
        return settingsStore.get();
    });

    router.register(MSG.SETTINGS_UPDATE, async (payload) => {
        const update = payload as SettingsUpdatePayload;
        return settingsStore.update(update);
    });

    router.register(MSG.SETTINGS_GET_DATA_DIR, async () => info(dataDir.current));

    router.register(MSG.SETTINGS_UPDATE_DATA_DIR, async (payload): Promise<DataDirInfo> => {
        const { path: newPath, mode } = payload as {
            path: string;
            mode?: "overwrite" | "adopt";
        };

        if (!newPath || typeof newPath !== "string") {
            throw new Error("Invalid path");
        }
        if (newPath === dataDir.current) return info(dataDir.current);

        // The stores keep the paths they opened with, so only a restart puts
        // all of them on the new folder. Without the desktop app to restart
        // this backend, the move would leave it serving a folder that is gone.
        if (!dataDir.restartable) {
            throw new Error(
                "This backend was not started by the Taskflow app, so it cannot restart onto a new data folder.",
            );
        }

        const validationError = await validateTargetDir(newPath);
        if (validationError) {
            throw new Error(validationError);
        }

        // Existing data at the target: ask whether to overwrite or adopt it.
        if (!mode && (await hasExistingData(newPath))) {
            return { ...info(dataDir.current), conflict: true };
        }

        // Checked again once the gate has drained; this one fails fast
        // without refusing everyone else's requests in the meantime.
        const earlyBusyReason = await dataDir.findBusyReason();
        if (earlyBusyReason) {
            throw new Error(`Cannot change the data folder while ${earlyBusyReason}.`);
        }
        if (!(await gate.close(dataDir.drainTimeoutMs ?? DRAIN_TIMEOUT_MS))) {
            throw new Error("Taskflow is still finishing other work. Try again in a moment.");
        }
        // Writing the pointer is the commit point. Before it, a failure keeps
        // the old folder and reopens the gate; after it, the gate stays closed
        // until the restart.
        let committed = false;
        try {
            const busyReason = await dataDir.findBusyReason();
            if (busyReason) {
                throw new Error(`Cannot change the data folder while ${busyReason}.`);
            }
            const commit = async () => {
                if (newPath === baseDir) await clearDataLocation(baseDir);
                else await writeDataLocation(baseDir, newPath);
                committed = true;
            };
            // "adopt" points at the data already there and moves nothing.
            if (mode === "adopt") {
                await commit();
            } else {
                const leftovers = await migrateDataDir(dataDir.current, newPath, commit);
                for (const path of leftovers) {
                    console.error(`Data folder moved, but could not remove ${path}`);
                }
            }
        } catch (error) {
            if (!committed) {
                gate.open();
                throw error;
            }
            console.error("Data folder changed, but cleaning up failed:", error);
        }

        dataDir.requestRestart();
        return { ...info(newPath), restarting: true };
    });
}
