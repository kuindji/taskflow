import { app, dialog, nativeTheme } from "electron";
import { homedir } from "os";
import { join } from "path";

import {
    startBackend,
    cleanupBackendArtifacts,
    getBackendPort,
    setBackendPort,
    getBackendStderrBuffer,
    killBackendProcess,
    getUIDevServerURL,
    getUIPath,
} from "./backend-manager";
import {
    initWindowManager,
    createWindow,
    showMainWindow,
    hideDockIcon,
    getMainWindow,
    getWindowSavePromise,
    clearWindowSavePromise,
} from "./window-manager";
import {
    initTrayManager,
    setupMenuBarTray,
    startTrayStatePolling,
    stopTrayStatePolling,
    setRendererTrayState,
    onWindowClosed as trayOnWindowClosed,
    resetRendererTraySync,
    updateTrayIcon,
} from "./tray-manager";
import {
    initAppMenu,
    buildAppMenu,
    getManualCheckInProgress,
    setManualCheckInProgress,
    setDownloadedVersion,
    setDownloadingVersion,
    setShowArchiveChecked,
    setCompactSidebarChecked,
    setFileExplorerChecked,
    setTaskInfoChecked,
    setWordWrapChecked,
} from "./app-menu";
import { initAutoUpdater, clearUpdaterCache, setupAutoUpdater } from "./auto-updater";
import {
    initNotificationPoller,
    startNotificationPolling,
    stopNotificationPolling,
} from "./notification-poller";
import { registerIpcHandlers } from "./ipc-handlers";

declare const BUILD_GIT_BRANCH: string;

let quitting = false;
let devBranch: string | null = null;

nativeTheme.themeSource = "dark";

// --- Dev mode setup ---

if (process.env.TASKFLOW_DEV) {
    devBranch = BUILD_GIT_BRANCH;
    app.setName(`Taskflow Dev (${devBranch})`);
    app.setPath("userData", join(homedir(), ".config", `taskflow-dev-${devBranch}`));
}

// --- Single instance lock ---

if (devBranch) {
    // Dev mode: skip single-instance lock to allow multiple dev instances
    // from different branches. Each dev instance already has isolated userData.
} else {
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
        app.quit();
    } else {
        app.on("second-instance", () => {
            void showMainWindow();
        });
    }
}

// --- Initialize modules ---

initWindowManager({
    getBackendPort,
    getUIDevServerURL,
    getUIPath,
    onWindowClosed: () => {
        resetRendererTraySync();
        trayOnWindowClosed();
    },
});

initTrayManager({
    getMainWindow,
    getBackendPort,
    showMainWindow,
    getDevBranch: () => devBranch,
    quit: () => app.quit(),
});

initAppMenu({
    getMainWindow,
});

initAutoUpdater({
    getMainWindow,
    buildAppMenu,
    getManualCheckInProgress,
    setManualCheckInProgress,
    setDownloadedVersion,
    setDownloadingVersion,
});

initNotificationPoller({
    getMainWindow,
    getBackendPort,
});

registerIpcHandlers({
    getMainWindow,
    getBackendPort,
    setRendererTrayState,
    updateTrayIcon,
    setShowArchiveChecked,
    setCompactSidebarChecked,
    setFileExplorerChecked,
    setTaskInfoChecked,
    setWordWrapChecked,
});

// --- App lifecycle ---

void app.whenReady().then(async () => {
    try {
        const port = await startBackend(devBranch);
        setBackendPort(port);
        console.log(`Backend started on port ${port}`);
        startTrayStatePolling();
        startNotificationPolling();
        await createWindow();
        buildAppMenu();
        setupMenuBarTray();
        await clearUpdaterCache();
        setupAutoUpdater();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stderr = getBackendStderrBuffer().trim();
        const detail = stderr ? `${message}\n\nBackend output:\n${stderr}` : message;
        console.error("Failed to start backend:", err);
        dialog.showErrorBox("Taskflow failed to start", detail);
        app.quit();
    }
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
        return;
    }

    hideDockIcon();
});

app.on("activate", () => {
    void showMainWindow();
});

app.on("before-quit", (e) => {
    if (quitting) return;
    stopTrayStatePolling();
    stopNotificationPolling();
    const savePromise = getWindowSavePromise();
    if (savePromise) {
        quitting = true;
        e.preventDefault();
        void savePromise
            .then(() => {
                clearWindowSavePromise();
            })
            .catch(() => {
                clearWindowSavePromise();
            })
            .finally(() => {
                killBackendProcess();
                void cleanupBackendArtifacts();
                app.quit();
            });
        return;
    }
    killBackendProcess();
    void cleanupBackendArtifacts();
});
