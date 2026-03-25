import { app, BrowserWindow, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { rm } from "fs/promises";
import { join } from "path";

interface AutoUpdaterDeps {
    getMainWindow: () => BrowserWindow | null;
    buildAppMenu: () => void;
    getManualCheckInProgress: () => boolean;
    setManualCheckInProgress: (value: boolean) => void;
    setDownloadedVersion: (value: string | null) => void;
    setDownloadingVersion: (value: string | null) => void;
}

let deps: AutoUpdaterDeps;

function initAutoUpdater(d: AutoUpdaterDeps): void {
    deps = d;
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
    if (!app.isPackaged) return;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => {
        deps.getMainWindow()?.webContents.send("update-status", { status: "checking" });
    });

    autoUpdater.on("update-available", (info) => {
        console.log(`[updater] Update available: v${info.version}`);
        deps.setDownloadingVersion(info.version);
        deps.buildAppMenu();
        deps.getMainWindow()?.webContents.send("update-status", {
            status: "downloading",
            version: info.version,
        });
        autoUpdater.downloadUpdate().catch((err: unknown) => {
            console.error("[updater] Download failed:", err);
        });
    });

    autoUpdater.on("update-not-available", () => {
        deps.getMainWindow()?.webContents.send("update-status", { status: "idle" });
        if (deps.getManualCheckInProgress()) {
            deps.setManualCheckInProgress(false);
            void dialog.showMessageBox({
                type: "info",
                title: "No Updates",
                message: "You're up to date!",
                detail: `Taskflow ${app.getVersion()} is the latest version.`,
            });
        }
        deps.setDownloadingVersion(null);
        deps.buildAppMenu();
    });

    autoUpdater.on("update-downloaded", (info) => {
        console.log(`[updater] Update downloaded: v${info.version}`);
        deps.setManualCheckInProgress(false);
        deps.setDownloadedVersion(info.version);
        deps.setDownloadingVersion(null);
        deps.getMainWindow()?.webContents.send("update-status", {
            status: "ready",
            version: info.version,
        });
        deps.buildAppMenu();
    });

    autoUpdater.on("error", (err) => {
        console.error("[updater] Error:", err.message, err.stack);
        deps.setDownloadedVersion(null);
        deps.setDownloadingVersion(null);
        deps.getMainWindow()?.webContents.send("update-status", { status: "idle" });
        if (deps.getManualCheckInProgress()) {
            deps.setManualCheckInProgress(false);
            void dialog.showMessageBox({
                type: "error",
                title: "Update Check Failed",
                message: "Could not check for updates.",
                detail: err.message,
            });
        }
        deps.buildAppMenu();
    });

    // Silent check on startup
    autoUpdater.checkForUpdates().catch((err: unknown) => {
        console.error("[updater] Startup check failed:", err);
    });
}

export { initAutoUpdater, clearUpdaterCache, setupAutoUpdater };
