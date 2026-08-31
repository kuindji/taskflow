import { BrowserWindow, Menu } from "electron";
import { autoUpdater } from "electron-updater";

interface AppMenuDeps {
    getMainWindow: () => BrowserWindow | null;
    markExitConfirmed: () => void;
}

let manualCheckInProgress = false;
let downloadedVersion: string | null = null;
let downloadingVersion: string | null = null;
let showArchiveChecked = false;
let showArchivedProjectsChecked = false;
let compactSidebarChecked = false;
let fileExplorerChecked = false;
let taskInfoChecked = false;
let wordWrapChecked = true;
let deps: AppMenuDeps;

function initAppMenu(d: AppMenuDeps): void {
    deps = d;
}

function getManualCheckInProgress(): boolean {
    return manualCheckInProgress;
}

function setManualCheckInProgress(value: boolean): void {
    manualCheckInProgress = value;
}

function getDownloadedVersion(): string | null {
    return downloadedVersion;
}

function setDownloadedVersion(value: string | null): void {
    downloadedVersion = value;
}

function getDownloadingVersion(): string | null {
    return downloadingVersion;
}

function setDownloadingVersion(value: string | null): void {
    downloadingVersion = value;
}

function setShowArchiveChecked(value: boolean): void {
    showArchiveChecked = value;
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById("toggle-archive");
    if (item) {
        item.checked = value;
    }
}

function setShowArchivedProjectsChecked(value: boolean): void {
    showArchivedProjectsChecked = value;
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById("show-archived-projects");
    if (item) {
        item.checked = value;
    }
}

function setCompactSidebarChecked(value: boolean): void {
    compactSidebarChecked = value;
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById("compact-sidebar");
    if (item) {
        item.checked = value;
    }
}

function setFileExplorerChecked(value: boolean): void {
    fileExplorerChecked = value;
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById("show-file-explorer");
    if (item) {
        item.checked = value;
    }
}

function setTaskInfoChecked(value: boolean): void {
    taskInfoChecked = value;
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById("show-task-info");
    if (item) {
        item.checked = value;
    }
}

function setWordWrapChecked(value: boolean): void {
    wordWrapChecked = value;
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById("toggle-word-wrap");
    if (item) {
        item.checked = value;
    }
}

function sendToMainWindow(channel: string): void {
    const win = deps.getMainWindow();
    if (win && !win.isDestroyed()) {
        win.webContents.send(channel);
    }
}

