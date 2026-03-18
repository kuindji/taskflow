import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { spawn, execFile, type ChildProcess } from "child_process";

declare const BUILD_GIT_BRANCH: string;
import { constants } from "fs";
import { access, copyFile, readFile, rm, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let backendPort: number | null = null;
let backendPortFile: string | null = null;
let windowSavePromise: Promise<Response | undefined> | null = null;
let quitting = false;
let backendStderrBuffer = "";

const UI_DEV_SERVER_URL = process.env.TASKFLOW_UI_URL;

function getBackendPath(): { binary: string; args: string[] } {
    if (UI_DEV_SERVER_URL) {
        // Dev mode: run source with bun
        const entry = join(__dirname, "..", "..", "packages", "backend", "src", "index.ts");
        return { binary: "bun", args: ["run", entry] };
    }

    if (app.isPackaged) {
        // Packaged mode: use compiled standalone binary from resources
        const binary = join(process.resourcesPath, "backend", "taskflow-backend");
        return { binary, args: [] };
    }

    // Local build mode: run dist with bun
    const entry = join(__dirname, "..", "..", "packages", "backend", "dist", "index.js");
    return { binary: "bun", args: ["run", entry] };
}

function getUIPath(): string {
    if (app.isPackaged) {
        return join(process.resourcesPath, "ui", "index.html");
    }
    return join(__dirname, "..", "..", "packages", "ui", "dist", "index.html");
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBackendPort(portFile: string, timeoutMs: number = 10000): Promise<number> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        try {
            await access(portFile, constants.F_OK);
            const portStr = await readFile(portFile, "utf-8");
            const port = Number.parseInt(portStr.trim(), 10);

            if (Number.isInteger(port) && port > 0) {
                return port;
            }
        } catch {
            // Keep polling until the backend writes a valid port number.
        }

        if (backendProcess && backendProcess.exitCode !== null) {
            throw new Error(`Backend exited before startup (code ${backendProcess.exitCode})`);
        }

        await delay(100);
    }

    throw new Error(`Backend startup timeout after ${timeoutMs}ms`);
}

async function cleanupBackendArtifacts(): Promise<void> {
    if (!backendPortFile) return;

    await rm(backendPortFile, { force: true });
    backendPortFile = null;
}

async function startBackend(): Promise<number> {
    backendPortFile = join(tmpdir(), `taskflow-port-${process.pid}-${Date.now()}`);

    const { binary, args } = getBackendPath();

    const { CLAUDECODE: _cc, CLAUDE_CODE_ENTRYPOINT: _cce, ...safeEnv } = process.env;

    backendProcess = spawn(binary, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
            ...safeEnv,
            TASKFLOW_PORT_FILE: backendPortFile,
            ...(devBranch ? { TASKFLOW_DEV_BRANCH: devBranch } : {}),
        },
    });

    backendProcess.stdout?.on("data", (data: Buffer) => {
        console.log("[backend]", data.toString().trim());
    });

    backendProcess.stderr?.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        console.error("[backend error]", text);
        backendStderrBuffer += text + "\n";
    });

    return Promise.race([
        waitForBackendPort(backendPortFile),
        new Promise<never>((_, reject) => {
            backendProcess?.once("error", reject);
        }),
        new Promise<never>((_, reject) => {
            backendProcess?.once("exit", (code) => {
                reject(new Error(`Backend exited before startup (code ${code ?? "unknown"})`));
            });
        }),
    ]);
}

interface SavedWindowBounds {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized: boolean;
}

async function fetchSavedLayout(): Promise<SavedWindowBounds | null> {
    if (!backendPort) return null;
    try {
        const res = await fetch(`http://127.0.0.1:${backendPort}/api/settings`);
        if (!res.ok) return null;
        const settings = (await res.json()) as { layout?: { window?: SavedWindowBounds } };
        return settings.layout?.window ?? null;
    } catch {
        return null;
    }
}

