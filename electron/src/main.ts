import { app, BrowserWindow, dialog, nativeTheme, Notification, powerMonitor } from "electron";
import { homedir, userInfo } from "os";
import { join } from "path";

import { createRegistry, createTunnelManager } from "@taskflow/shared/remote";

import {
    startBackend,
    cleanupBackendArtifacts,
    getBackendPort,
    setBackendPort,
    setBackendToken,
    getBackendToken,
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
    saveWindowState,
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
    setShowArchiveChecked,
    setShowArchivedProjectsChecked,
    setCompactSidebarChecked,
    setFileExplorerChecked,
    setTaskInfoChecked,
    setWordWrapChecked,
} from "./app-menu";
import { initAutoUpdater, clearUpdaterCache, setupAutoUpdater } from "./auto-updater";
import { installRemoteWakeup } from "./remote-wakeup";
import {
    createNotificationPoller,
    fetchBackendNotifications,
    type NotificationClickPayload,
} from "./notification-poller";
import { registerIpcHandlers } from "./ipc-handlers";
import { createBackendFetch } from "./backend-fetch";
import { listAttachedBackends } from "./attached-backends";
import * as browserHost from "./browser-host";

declare const BUILD_GIT_BRANCH: string;

let disposeRemoteWakeup: (() => void) | undefined;
let quitting = false;
let confirmBeforeExit = false;
let exitConfirmed = false;
let devBranch: string | null = null;
/** A notification click that reopened the window; its renderer takes it once subscribed. */
let pendingNotificationClick: NotificationClickPayload | null = null;

nativeTheme.themeSource = "dark";
app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
app.commandLine.appendSwitch("remote-debugging-port", "0");
app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled");

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

const backendFetch = createBackendFetch({
    tokenFor: (origin) =>
        getAttachedBackends().find((entry) => new URL(entry.origin).origin === origin)?.token ??
        null,
});

initWindowManager({
    backendFetch,
    getBackendPort,
    getUIDevServerURL,
    getUIPath,
    onWindowClosed: () => {
        pendingNotificationClick = null;
        resetRendererTraySync();
        trayOnWindowClosed();
        // The browser host's park window keeps "window-all-closed" from firing; with no
        // windows left it fires by itself.
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0 && windows.every(browserHost.isParkWindow)) {
            onAllAppWindowsClosed();
        }
    },
});

initTrayManager({
    backendFetch,
    getMainWindow,
    getAttachedBackends,
    showMainWindow,
    getDevBranch: () => devBranch,
    quit: () => app.quit(),
});

const updateController = initAutoUpdater({
    getMainWindow,
    buildAppMenu,
    setExitConfirmed: (value) => {
        exitConfirmed = value;
    },
});

initAppMenu({ getMainWindow, updateController });

// Created here so the IPC handlers can hold it; nothing is read or bound until
// `init()` runs in `whenReady`. `userData` is final by now (dev mode sets it above).
const tunnels = createTunnelManager();
const registry = createRegistry({
    file: join(app.getPath("userData"), "backends.json"),
    defaultUser: userInfo().username,
    openTunnel: tunnels.openTunnel,
    closeTunnel: tunnels.closeTunnel,
    rekeyTunnel: tunnels.rekeyTunnel,
    readRemotePort: tunnels.readRemotePort,
    readRemoteToken: tunnels.readRemoteToken,
    fetchHostKeyFingerprint: tunnels.fetchHostKeyFingerprint,
    trustHostKey: tunnels.trustHostKey,
    forgetScannedHostKey: tunnels.forgetScannedHostKey,
});

function getAttachedBackends() {
    return listAttachedBackends(getBackendPort(), getBackendToken(), registry.attached());
}

