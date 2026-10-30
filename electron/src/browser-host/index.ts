import { app, ipcMain, type BrowserWindow } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BackendFetch } from "../backend-fetch";
import { createBackendLink } from "./backend-link";
import { startControlServer } from "./control-server";
import { parseDevToolsActivePort } from "./debug-port";
import { createElectronViewFactory } from "./electron-views";
import { TabHost, type Bounds } from "./tab-host";

let host: TabHost | undefined;
let factory: ReturnType<typeof createElectronViewFactory> | undefined;

export function detachAll(): void {
    host?.detachAll();
}
export function isParkWindow(window: BrowserWindow): boolean {
    return factory?.isParkWindow(window) ?? false;
}

export async function initBrowserHost(deps: {
    backendFetch: BackendFetch;
    getBackendPort(): number | null;
    getMainWindow(): BrowserWindow | null;
}): Promise<void> {
    const viewFactory = createElectronViewFactory({
        getMainWindow: deps.getMainWindow,
        getTabHost: () => tabHost,
    });
    let link: ReturnType<typeof createBackendLink> | undefined = undefined;
    const tabHost: TabHost = new TabHost(viewFactory, {
        navigated: (tabId, url, title) => {
            void link?.event({ type: "navigated", tabId, url, title });
        },
        childOpened: (tabId, parentId, url, targetId) => {
            void link?.event({ type: "child-opened", tabId, parentId, url, targetId });
            void link?.flush();
        },
        closed: (tabId) => {
            void link?.event({ type: "closed", tabId });
            void link?.flush();
        },
        loadedChanged: () => {
            void link?.flush();
        },
        navState: (tabId, state) => {
            const window = deps.getMainWindow();
            if (window && !window.isDestroyed())
                window.webContents.send("browser:nav-state", tabId, state);
        },
    });
    host = tabHost;
    factory = viewFactory;
    const control = await startControlServer(tabHost);
    app.once("will-quit", () => {
        link?.stop();
        control.close();
    });
    // A new window is a new app target; report it now rather than on the next tick.
    app.on("browser-window-created", () => {
        void link?.flush();
    });

    ipcMain.handle("browser:show", (_event, tabId: string, url: string, bounds: Bounds) =>
        tabHost.show(tabId, url, bounds),
    );
    ipcMain.handle("browser:hide", (_event, tabId: string) => {
        tabHost.hide(tabId);
    });
    ipcMain.handle("browser:navigate", (_event, tabId: string, url: string) => {
        tabHost.navigate(tabId, url);
    });
    ipcMain.handle("browser:back", (_event, tabId: string) => {
        tabHost.back(tabId);
    });
    ipcMain.handle("browser:forward", (_event, tabId: string) => {
        tabHost.forward(tabId);
    });
    ipcMain.handle("browser:reload", (_event, tabId: string) => {
        tabHost.reload(tabId);
    });
    ipcMain.handle("browser:freeze", (_event, tabId: string) => tabHost.freeze(tabId));

    let debugPort: number | null = null;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        try {
            debugPort = parseDevToolsActivePort(
                await readFile(join(app.getPath("userData"), "DevToolsActivePort"), "utf8"),
            );
        } catch {
            /* Chromium may not have written the file yet. */
        }
        if (debugPort !== null) break;
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 200);
        });
    }
    if (debugPort === null) {
        console.error("Browser host could not read DevToolsActivePort within 5 seconds");
        return;
    }
    const port = debugPort;
    link = createBackendLink({
        getBackendPort: deps.getBackendPort,
        heartbeat: async () => ({
            controlUrl: control.url,
            debugPort: port,
            loaded: tabHost.loaded(),
            appTargetIds: await viewFactory.appTargetIds(),
        }),
        backendFetch: deps.backendFetch,
        schedule: (tick, ms) => {
            const timer = setInterval(() => {
                void tick();
            }, ms);
            return () => {
                clearInterval(timer);
            };
        },
        log: (message) => {
            console.error(message);
        },
    });
    await link.flush();
}