function buildAppMenu(): void {
    const template: Electron.MenuItemConstructorOptions[] = [
        {
            role: "appMenu",
            submenu: [
                { role: "about" },
                { type: "separator" },
                {
                    label: "Settings",
                    accelerator: "CmdOrCtrl+,",
                    click: () => {
                        sendToMainWindow("open-settings");
                    },
                },
                {
                    label: "Appearance",
                    click: () => {
                        sendToMainWindow("open-appearance");
                    },
                },
                {
                    label: "Actions and Flows",
                    click: () => {
                        sendToMainWindow("open-flows");
                    },
                },
                {
                    label: "Schedules",
                    click: () => {
                        sendToMainWindow("open-schedules");
                    },
                },
                { type: "separator" },
                {
                    id: "check-for-updates",
                    label: downloadedVersion
                        ? `Restart to Update to v${downloadedVersion}`
                        : downloadingVersion
                          ? `Downloading v${downloadingVersion}…`
                          : manualCheckInProgress
                            ? "Checking for Updates…"
                            : "Check for Updates…",
                    enabled: !downloadingVersion && !manualCheckInProgress,
                    click: () => {
                        if (downloadedVersion) {
                            deps.markExitConfirmed();
                            autoUpdater.quitAndInstall();
                            return;
                        }
                        if (manualCheckInProgress) return;
                        manualCheckInProgress = true;
                        buildAppMenu();
                        autoUpdater.checkForUpdates().catch((err: unknown) => {
                            console.error("[updater] Manual check failed:", err);
                        });
                    },
                },
                { type: "separator" },
                { role: "services" },
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                { role: "quit" },
            ],
        },
        {
            role: "editMenu",
            submenu: [
                { role: "undo" },
                { role: "redo" },
                { type: "separator" },
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
                { role: "pasteAndMatchStyle" },
                { role: "delete" },
                { role: "selectAll" },
                { type: "separator" },
                {
                    id: "toggle-word-wrap",
                    label: "Word Wrap",
                    type: "checkbox",
                    checked: wordWrapChecked,
                    accelerator: "Alt+Z",
                    click: () => {
                        sendToMainWindow("toggle-word-wrap");
                    },
                },
            ],
        },
        {
            label: "View",
            submenu: [
                {
                    label: "Command Palette…",
                    accelerator: "CmdOrCtrl+Shift+P",
                    click: () => {
                        sendToMainWindow("open-command-palette");
                    },
                },
                { type: "separator" },
                {
                    id: "toggle-archive",
                    label: "Show Archived Tasks",
                    type: "checkbox",
                    checked: showArchiveChecked,
                    click: () => {
                        sendToMainWindow("toggle-archive");
                    },
                },
                {
                    id: "show-archived-projects",
                    label: "Show Archived Projects",
                    type: "checkbox",
                    checked: showArchivedProjectsChecked,
                    click: () => {
                        sendToMainWindow("toggle-archived-projects");
                    },
                },
                {
                    id: "compact-sidebar",
                    label: "Compact Sidebar",
                    type: "checkbox",
                    checked: compactSidebarChecked,
                    accelerator: "CmdOrCtrl+Shift+C",
                    click: () => {
                        sendToMainWindow("toggle-compact-sidebar");
                    },
                },
                {
                    id: "show-file-explorer",
                    label: "Show File Explorer",
                    type: "checkbox",
                    checked: fileExplorerChecked,
                    accelerator: "CmdOrCtrl+E",
                    click: () => {
                        sendToMainWindow("toggle-file-explorer");
                    },
                },
                {
                    id: "show-task-info",
                    label: "Show Task Info",
                    type: "checkbox",
                    checked: taskInfoChecked,
                    accelerator: "CmdOrCtrl+I",
                    click: () => {
                        sendToMainWindow("toggle-task-info");
                    },
                },
                {
                    id: "toggle-markdown-input",
                    label: "Markdown Input",
                    accelerator: "CmdOrCtrl+Shift+E",
                    click: () => {
                        sendToMainWindow("toggle-markdown-input");
                    },
                },
                { type: "separator" },
                { role: "reload" },
                { role: "forceReload" },
                { role: "toggleDevTools" },
                { type: "separator" },
                { role: "resetZoom" },
                { role: "zoomIn" },
                { role: "zoomOut" },
                { type: "separator" },
                { role: "togglefullscreen" },
            ],
        },
        {
            label: "Window",
            submenu: [
                {
                    label: "New Task",
                    accelerator: "CmdOrCtrl+N",
                    click: () => {
                        sendToMainWindow("new-task");
                    },
                },
                {
                    label: "New Terminal",
                    accelerator: "CmdOrCtrl+T",
                    click: () => {
                        sendToMainWindow("new-terminal");
                    },
                },
                {
                    label: "New Agent",
                    accelerator: "CmdOrCtrl+J",
                    click: () => {
                        sendToMainWindow("new-agent");
                    },
                },
                {
                    label: "Toggle Split",
                    accelerator: "CmdOrCtrl+Shift+S",
                    click: () => {
                        sendToMainWindow("toggle-workspace-split");
                    },
                },
                { type: "separator" },
                {
                    label: "Close Tab",
                    accelerator: "CmdOrCtrl+W",
                    click: () => {
                        sendToMainWindow("close-tab");
                    },
                },
                {
                    label: "Focus Panel Left",
                    accelerator: "CmdOrCtrl+Shift+Left",
                    click: () => {
                        sendToMainWindow("focus-panel-left");
                    },
                },
                {
                    label: "Focus Panel Right",
                    accelerator: "CmdOrCtrl+Shift+Right",
                    click: () => {
                        sendToMainWindow("focus-panel-right");
                    },
                },
                { type: "separator" },
                { role: "minimize" },
                { role: "zoom" },
                { type: "separator" },
                { role: "front" },
            ],
        },
        {
            role: "help",
            submenu: [
                {
                    label: "Keyboard Shortcuts",
                    accelerator: "CmdOrCtrl+/",
                    click: () => {
                        sendToMainWindow("open-keyboard-shortcuts");
                    },
                },
                {
                    label: "What Agents Can Do",
                    click: () => {
                        sendToMainWindow("open-agent-operations-help");
                    },
                },
            ],
        },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export {
    initAppMenu,
    buildAppMenu,
    getManualCheckInProgress,
    setManualCheckInProgress,
    getDownloadedVersion,
    setDownloadedVersion,
    getDownloadingVersion,
    setDownloadingVersion,
    setShowArchiveChecked,
    setShowArchivedProjectsChecked,
    setCompactSidebarChecked,
    setFileExplorerChecked,
    setTaskInfoChecked,
    setWordWrapChecked,
};