const notificationPoller = createNotificationPoller({
    getAttachedBackends,
    fetchNotifications: (origin) => fetchBackendNotifications(backendFetch, origin),
    notify: (notification, backendId) => {
        const desktopNotification = new Notification({
            title: "Taskflow",
            body: notification.message,
        });
        desktopNotification.on("click", () => {
            // Project, task and session ids do not say which machine to navigate on.
            const id = backendId();
            void openNotification(
                id === null
                    ? null
                    : {
                          id: notification.id,
                          backendId: id,
                          projectId: notification.projectId,
                          sessionId: notification.sessionId,
                          taskId: notification.taskId,
                      },
            );
        });
        desktopNotification.show();
    },
});

/** Brings the window back (macOS keeps running without one) and opens the notification. */
async function openNotification(payload: NotificationClickPayload | null): Promise<void> {
    const hadWindow = getMainWindow() !== null;
    await showMainWindow();
    const mainWindow = getMainWindow();
    if (!payload || !mainWindow) return;
    // A window opened just now has no renderer listening yet.
    if (hadWindow) mainWindow.webContents.send("notification-clicked", payload);
    else pendingNotificationClick = payload;
}

registerIpcHandlers({
    backendFetch,
    getBackendToken,
    getMainWindow,
    getBackendPort,
    registry,
    tunnels,
    setRendererTrayState,
    updateTrayIcon,
    setShowArchiveChecked,
    setShowArchivedProjectsChecked,
    setCompactSidebarChecked,
    setFileExplorerChecked,
    setTaskInfoChecked,
    setWordWrapChecked,
    setConfirmBeforeExit: (value) => {
        confirmBeforeExit = value;
    },
    updateController,
    takePendingNotificationClick: () => {
        const payload = pendingNotificationClick;
        pendingNotificationClick = null;
        return payload;
    },
});

// --- App lifecycle ---

void app.whenReady().then(async () => {
    disposeRemoteWakeup = installRemoteWakeup({
        source: powerMonitor,
        notify: () => getMainWindow()?.webContents.send("remote-resume"),
    });
    try {
        const { port, token } = await startBackend(devBranch);
        setBackendPort(port);
        setBackendToken(token);
        await browserHost.initBrowserHost({ getBackendPort, getMainWindow, backendFetch });
        console.log(`Backend started on port ${port}`);
        // Main does not redial persisted records: the renderer does, through
        // `attachedRecordIds()`, because only it can finish the handshake.
        await registry.init();
        startTrayStatePolling();
        notificationPoller.start();
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

function onAllAppWindowsClosed(): void {
    if (process.platform !== "darwin") {
        app.quit();
        return;
    }

    hideDockIcon();
}

app.on("window-all-closed", onAllAppWindowsClosed);

app.on("activate", () => {
    // During startup `whenReady` opens the window once the backend is up.
    if (getBackendPort() === null) return;
    void showMainWindow();
});

app.on("before-quit", (e) => {
    if (quitting) return;
    if (confirmBeforeExit && !exitConfirmed) {
        const mainWindow = getMainWindow();
        const result = mainWindow
            ? dialog.showMessageBoxSync(mainWindow, {
                  type: "question",
                  buttons: ["Quit", "Cancel"],
                  defaultId: 0,
                  cancelId: 1,
                  title: "Quit Taskflow?",
                  message: "Are you sure you want to quit Taskflow?",
              })
            : dialog.showMessageBoxSync({
                  type: "question",
                  buttons: ["Quit", "Cancel"],
                  defaultId: 0,
                  cancelId: 1,
                  title: "Quit Taskflow?",
                  message: "Are you sure you want to quit Taskflow?",
              });
        if (result === 1) {
            e.preventDefault();
            return;
        }
        exitConfirmed = true;
    }
    disposeRemoteWakeup?.();
    disposeRemoteWakeup = undefined;
    stopTrayStatePolling();
    notificationPoller.stop();
    // Windows close after `before-quit`, so their own save would reach a stopped backend.
    const savePromise = saveWindowState() ?? getWindowSavePromise();
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
                registry.stop();
                tunnels.closeAllTunnels();
                killBackendProcess();
                void cleanupBackendArtifacts();
                app.quit();
            });
        return;
    }
    registry.stop();
    tunnels.closeAllTunnels();
    killBackendProcess();
    void cleanupBackendArtifacts();
});
