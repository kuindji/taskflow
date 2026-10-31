import { MSG } from "@taskflow/shared";
import type { SettingsUpdatePayload, SettingsUpdatedEvent, WsEvent } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { SettingsStore } from "../services/settings-store";
import type { TaskStore } from "../services/task-store";
import { config, updateConfigDataDir, isDefaultDataDir } from "../config";
import { ensureDirectories } from "../config";
import {
    hasExistingData,
    migrateDataDir,
    validateTargetDir,
    writeDataLocation,
    clearDataLocation,
} from "../services/data-dir-migrator";

interface SettingsHandlerDeps {
    router: Router;
    settingsStore: SettingsStore;
    taskStore: TaskStore;
    broadcast: (event: WsEvent) => void;
}

interface DataDirResponse {
    dataDir: string;
    baseDir: string;
    isDefault: boolean;
    conflict?: boolean;
}

export function registerSettingsHandlers(deps: SettingsHandlerDeps): void {
    const { router, settingsStore, taskStore, broadcast } = deps;

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

    router.register(MSG.SETTINGS_GET_DATA_DIR, async () => {
        return {
            dataDir: config.dataDir,
            baseDir: config.baseDir,
            isDefault: isDefaultDataDir(),
        };
    });

    router.register(MSG.SETTINGS_UPDATE_DATA_DIR, async (payload) => {
        const { path: newPath, mode } = payload as {
            path: string;
            mode?: "overwrite" | "adopt";
        };

        if (!newPath || typeof newPath !== "string") {
            throw new Error("Invalid path");
        }

        // If setting to the same directory, no-op
        if (newPath === config.dataDir) {
            return {
                dataDir: config.dataDir,
                baseDir: config.baseDir,
                isDefault: isDefaultDataDir(),
            } satisfies DataDirResponse;
        }

        // Validate target
        const validationError = await validateTargetDir(newPath);
        if (validationError) {
            throw new Error(validationError);
        }

        // Check for existing data at target — if no mode specified, signal conflict
        const targetHasData = await hasExistingData(newPath);
        if (targetHasData && !mode) {
            return {
                dataDir: config.dataDir,
                baseDir: config.baseDir,
                isDefault: isDefaultDataDir(),
                conflict: true,
            } satisfies DataDirResponse;
        }

        const currentDataDir = config.dataDir;

        // "adopt" = just point to existing data, don't move anything
        // "overwrite" = move current data over, replacing what's there
        if (mode !== "adopt") {
            await migrateDataDir(currentDataDir, newPath);
        }

        // Determine if new path is the default base dir
        const isReturningToDefault = newPath === config.baseDir;

        if (isReturningToDefault) {
            await clearDataLocation(config.baseDir);
        } else {
            await writeDataLocation(config.baseDir, newPath);
        }

        // Update in-memory config
        updateConfigDataDir(newPath);

        // Ensure all directories exist in the new location
        await ensureDirectories();

        // Re-initialize task store with new paths
        await taskStore.updateConfig({
            projectsFile: config.projectsFile,
            tasksDir: config.tasksDir,
            archiveDir: config.archiveDir,
            sessionLogsDir: config.sessionLogsDir,
            taskLogsDir: config.taskLogsDir,
            masterSessionsFile: config.masterSessionsFile,
        });

        return {
            dataDir: config.dataDir,
            baseDir: config.baseDir,
            isDefault: isDefaultDataDir(),
        } satisfies DataDirResponse;
    });
}
