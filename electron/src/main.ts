import { app, BrowserWindow, dialog, ipcMain } from "electron";
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

    if (args.length > 0) {
        backendProcess = spawn(binary, args, {
            stdio: ["ignore", "pipe", "pipe"],
            env: {
                ...process.env,
                TASKFLOW_PORT_FILE: backendPortFile,
            },
        });
    } else {
        // Standalone compiled binary — use execFile
        backendProcess = execFile(binary, [], {
            stdio: ["ignore", "pipe", "pipe"] as never,
            env: {
                ...process.env,
                TASKFLOW_PORT_FILE: backendPortFile,
            },
        });
    }

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

function createWindow() {
    const appPath = app.getAppPath();

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: "hiddenInset",
        backgroundColor: "#1e1e2e",
        webPreferences: {
            preload: join(appPath, "dist", "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true,
        },
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

    void autoUpdater.checkForUpdates();
}

void app.whenReady().then(async () => {
    try {
        backendPort = await startBackend();
        console.log(`Backend started on port ${backendPort}`);
        createWindow();
        setupAutoUpdater();
    } catch (err) {
        console.error("Failed to start backend:", err);
        app.quit();
    }
});

app.on("window-all-closed", () => {
    if (backendProcess) {
        backendProcess.kill();
        backendProcess = null;
    }
    void cleanupBackendArtifacts();
    app.quit();
});

app.on("before-quit", () => {
    if (backendProcess) {
        backendProcess.kill();
        backendProcess = null;
    }
    void cleanupBackendArtifacts();
});

ipcMain.handle("get-backend-port", () => backendPort);
ipcMain.handle("select-project-directory", async () => {
    const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
});
