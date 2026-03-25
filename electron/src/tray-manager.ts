import { BrowserWindow, Menu, nativeImage, nativeTheme, Tray } from "electron";
import { join } from "path";

type TrayState = "working" | "attention" | null;

interface TrayManagerDeps {
    getMainWindow: () => BrowserWindow | null;
    getBackendPort: () => number | null;
    showMainWindow: () => Promise<void>;
    getDevBranch: () => string | null;
    quit: () => void;
}

let menuBarTray: Tray | null = null;
let rendererTrayState: TrayState = null;
let rendererTrayStateSynced = false;
let backgroundTrayState: TrayState = null;
let trayStatePollTimer: ReturnType<typeof setInterval> | null = null;
let deps: TrayManagerDeps;

function initTrayManager(d: TrayManagerDeps): void {
    deps = d;
}

function getMenuBarIconPath(): string {
    const p = join(__dirname, "..", "dist", "menubar-icon.png");
    return p.replace("app.asar", "app.asar.unpacked");
}

function getMenuBarIcon2xPath(): string {
    const p = join(__dirname, "..", "dist", "menubar-icon@2x.png");
    return p.replace("app.asar", "app.asar.unpacked");
}

function createMenuBarIcon(): Electron.NativeImage {
    const image = nativeImage.createFromPath(getMenuBarIconPath());
    image.setTemplateImage(true);
    return image;
}

const TRAY_DOT_ATTENTION: [number, number, number] = [255, 183, 3];
const TRAY_DOT_WORKING: [number, number, number] = [59, 130, 246];

function createIconWithDot(color: [number, number, number]): Electron.NativeImage {
    const image = nativeImage.createFromPath(getMenuBarIcon2xPath());
    if (image.isEmpty()) return createMenuBarIcon();

    const bitmap = image.toBitmap();
    const totalPixels = bitmap.length / 4;
    const pixelWidth = Math.round(Math.sqrt(totalPixels));
    const pixelHeight = pixelWidth;
    const isDark = nativeTheme.shouldUseDarkColors;

    if (isDark) {
        for (let i = 0; i < bitmap.length; i += 4) {
            if (bitmap[i + 3] > 0) {
                bitmap[i] = 255 - bitmap[i];
                bitmap[i + 1] = 255 - bitmap[i + 1];
                bitmap[i + 2] = 255 - bitmap[i + 2];
            }
        }
    }

    const dotRadius = 3;
    const cx = pixelWidth - dotRadius - 1;
    const cy = 26;

    for (let y = cy - dotRadius; y <= cy + dotRadius; y++) {
        for (let x = cx - dotRadius; x <= cx + dotRadius; x++) {
            if (x < 0 || x >= pixelWidth || y < 0 || y >= pixelHeight) continue;
            const dx = x - cx;
            const dy = y - cy;
            if (dx * dx + dy * dy <= dotRadius * dotRadius) {
                const idx = (y * pixelWidth + x) * 4;
                bitmap[idx] = color[2]; // B
                bitmap[idx + 1] = color[1]; // G
                bitmap[idx + 2] = color[0]; // R
                bitmap[idx + 3] = 255; // A
            }
        }
    }

    return nativeImage.createFromBitmap(bitmap, {
        width: pixelWidth,
        height: pixelHeight,
        scaleFactor: 2,
    });
}

function updateTrayIcon(): void {
    if (!menuBarTray) return;

    const mainWindow = deps.getMainWindow();
    const effectiveTrayState =
        mainWindow && rendererTrayStateSynced ? rendererTrayState : backgroundTrayState;

    if (!effectiveTrayState) {
        menuBarTray.setImage(createMenuBarIcon());
        return;
    }

    const color = effectiveTrayState === "attention" ? TRAY_DOT_ATTENTION : TRAY_DOT_WORKING;
    menuBarTray.setImage(createIconWithDot(color));
}

function getMenuBarTooltip(): string {
    const devBranch = deps.getDevBranch();
    return devBranch ? `Taskflow Dev (${devBranch})` : "Taskflow";
}

function setupMenuBarTray(): void {
    if (process.platform !== "darwin" || menuBarTray) return;
    let icon: Electron.NativeImage;

    const iconPath = getMenuBarIconPath();
    console.log("[tray] icon path:", iconPath);

    try {
        icon = createMenuBarIcon();
    } catch (error) {
        console.warn("[tray] Failed to load menu bar icon assets", error);
        return;
    }

    console.log("[tray] icon isEmpty:", icon.isEmpty(), "size:", icon.getSize());

    if (icon.isEmpty()) {
        console.warn("[tray] Failed to decode menu bar icon assets");
        return;
    }

    const contextMenu = Menu.buildFromTemplate([
        {
            label: "Show Taskflow",
            click: () => {
                void deps.showMainWindow();
            },
        },
        {
            label: "Exit",
            click: () => {
                deps.quit();
            },
        },
    ]);

    menuBarTray = new Tray(icon);
    menuBarTray.setToolTip(getMenuBarTooltip());
    menuBarTray.setContextMenu(contextMenu);
    updateTrayIcon();
}

async function refreshBackgroundTrayState(): Promise<void> {
    const port = deps.getBackendPort();
    if (!port) return;

    try {
        const response = await fetch(`http://127.0.0.1:${port}/api/tray-state`, {
            signal: AbortSignal.timeout(1000),
        });
        if (!response.ok) return;

        const payload = (await response.json()) as { status?: unknown };
        const nextState: TrayState =
            payload.status === "working" || payload.status === "attention" ? payload.status : null;
        if (nextState === backgroundTrayState) return;

        backgroundTrayState = nextState;
        const mainWindow = deps.getMainWindow();
        if (!mainWindow || !rendererTrayStateSynced) {
            updateTrayIcon();
        }
    } catch {
        // Ignore transient backend polling failures; the next poll will resync.
    }
}

function startTrayStatePolling(): void {
    const port = deps.getBackendPort();
    if (trayStatePollTimer || !port) return;
    void refreshBackgroundTrayState();
    trayStatePollTimer = setInterval(() => {
        void refreshBackgroundTrayState();
    }, 1000);
}

function stopTrayStatePolling(): void {
    if (!trayStatePollTimer) return;
    clearInterval(trayStatePollTimer);
    trayStatePollTimer = null;
}

function setRendererTrayState(status: TrayState): void {
    rendererTrayState = status;
    rendererTrayStateSynced = true;
    updateTrayIcon();
}

function resetRendererTraySync(): void {
    rendererTrayStateSynced = false;
}

function onWindowClosed(): void {
    rendererTrayStateSynced = false;
    void refreshBackgroundTrayState();
    updateTrayIcon();
}

export {
    initTrayManager,
    setupMenuBarTray,
    startTrayStatePolling,
    stopTrayStatePolling,
    setRendererTrayState,
    resetRendererTraySync,
    onWindowClosed,
    updateTrayIcon,
};

export type { TrayState };
