import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { spawn, execFile, type ChildProcess } from "child_process";
import { constants } from "fs";
import { access, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let backendPort: number | null = null;
let backendPortFile: string | null = null;
let windowSavePromise: Promise<Response | undefined> | null = null;
let quitting = false;

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

    backendProcess = spawn(binary, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
            ...process.env,
            TASKFLOW_PORT_FILE: backendPortFile,
        },
    });

    backendProcess.stdout?.on("data", (data: Buffer) => {
        console.log("[backend]", data.toString().trim());
    });

    backendProcess.stderr?.on("data", (data: Buffer) => {
        console.error("[backend error]", data.toString().trim());
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

    if (saved?.isMaximized) {
        mainWindow.maximize();
    }

    let lastNonMaximizedBounds = mainWindow.getBounds();
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

    if (UI_DEV_SERVER_URL) {
        void mainWindow.loadURL(UI_DEV_SERVER_URL);
    } else {
        void mainWindow.loadFile(getUIPath());
    }

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

let isCheckingForUpdates = false;

async function checkForUpdatesManually() {
    if (isCheckingForUpdates) return;
    isCheckingForUpdates = true;

    const cleanup = () => {
        isCheckingForUpdates = false;
        clearTimeout(timeout);
    };

    const timeout = setTimeout(() => {
        isCheckingForUpdates = false;
    }, 15_000);

    try {
        const result = await autoUpdater.checkForUpdates();
        cleanup();

        if (!result || result.updateInfo.version === app.getVersion()) {
            void dialog.showMessageBox({
                type: "info",
                title: "No Updates",
                message: "You're up to date!",
                detail: `Taskflow ${app.getVersion()} is the latest version.`,
            });
        }
    } catch (err) {
        cleanup();
        const message = err instanceof Error ? err.message : String(err);
        void dialog.showMessageBox({
            type: "error",
            title: "Update Check Failed",
            message: "Could not check for updates.",
            detail: message,
        });
    }
}

function buildAppMenu() {
    const template: Electron.MenuItemConstructorOptions[] = [
        {
            role: "appMenu",
            submenu: [
                { role: "about" },
                { type: "separator" },
                {
                    label: "Check for Updates…",
                    click: () => {
                        void checkForUpdatesManually();
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
        { role: "editMenu" },
        {
            label: "View",
            submenu: [
                {
                    id: "toggle-archive",
                    label: "Show Archived Tasks",
                    type: "checkbox",
                    checked: false,
                    click: () => {
                        mainWindow?.webContents.send("toggle-archive");
                    },
                },
                {
                    id: "compact-sidebar",
                    label: "Compact Sidebar",
                    type: "checkbox",
                    checked: false,
                    accelerator: "CmdOrCtrl+Shift+C",
                    click: () => {
                        mainWindow?.webContents.send("toggle-compact-sidebar");
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

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("update-available", (info) => {
        console.log(`[updater] Update available: v${info.version}`);
    });

    autoUpdater.on("update-downloaded", (info) => {
        console.log(`[updater] Update downloaded: v${info.version}`);
        void dialog
            .showMessageBox({
                type: "info",
                title: "Update Ready",
                message: `Version ${info.version} has been downloaded.`,
                detail: "The update will be installed when you restart the app.",
                buttons: ["Restart Now", "Later"],
                defaultId: 0,
            })
            .then(({ response }) => {
                if (response === 0) {
                    autoUpdater.quitAndInstall();
                }
            });
    });

    autoUpdater.on("error", (err) => {
        console.error("[updater] Error:", err.message);
    });

    autoUpdater.checkForUpdates().catch((err: unknown) => {
        console.error("[updater] Startup check failed:", err);
    });
}

void app.whenReady().then(async () => {
    try {
        backendPort = await startBackend();
        console.log(`Backend started on port ${backendPort}`);
        await createWindow();
        buildAppMenu();
        setupAutoUpdater();
    } catch (err) {
        console.error("Failed to start backend:", err);
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
        void windowSavePromise.then(() => {
            windowSavePromise = null;
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
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById("toggle-archive");
    if (item) {
        item.checked = showArchive;
    }
});

ipcMain.on("compact-sidebar-changed", (_event, compact: boolean) => {
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById("compact-sidebar");
    if (item) {
        item.checked = compact;
    }
});

ipcMain.handle("get-backend-port", () => backendPort);
ipcMain.handle("open-external-url", (_event, url: string) => shell.openExternal(url));
ipcMain.on("show-item-in-folder", (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
});
ipcMain.handle(
    "open-external-file",
    (_event, filePath: string, opts?: { line?: number; col?: number; editor?: string }) => {
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
ipcMain.handle("select-project-directory", async () => {
    const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
});