function validateBounds(
    bounds: SavedWindowBounds,
): { x: number; y: number; width: number; height: number } | null {
    if (bounds.x == null || bounds.y == null) return null;
    const width = Math.max(bounds.width, 800);
    const height = Math.max(bounds.height, 600);
    const rect = { x: bounds.x, y: bounds.y, width, height };
    const display = screen.getDisplayMatching(rect);
    const { x: dx, y: dy, width: dw, height: dh } = display.workArea;

    const overlapX = Math.min(rect.x + rect.width, dx + dw) - Math.max(rect.x, dx);
    const overlapY = Math.min(rect.y + rect.height, dy + dh) - Math.max(rect.y, dy);
    if (overlapX < 100 || overlapY < 100) return null;

    return rect;
}

async function createWindow() {
    const appPath = app.getAppPath();
    const saved = await fetchSavedLayout();
    const validBounds = saved ? validateBounds(saved) : null;

    const windowOptions: Electron.BrowserWindowConstructorOptions = {
        width: validBounds?.width ?? 1400,
        height: validBounds?.height ?? 900,
        ...(validBounds ? { x: validBounds.x, y: validBounds.y } : {}),
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: "hiddenInset",
        backgroundColor: "#00000000",
        vibrancy: "under-window",
        visualEffectState: "active",
        webPreferences: {
            preload: join(appPath, "dist", "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true,
        },
    };

    mainWindow = new BrowserWindow(windowOptions);

    mainWindow.webContents.on("will-attach-webview", (_event, webPreferences) => {
        webPreferences.nodeIntegration = false;
        webPreferences.nodeIntegrationInSubFrames = false;
        delete webPreferences.preload;
    });

    if (saved?.isMaximized) {
        mainWindow.maximize();
    }

    let lastNonMaximizedBounds = mainWindow.getBounds();
    mainWindow.on("focus", () => {
        mainWindow?.webContents.send("window-focus-changed", { focused: true });
    });
    mainWindow.on("blur", () => {
        mainWindow?.webContents.send("window-focus-changed", { focused: false });
    });

    mainWindow.on("moved", () => {
        if (mainWindow && !mainWindow.isMaximized()) {
            lastNonMaximizedBounds = mainWindow.getBounds();
        }
    });
    mainWindow.on("resize", () => {
        if (mainWindow && !mainWindow.isMaximized()) {
            lastNonMaximizedBounds = mainWindow.getBounds();
        }
    });

    mainWindow.on("close", () => {
        if (!mainWindow || !backendPort) return;
        const isMaximized = mainWindow.isMaximized();
        const bounds = isMaximized ? lastNonMaximizedBounds : mainWindow.getBounds();
        windowSavePromise = fetch(`http://127.0.0.1:${backendPort}/api/settings`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                layout: {
                    window: {
                        x: bounds.x,
                        y: bounds.y,
                        width: bounds.width,
                        height: bounds.height,
                        isMaximized,
                    },
                },
            }),
            signal: AbortSignal.timeout(1000),
        }).catch(() => undefined);
    });

    // Prevent Electron from navigating to file:// URLs when files are
    // dragged from Finder onto the window.  Without this the default
    // behaviour replaces the renderer with the dropped file contents and
    // the DOM `drop` event never fires.
    mainWindow.webContents.on("will-navigate", (event, url) => {
        if (url.startsWith("file://")) {
            event.preventDefault();
        }
    });

    if (UI_DEV_SERVER_URL) {
        void mainWindow.loadURL(UI_DEV_SERVER_URL);
    } else {
        void mainWindow.loadFile(getUIPath());
    }

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

let manualCheckInProgress = false;
let downloadedVersion: string | null = null;
let downloadingVersion: string | null = null;
let showArchiveChecked = false;
let compactSidebarChecked = false;
let fileExplorerChecked = false;
let taskInfoChecked = false;
let wordWrapChecked = true;


