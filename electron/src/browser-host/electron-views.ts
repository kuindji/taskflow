import {
    app,
    BrowserWindow,
    session,
    WebContentsView,
    webContents,
    type WebContents,
    type WebPreferences,
} from "electron";
import { join } from "node:path";
import { toChromeUserAgent } from "@taskflow/shared";
import { isNavigableScheme, isPermissionAllowed } from "./permission-policy";
import { postBodyHeaders } from "./post-body-headers";
import type { Bounds, HostedView, TabHost, ViewFactory } from "./tab-host";

const parkedBounds: Bounds = { x: 0, y: 0, width: 1280, height: 800 };

function isWebContents(value: unknown): value is WebContents {
    return (
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof value.id === "number" &&
        webContents.fromId(value.id) === value
    );
}

export function createElectronViewFactory(deps: {
    getMainWindow(): BrowserWindow | null;
    getTabHost(): TabHost;
}): ViewFactory & { isParkWindow(window: BrowserWindow): boolean } {
    let parkWindow: BrowserWindow | null = null;
    let policyInstalled = false;
    const targets = new Map<number, Promise<string>>();

    function preferences(includePartition: boolean): WebPreferences {
        return {
            ...(includePartition ? { partition: "persist:browser" } : {}),
            preload: join(app.getAppPath(), "dist", "browser-preload.js"),
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        };
    }

    function installPolicy(): void {
        if (policyInstalled) return;
        const browserSession = session.fromPartition("persist:browser");
        browserSession.setPermissionRequestHandler((_wc, permission, callback) => {
            callback(isPermissionAllowed(permission));
        });
        browserSession.setPermissionCheckHandler((_wc, permission) =>
            isPermissionAllowed(permission),
        );
        browserSession.setDevicePermissionHandler(() => false);
        policyInstalled = true;
    }

    function park(): BrowserWindow {
        if (!parkWindow || parkWindow.isDestroyed()) {
            parkWindow = new BrowserWindow({
                show: false,
                paintWhenInitiallyHidden: true,
                width: 1280,
                height: 800,
            });
        }
        return parkWindow;
    }

    function targetIdOf(wc: WebContents): Promise<string> {
        const existing = targets.get(wc.id);
        if (existing) return existing;
        const result = (async () => {
            const debuggerApi = wc.debugger;
            const alreadyAttached = debuggerApi.isAttached();
            if (!alreadyAttached) debuggerApi.attach("1.3");
            try {
                const result = (await debuggerApi.sendCommand("Target.getTargetInfo")) as {
                    targetInfo: { targetId: string };
                };
                return result.targetInfo.targetId;
            } finally {
                if (!alreadyAttached && !wc.isDestroyed() && debuggerApi.isAttached())
                    debuggerApi.detach();
            }
        })();
        targets.set(wc.id, result);
        wc.once("destroyed", () => {
            targets.delete(wc.id);
        });
        void result.catch(() => {
            targets.delete(wc.id);
        });
        return result;
    }

    function wrap(nativeView: WebContentsView, getTabId: () => string | undefined): HostedView {
        const wc = nativeView.webContents;
        let parent: BrowserWindow | null = null;
        let captureTail = Promise.resolve();
        let awake = false;

        // The park window is never shown, so its compositor ticks at about 1 Hz and a
        // parked page's rAF and screenshots crawl. Focus emulation counts this session as
        // a capturer that stays awake. The debugger stays attached for the view's life.
        function keepAwake(enabled: boolean): void {
            if (wc.isDestroyed() || awake === enabled) return;
            try {
                if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
            } catch {
                return;
            }
            awake = enabled;
            void wc.debugger
                .sendCommand("Emulation.setFocusEmulationEnabled", { enabled })
                .catch(() => {});
        }

        function detach(): void {
            if (parent && !parent.isDestroyed()) parent.contentView.removeChildView(nativeView);
            parent = null;
        }

        function move(window: BrowserWindow, bounds: Bounds): void {
            if (wc.isDestroyed()) return;
            if (parent !== window) {
                detach();
                window.contentView.addChildView(nativeView);
                parent = window;
            }
            nativeView.setBounds(bounds);
        }

        const hosted: HostedView = {
            targetId: "",
            url: () => (wc.isDestroyed() ? "" : wc.getURL()),
            title: () => (wc.isDestroyed() ? "" : wc.getTitle()),
            show(bounds) {
                const mainWindow = deps.getMainWindow();
                if (!mainWindow || mainWindow.isDestroyed()) return;
                const zoom = mainWindow.webContents.getZoomFactor();
                keepAwake(false);
                move(mainWindow, {
                    x: Math.round(bounds.x * zoom),
                    y: Math.round(bounds.y * zoom),
                    width: Math.round(bounds.width * zoom),
                    height: Math.round(bounds.height * zoom),
                });
            },
            hide() {
                if (wc.isDestroyed()) return;
                move(park(), parkedBounds);
                keepAwake(true);
            },
            navigate(url) {
                if (!wc.isDestroyed()) void load(wc, url);
            },
            back() {
                if (!wc.isDestroyed() && wc.navigationHistory.canGoBack())
                    wc.navigationHistory.goBack();
            },
            forward() {
                if (!wc.isDestroyed() && wc.navigationHistory.canGoForward())
                    wc.navigationHistory.goForward();
            },
            reload() {
                if (!wc.isDestroyed()) wc.reload();
            },
            navState: () => ({
                canGoBack: !wc.isDestroyed() && wc.navigationHistory.canGoBack(),
                canGoForward: !wc.isDestroyed() && wc.navigationHistory.canGoForward(),
            }),
            capture() {
                // The queue waits for Chromium's real completion, even after the caller's deadline.
                const previous = captureTail;
                const capture = previous.then(async () => {
                    if (wc.isDestroyed()) return "";
                    try {
                        const image = await wc.capturePage();
                        return wc.isDestroyed() ? "" : image.toDataURL();
                    } catch {
                        return "";
                    }
                });
                captureTail = capture.then(() => undefined);
                return previous.then(async () => {
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    try {
                        return await Promise.race([
                            capture,
                            new Promise<string>((resolve) => {
                                timer = setTimeout(() => {
                                    resolve("");
                                }, 3000);
                            }),
                        ]);
                    } finally {
                        clearTimeout(timer);
                    }
                });
            },
            destroy() {
                detach();
                if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false });
            },
        };

        wc.setUserAgent(toChromeUserAgent(app.userAgentFallback));
        wc.on("will-navigate", (event, url) => {
            refuseNavigation(event, url);
        });
        wc.on("will-frame-navigate", (event) => {
            refuseNavigation(event, event.url);
        });
        const navigated = () => {
            const tabId = getTabId();
            if (tabId) deps.getTabHost().reportNavigated(tabId);
        };
        wc.on("did-navigate", navigated);
        wc.on("did-navigate-in-page", navigated);
        wc.on("page-title-updated", navigated);
        wc.once("destroyed", () => {
            detach();
            const tabId = getTabId();
            if (tabId) deps.getTabHost().reportClosed(tabId);
        });
        wc.on("render-process-gone", () => {
            if (wc.isDestroyed()) {
                const tabId = getTabId();
                if (tabId) deps.getTabHost().reportClosed(tabId);
                return;
            }
            void wc.loadURL(hosted.url() || "about:blank").catch((error: unknown) => {
                console.error("Browser renderer could not reload", error);
                const tabId = getTabId();
                if (tabId) deps.getTabHost().reportClosed(tabId);
                hosted.destroy();
            });
        });
        wc.setWindowOpenHandler((details) => {
            const parentId = getTabId();
            if (
                !parentId ||
                !isNavigableScheme(details.url) ||
                !deps.getTabHost().claimPopupName(parentId, details.frameName)
            )
                return { action: "deny" };
            return {
                action: "allow",
                overrideBrowserWindowOptions: { webPreferences: preferences(true) },
                createWindow(options) {
                    const guest = "webContents" in options ? options.webContents : undefined;
                    const childNative = isWebContents(guest)
                        ? new WebContentsView({
                              webContents: guest,
                              webPreferences: preferences(false),
                          })
                        : new WebContentsView({ webPreferences: preferences(true) });
                    let childId: string | undefined;
                    const child = wrap(childNative, () => childId);
                    if (!isWebContents(guest))
                        void load(childNative.webContents, details.url, {
                            httpReferrer: details.referrer,
                            postData: details.postBody?.data,
                            extraHeaders: postBodyHeaders(details.postBody),
                        });
                    void targetIdOf(childNative.webContents)
                        .then((targetId) => {
                            if (childNative.webContents.isDestroyed()) return;
                            if (
                                !deps
                                    .getTabHost()
                                    .loaded()
                                    .some((tab) => tab.tabId === parentId)
                            ) {
                                child.destroy();
                                return;
                            }
                            child.targetId = targetId;
                            childId = deps
                                .getTabHost()
                                .reportChildOpened(parentId, child, details.frameName);
                        })
                        .catch((error: unknown) => {
                            console.error("Could not register browser popup", error);
                            child.destroy();
                        });
                    return childNative.webContents;
                },
            };
        });
        hosted.hide();
        return hosted;
    }

    function refuseNavigation(event: { preventDefault(): void }, url: string): void {
        if (isNavigableScheme(url)) return;
        event.preventDefault();
        console.warn("Refused browser navigation to a non-web scheme", url);
    }

    function load(wc: WebContents, url: string, options?: Electron.LoadURLOptions): Promise<void> {
        if (!isNavigableScheme(url)) {
            console.warn("Refused browser navigation to a non-web scheme", url);
            return Promise.resolve();
        }
        return wc.loadURL(url, options).catch((error: unknown) => {
            console.error("Browser navigation failed", error);
        });
    }

    return {
        async create(req) {
            installPolicy();
            const nativeView = new WebContentsView({ webPreferences: preferences(true) });
            const view = wrap(nativeView, () => req.tabId);
            try {
                const loading = load(nativeView.webContents, req.url);
                if (req.url === "about:blank") await loading;
                view.targetId = await targetIdOf(nativeView.webContents);
                return view;
            } catch (error) {
                view.destroy();
                throw error;
            }
        },
        async appTargetIds() {
            const ids = await Promise.all(
                BrowserWindow.getAllWindows()
                    .filter((window) => !window.isDestroyed())
                    .map((window) => targetIdOf(window.webContents).catch(() => null)),
            );
            return ids.filter((id): id is string => id !== null);
        },
        isParkWindow: (window) => window === parkWindow,
    };
}
