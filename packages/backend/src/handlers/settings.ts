import { MSG } from "@taskflow/shared";
import type { SettingsUpdatePayload } from "@taskflow/shared";
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
}

interface DataDirResponse {
    dataDir: string;
    isDefault: boolean;
    conflict?: boolean;
}

export function registerSettingsHandlers(deps: SettingsHandlerDeps): void {
    const { router, settingsStore, taskStore } = deps;

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
        });

        return {
            dataDir: config.dataDir,
            isDefault: isDefaultDataDir(),
        } satisfies DataDirResponse;
    });
}
