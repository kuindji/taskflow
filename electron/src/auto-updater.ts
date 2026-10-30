import { app, BrowserWindow, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { rm } from "fs/promises";
import { join } from "path";
import { createUpdateController, type UpdateController } from "./update-controller";

interface AutoUpdaterDeps {
    getMainWindow: () => BrowserWindow | null;
    buildAppMenu: () => void;
    setExitConfirmed: (value: boolean) => void;
}

let controller: UpdateController;
let listenersRegistered = false;

function initAutoUpdater(deps: AutoUpdaterDeps): UpdateController {
    controller = createUpdateController({
        checkForUpdates: () => autoUpdater.checkForUpdates(),
        downloadUpdate: () => autoUpdater.downloadUpdate(),
        quitAndInstall: () => autoUpdater.quitAndInstall(),
        publish: (state) => {
            deps.getMainWindow()?.webContents.send("update-status", state);
            deps.buildAppMenu();
        },
        setExitConfirmed: deps.setExitConfirmed,
        now: () => new Date().toISOString(),
        showNoUpdate: () => {
            void dialog.showMessageBox({
                type: "info",
                title: "No Updates",
                message: "You're up to date!",
                detail: `Taskflow ${app.getVersion()} is the latest version.`,
            });
        },
        showCheckFailure: (message) => {
            void dialog.showMessageBox({
                type: "error",
                title: "Update Check Failed",
                message: "Could not check for updates.",
                detail: message,
            });
        },
    });
    return controller;
}

async function clearUpdaterCache(): Promise<void> {
    try {
        const cachePath = join(app.getPath("userData"), "..", "Caches", `${app.getName()}-updater`);
        await rm(cachePath, { recursive: true, force: true });
        console.log("[updater] Cleared update cache");
    } catch (err) {
        console.warn("[updater] Failed to clear update cache:", err);
    }
}

function setupAutoUpdater(): void {
    if (!app.isPackaged || listenersRegistered) return;
    listenersRegistered = true;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("update-available", (info) => {
        console.log(`[updater] Update available: v${info.version}`);
        controller.receive({
            type: "update-available",
            version: info.version,
            checkedAt: new Date().toISOString(),
        });
    });
    autoUpdater.on("update-not-available", () => {
        controller.receive({ type: "no-update", checkedAt: new Date().toISOString() });
    });
    autoUpdater.on("download-progress", (progress) => {
        controller.receive({ type: "download-progress", percent: progress.percent });
    });
    autoUpdater.on("update-downloaded", (info) => {
        console.log(`[updater] Update downloaded: v${info.version}`);
        controller.receive({ type: "download-completed", version: info.version });
    });
    autoUpdater.on("error", (err) => {
        console.error("[updater] Error:", err.message, err.stack);
        controller.receiveError(err.message);
    });

    void controller.check(false);
}

export { initAutoUpdater, clearUpdaterCache, setupAutoUpdater };