function buildAppMenu() {
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
                { type: "separator" },
                {
                    label: "Close Tab",
                    accelerator: "CmdOrCtrl+W",
                    click: () => {
                        mainWindow?.webContents.send("close-tab");
                    },
                },
                { type: "separator" },
                { role: "minimize" },
                { role: "zoom" },
                { type: "separator" },
                { role: "front" },
            ],
        },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupAutoUpdater() {
    if (!app.isPackaged) return;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => {
        mainWindow?.webContents.send("update-status", { status: "checking" });
    });

    autoUpdater.on("update-available", (info) => {
        console.log(`[updater] Update available: v${info.version}`);
        downloadingVersion = info.version;
        buildAppMenu();
        mainWindow?.webContents.send("update-status", {
            status: "downloading",
            version: info.version,
        });
        autoUpdater.downloadUpdate().catch((err: unknown) => {
            console.error("[updater] Download failed:", err);
        });
    });

    autoUpdater.on("update-not-available", () => {
        mainWindow?.webContents.send("update-status", { status: "idle" });
        if (manualCheckInProgress) {
            manualCheckInProgress = false;
            void dialog.showMessageBox({
                type: "info",
                title: "No Updates",
                message: "You're up to date!",
                detail: `Taskflow ${app.getVersion()} is the latest version.`,
            });
        }
        downloadingVersion = null;
        buildAppMenu();
    });

    autoUpdater.on("update-downloaded", (info) => {
        console.log(`[updater] Update downloaded: v${info.version}`);
        manualCheckInProgress = false;
        downloadedVersion = info.version;
        downloadingVersion = null;
        mainWindow?.webContents.send("update-status", {
            status: "ready",
            version: info.version,
        });
        buildAppMenu();
    });

    autoUpdater.on("error", (err) => {
        console.error("[updater] Error:", err.message, err.stack);
        downloadedVersion = null;
        downloadingVersion = null;
        mainWindow?.webContents.send("update-status", { status: "idle" });
        if (manualCheckInProgress) {
            manualCheckInProgress = false;
            void dialog.showMessageBox({
                type: "error",
                title: "Update Check Failed",
                message: "Could not check for updates.",
                detail: err.message,
            });
        }
        buildAppMenu();
    });

    // Silent check on startup
    autoUpdater.checkForUpdates().catch((err: unknown) => {
        console.error("[updater] Startup check failed:", err);
    });
}

let devBranch: string | null = null;

if (process.env.TASKFLOW_DEV) {
    devBranch = BUILD_GIT_BRANCH;
    app.setName(`Taskflow Dev (${devBranch})`);
    app.setPath("userData", join(homedir(), ".config", `taskflow-dev-${devBranch}`));
}

if (devBranch) {
    // Dev mode: skip single-instance lock to allow multiple dev instances
    // from different branches. Each dev instance already has isolated userData.
} else {
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
        app.quit();
    } else {
        app.on("second-instance", () => {
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.focus();
            }
        });
    }
}

void app.whenReady().then(async () => {
    try {
        backendPort = await startBackend();
        console.log(`Backend started on port ${backendPort}`);
        await createWindow();
        buildAppMenu();
        setupAutoUpdater();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const detail = backendStderrBuffer.trim()
            ? `${message}\n\nBackend output:\n${backendStderrBuffer.trim()}`
            : message;
        console.error("Failed to start backend:", err);
        dialog.showErrorBox("Taskflow failed to start", detail);
        app.quit();
    }
});

app.on("window-all-closed", () => {
    app.quit();
});

app.on("before-quit", (e) => {
    if (quitting) return;
    if (windowSavePromise) {
        quitting = true;
        e.preventDefault();
        void windowSavePromise
            .then(() => {
                windowSavePromise = null;
            })
            .catch(() => {
                windowSavePromise = null;
            })
            .finally(() => {
                if (backendProcess) {
                    backendProcess.kill();
                    backendProcess = null;
                }
                void cleanupBackendArtifacts();
                app.quit();
            });
        return;
    }
    if (backendProcess) {
        backendProcess.kill();
        backendProcess = null;
    }
    void cleanupBackendArtifacts();
});

ipcMain.on("archive-state-changed", (_event, showArchive: boolean) => {
    showArchiveChecked = showArchive;
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById("toggle-archive");
    if (item) {
        item.checked = showArchive;
    }
});

ipcMain.on("compact-sidebar-changed", (_event, compact: boolean) => {
    compactSidebarChecked = compact;
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById("compact-sidebar");
    if (item) {
        item.checked = compact;
    }
});

ipcMain.on("file-explorer-state-changed", (_event, open: boolean) => {
    fileExplorerChecked = open;
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById("show-file-explorer");
    if (item) {
        item.checked = open;
    }
});

