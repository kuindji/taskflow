import { BrowserWindow, Menu } from "electron";
import { autoUpdater } from "electron-updater";

interface AppMenuDeps {
    getMainWindow: () => BrowserWindow | null;
}

let manualCheckInProgress = false;
let downloadedVersion: string | null = null;
let downloadingVersion: string | null = null;
let showArchiveChecked = false;
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

function buildAppMenu(): void {
    const mainWindow = deps.getMainWindow();

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
                        mainWindow?.webContents.send("open-settings");
                    },
                },
                {
                    label: "Appearance",
                    click: () => {
                        mainWindow?.webContents.send("open-appearance");
                    },
                },
                {
                    label: "Actions and Flows",
                    click: () => {
                        mainWindow?.webContents.send("open-flows");
                    },
                },
                {
                    label: "Schedules",
                    click: () => {
                        mainWindow?.webContents.send("open-schedules");
                    },
                },
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
                        mainWindow?.webContents.send("toggle-word-wrap");
                    },
                },
            ],
        },
        {
            label: "View",
            submenu: [
                {
                    id: "toggle-archive",
                    label: "Show Archived Tasks",
                    type: "checkbox",
                    checked: showArchiveChecked,
                    click: () => {
                        mainWindow?.webContents.send("toggle-archive");
                    },
                },
                {
                    id: "compact-sidebar",
                    label: "Compact Sidebar",
                    type: "checkbox",
                    checked: compactSidebarChecked,
                    accelerator: "CmdOrCtrl+Shift+C",
                    click: () => {
                        mainWindow?.webContents.send("toggle-compact-sidebar");
                    },
                },
                {
                    id: "show-file-explorer",
                    label: "Show File Explorer",
                    type: "checkbox",
                    checked: fileExplorerChecked,
                    accelerator: "CmdOrCtrl+E",
                    click: () => {
                        mainWindow?.webContents.send("toggle-file-explorer");
                    },
                },
                {
                    id: "show-task-info",
                    label: "Show Task Info",
                    type: "checkbox",
                    checked: taskInfoChecked,
                    accelerator: "CmdOrCtrl+I",
                    click: () => {
                        mainWindow?.webContents.send("toggle-task-info");
                    },
                },
                {
                    id: "toggle-markdown-input",
                    label: "Markdown Input",
                    accelerator: "CmdOrCtrl+Shift+E",
                    click: () => {
                        mainWindow?.webContents.send("toggle-markdown-input");
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
                        mainWindow?.webContents.send("new-task");
                    },
                },
                {
                    label: "New Terminal",
                    accelerator: "CmdOrCtrl+T",
                    click: () => {
                        mainWindow?.webContents.send("new-terminal");
                    },
                },
                {
                    label: "New Agent",
                    accelerator: "CmdOrCtrl+J",
                    click: () => {
                        mainWindow?.webContents.send("new-agent");
                    },
                },
                { type: "separator" },
                {
                    label: "Close Tab",
                    accelerator: "CmdOrCtrl+W",
                    click: () => {
                        mainWindow?.webContents.send("close-tab");
                    },
                },
                {
                    label: "Focus Panel Left",
                    accelerator: "CmdOrCtrl+Shift+Left",
                    click: () => {
                        mainWindow?.webContents.send("focus-panel-left");
                    },
                },
                {
                    label: "Focus Panel Right",
                    accelerator: "CmdOrCtrl+Shift+Right",
                    click: () => {
                        mainWindow?.webContents.send("focus-panel-right");
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
                        mainWindow?.webContents.send("open-keyboard-shortcuts");
                    },
                },
                {
                    label: "What Agents Can Do",
                    click: () => {
                        mainWindow?.webContents.send("open-agent-operations-help");
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
    setCompactSidebarChecked,
    setFileExplorerChecked,
    setTaskInfoChecked,
    setWordWrapChecked,
};
