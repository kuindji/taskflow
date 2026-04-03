import { app, BrowserWindow, screen } from "electron";
import { join } from "path";

interface SavedWindowBounds {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized: boolean;
}

interface WindowManagerDeps {
    getBackendPort: () => number | null;
    getUIDevServerURL: () => string | undefined;
    getUIPath: () => string;
    onWindowClosed: () => void;
}

let mainWindow: BrowserWindow | null = null;
let windowSavePromise: Promise<Response | undefined> | null = null;
let deps: WindowManagerDeps;

function initWindowManager(d: WindowManagerDeps): void {
    deps = d;
}

async function fetchSavedLayout(): Promise<SavedWindowBounds | null> {
    const port = deps.getBackendPort();
    if (!port) return null;
    try {
        const res = await fetch(`http://127.0.0.1:${port}/api/settings`);
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

async function createWindow(): Promise<void> {
    const appPath = app.getAppPath();
    const saved = await fetchSavedLayout();
    const validBounds = saved ? validateBounds(saved) : null;

    const macOptions: Partial<Electron.BrowserWindowConstructorOptions> =
        process.platform === "darwin"
            ? {
                  titleBarStyle: "hiddenInset",
                  backgroundColor: "#00000000",
                  vibrancy: "under-window",
                  visualEffectState: "active",
              }
            : {
                  backgroundColor: "#1e1e1e",
                  autoHideMenuBar: true,
              };

    const windowOptions: Electron.BrowserWindowConstructorOptions = {
        width: validBounds?.width ?? 1400,
        height: validBounds?.height ?? 900,
        ...(validBounds ? { x: validBounds.x, y: validBounds.y } : {}),
        minWidth: 800,
        minHeight: 600,
        ...macOptions,
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
        // Replace the app preload with a minimal browser preload that patches
        // automation fingerprints (e.g. navigator.webdriver).
        webPreferences.preload = join(appPath, "dist", "browser-preload.js");
    });

    if (saved?.isMaximized) {
        mainWindow.maximize();
    }

    let lastNonMaximizedBounds = mainWindow.getBounds();
    const broadcastFullscreenState = () => {
        mainWindow?.webContents.send("window-fullscreen-changed", {
            fullscreen: mainWindow.isFullScreen(),
        });
    };
    mainWindow.on("focus", () => {
        mainWindow?.webContents.send("window-focus-changed", { focused: true });
    });
    mainWindow.on("blur", () => {
        mainWindow?.webContents.send("window-focus-changed", { focused: false });
    });
    mainWindow.on("enter-full-screen", broadcastFullscreenState);
    mainWindow.on("leave-full-screen", broadcastFullscreenState);

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
        const port = deps.getBackendPort();
        if (!mainWindow || !port) return;
        const isMaximized = mainWindow.isMaximized();
        const bounds = isMaximized ? lastNonMaximizedBounds : mainWindow.getBounds();
        windowSavePromise = fetch(`http://127.0.0.1:${port}/api/settings`, {
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
    // dragged from Finder onto the window.
    mainWindow.webContents.on("will-navigate", (event, url) => {
        if (url.startsWith("file://")) {
            event.preventDefault();
        }
    });

    const devUrl = deps.getUIDevServerURL();
    if (devUrl) {
        void mainWindow.loadURL(devUrl);
    } else {
        void mainWindow.loadFile(deps.getUIPath());
    }

    mainWindow.on("closed", () => {
        mainWindow = null;
        deps.onWindowClosed();
    });
}

function showDockIcon(): void {
    if (process.platform === "darwin") {
        void app.dock.show();
    }
}

function hideDockIcon(): void {
    if (process.platform === "darwin") {
        app.dock.hide();
    }
}

async function showMainWindow(): Promise<void> {
    showDockIcon();

    if (!mainWindow) {
        await createWindow();
    }

    if (!mainWindow) return;
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
}

function getMainWindow(): BrowserWindow | null {
    return mainWindow;
}

function getWindowSavePromise(): Promise<Response | undefined> | null {
    return windowSavePromise;
}

function clearWindowSavePromise(): void {
    windowSavePromise = null;
}

export {
    initWindowManager,
    createWindow,
    showMainWindow,
    hideDockIcon,
    getMainWindow,
    getWindowSavePromise,
    clearWindowSavePromise,
};