ipcMain.on("task-info-state-changed", (_event, open: boolean) => {
    taskInfoChecked = open;
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById("show-task-info");
    if (item) {
        item.checked = open;
    }
});

ipcMain.on("word-wrap-state-changed", (_event, enabled: boolean) => {
    wordWrapChecked = enabled;
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById("toggle-word-wrap");
    if (item) {
        item.checked = enabled;
    }
});

ipcMain.handle("get-backend-port", () => backendPort);
ipcMain.handle("open-external-url", (_event, url: string) => {
    if (!url.startsWith("https://") && !url.startsWith("http://")) return;
    return shell.openExternal(url);
});
ipcMain.on("show-item-in-folder", (_event, filePath: string) => {
    if (!filePath.startsWith("/") || filePath.includes("..")) return;
    shell.showItemInFolder(filePath);
});
ipcMain.handle(
    "save-artifact",
    async (
        _event,
        opts: { path?: string; text?: string; defaultName?: string },
    ): Promise<{ success: boolean; error?: string }> => {
        const defaultPath = opts.defaultName
            ? join(app.getPath("downloads"), opts.defaultName)
            : undefined;
        const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
        const result = win
            ? await dialog.showSaveDialog(win, { defaultPath })
            : await dialog.showSaveDialog({ defaultPath });
        if (result.canceled || !result.filePath)
            return { success: false };
        try {
            if (typeof opts.path === "string") {
                if (!opts.path.startsWith("/") || opts.path.includes(".."))
                    return { success: false, error: "Invalid source path" };
                await copyFile(opts.path, result.filePath);
            } else if (typeof opts.text === "string") {
                await writeFile(result.filePath, opts.text, "utf-8");
            } else {
                return { success: false, error: "No path or text provided" };
            }
            return { success: true };
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Unknown error";
            await dialog.showMessageBox({
                type: "error",
                title: "Download failed",
                message: `Could not save the artifact:\n${message}`,
            });
            return { success: false, error: message };
        }
    },
);
ipcMain.handle(
    "open-external-file",
    (_event, filePath: string, opts?: { line?: number; col?: number; editor?: string }) => {
        if (!filePath.startsWith("/") || filePath.includes("..")) return "";
        const editor = opts?.editor ?? "system";
        if (editor === "system") return shell.openPath(filePath);

        const line = opts?.line;
        const col = opts?.col;

        const editorCommands: Record<string, () => string[]> = {
            vscode: () => ["code", "--goto", `${filePath}:${line ?? 1}:${col ?? 1}`],
            cursor: () => ["cursor", "--goto", `${filePath}:${line ?? 1}:${col ?? 1}`],
            windsurf: () => ["windsurf", "--goto", `${filePath}:${line ?? 1}:${col ?? 1}`],
            zed: () => ["zed", `${filePath}:${line ?? 1}:${col ?? 1}`],
            sublime: () => ["subl", `${filePath}:${line ?? 1}:${col ?? 1}`],
            webstorm: () => [
                "webstorm",
                ...(line != null ? ["--line", String(line)] : []),
                ...(col != null ? ["--column", String(col)] : []),
                filePath,
            ],
            idea: () => [
                "idea",
                ...(line != null ? ["--line", String(line)] : []),
                ...(col != null ? ["--column", String(col)] : []),
                filePath,
            ],
            emacs: () => ["emacs", line != null ? `+${line}:${col ?? 1}` : "+1", filePath],
        };

        const buildArgs = editorCommands[editor];
        if (!buildArgs) return shell.openPath(filePath);

        const [cmd, ...args] = buildArgs();
        return new Promise<string>((resolve) => {
            execFile(cmd, args, { timeout: 5000 }, (err) => {
                if (err) {
                    // Fall back to system default on failure
                    void shell.openPath(filePath).then(resolve);
                } else {
                    resolve("");
                }
            });
        });
    },
);
ipcMain.on("quit-and-install-update", () => {
    autoUpdater.quitAndInstall();
});
ipcMain.handle("select-project-directory", async () => {
    const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
});
ipcMain.handle("select-theme-file", async () => {
    const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [
            {
                name: "Theme Files",
                extensions: ["json", "toml", "yaml", "yml", "conf", "plist", "terminal"],
            },
            { name: "All Files", extensions: ["*"] },
        ],
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
});
