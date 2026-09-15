import { app, BrowserWindow, Menu, nativeImage, nativeTheme, Tray } from "electron";
import { join } from "path";
import type { AttachedBackend } from "./attached-backends";

type TrayState = "working" | "attention" | null;

interface TrayManagerDeps {
    getMainWindow: () => BrowserWindow | null;
    getAttachedBackends: () => AttachedBackend[];
    showMainWindow: () => Promise<void>;
    getDevBranch: () => string | null;
    quit: () => void;
}

let menuBarTray: Tray | null = null;
let rendererTrayState: TrayState = null;
let rendererTrayStateSynced = false;
let backgroundTrayState: TrayState = null;
const originTrayStates = new Map<string, TrayState>();
let trayStatePollTimer: ReturnType<typeof setInterval> | null = null;
let deps: TrayManagerDeps;

function initTrayManager(d: TrayManagerDeps): void {
    deps = d;
}

// Not __dirname: the bundler bakes in the build machine's path, which does not
// exist where a packaged app is installed.
function getMenuBarIconPath(): string {
    const p = join(app.getAppPath(), "dist", "menubar-icon.png");
    return p.replace("app.asar", "app.asar.unpacked");
}

function getMenuBarIcon2xPath(): string {
    const p = join(app.getAppPath(), "dist", "menubar-icon@2x.png");
    return p.replace("app.asar", "app.asar.unpacked");
}

function createMenuBarIcon(): Electron.NativeImage {
    if (process.platform === "darwin") {
        const image = nativeImage.createFromPath(getMenuBarIcon2xPath());
        image.setTemplateImage(true);
        return image;
    }
    // Windows/Linux: use the regular icon
    return nativeImage.createFromPath(getMenuBarIconPath());
}

const TRAY_DOT_ATTENTION: [number, number, number] = [255, 183, 3];
const TRAY_DOT_WORKING: [number, number, number] = [59, 130, 246];

function createIconWithDot(color: [number, number, number]): Electron.NativeImage {
    if (process.platform !== "darwin") {
        return nativeImage.createFromPath(getMenuBarIconPath());
    }
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
    if (menuBarTray) return;
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

async function fetchTrayState(origin: string): Promise<void> {
    try {
        const response = await fetch(`${origin}/api/tray-state`, {
            signal: AbortSignal.timeout(1000),
        });
        if (!response.ok) return;

        const payload = (await response.json()) as { status?: unknown };
        originTrayStates.set(
            origin,
            payload.status === "working" || payload.status === "attention" ? payload.status : null,
        );
    } catch {
        // Ignore transient backend polling failures; that origin keeps its last state
        // until the next poll resyncs it.
    }
}

/** Polls every attached backend; the icon shows the most urgent state among them. */
async function refreshBackgroundTrayState(): Promise<void> {
    const origins = new Set(deps.getAttachedBackends().map((entry) => entry.origin));
    for (const origin of originTrayStates.keys()) {
        if (!origins.has(origin)) originTrayStates.delete(origin);
    }
    await Promise.all([...origins].map((origin) => fetchTrayState(origin)));

    const states = [...originTrayStates]
        .filter(([origin]) => origins.has(origin))
        .map(([, state]) => state);
    const nextState: TrayState = states.includes("attention")
        ? "attention"
        : states.includes("working")
          ? "working"
          : null;
    if (nextState === backgroundTrayState) return;

    backgroundTrayState = nextState;
    const mainWindow = deps.getMainWindow();
    if (!mainWindow || !rendererTrayStateSynced) {
        updateTrayIcon();
    }
}

function startTrayStatePolling(): void {
    if (trayStatePollTimer) return;
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
