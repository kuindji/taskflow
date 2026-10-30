# Section 5: Electron browser host

Read `handoff.md` first. Section 1 recorded how to read the debug port, how hidden views render (removed from the window, or parked in a hidden window), and whether `createWindow` keeps `window.opener`. Use those facts as recorded.

The Electron-free logic lives in pure modules with tests (`bun test electron/src/browser-host/...`, the same as `notification-poller.test.ts`). The Electron glue stays thin and is verified in Section 8.

**Files** (all new under `electron/src/browser-host/` unless noted):
- `debug-port.ts` + `debug-port.test.ts`: `parseDevToolsActivePort(content: string): number | null`.
- `chrome-user-agent.ts` + `chrome-user-agent.test.ts`: `toChromeUserAgent(ua: string): string`. It strips `Electron/x` and `Taskflow/x` tokens; the rule moves from `BrowserPane.tsx:11-13` (Section 6 deletes the renderer copy).
- `tab-host.ts` + `tab-host.test.ts`: `TabHost`, the view registry over an injected `ViewFactory` (below).
- `control-server.ts` + `control-server.test.ts`: `startControlServer(tabHost): Promise<{ url: string; close(): void }>`. A Node `http` server on `127.0.0.1:0` with `POST /tabs/ensure` and `POST /tabs/close`. Bad JSON returns 400; an unknown path returns 404.
- `backend-link.ts` + `backend-link.test.ts`: `createBackendLink(deps)`. Every 5000 ms it `PUT`s the heartbeat to `<backendOrigin(getBackendPort())>/api/browser/host`, and it `POST`s events to `/api/browser/host/events`. Failures are swallowed (the next heartbeat repairs state). `flush()` sends a heartbeat now; it is called whenever the loaded set changes. All posts (heartbeats and events) go out one at a time, in call order, on one queue, so an event is never overtaken by a later heartbeat.
- `electron-views.ts`: the real `ViewFactory`, built on `WebContentsView`. No unit test.
- `index.ts`: `initBrowserHost({ getBackendPort, getMainWindow })`. It composes everything and registers the IPC handlers.
- Modify `electron/src/main.ts`:
  - `app.commandLine.appendSwitch("remote-debugging-port", "0")` before `whenReady`, next to the other pre-ready setup;
  - after `setBackendPort(port)`, `await initBrowserHost(...)`.
- Modify `electron/src/window-manager.ts`: on the main window's `close`, call `browserHost.detachAll()` **before** the window is destroyed, so views survive the close to tray. Keep `will-attach-webview` for the legacy fallback pane.
- Modify `electron/src/preload.ts` (the `browser` bridge) and `packages/ui/src/env.d.ts` (the `TaskflowBrowserBridge` type from the index).

**Interfaces:**
- Consumes: the index's HTTP host endpoints and types; `backendOrigin` (`electron/src/backend-url.ts`).
- Produces: the index's renderer bridge. IPC channels: `browser:show`, `browser:hide`, `browser:navigate`, `browser:back`, `browser:forward`, `browser:reload`, `browser:freeze` (all `invoke`), and the event `browser:nav-state`.

```ts
// tab-host.ts
interface HostedView {
    targetId: string;
    url(): string;
    title(): string;
    show(bounds: Bounds): void;      // attach to the main window at bounds (DIP)
    hide(): void;                    // detach; keeps rendering (spike's method)
    navigate(url: string): void;
    back(): void;
    forward(): void;
    reload(): void;
    navState(): { canGoBack: boolean; canGoForward: boolean };
    capture(): Promise<string>;      // PNG data URL
    destroy(): void;
}
interface ViewFactory {
    create(req: { tabId: string; url: string; opener?: unknown }): Promise<HostedView>;
    appTargetIds(): Promise<string[]>;
}
interface TabHostEvents {
    navigated(tabId: string, url: string, title: string): void;
    childOpened(tabId: string, parentId: string, url: string, targetId: string): void;
    closed(tabId: string): void;
    navState(tabId: string, s: { canGoBack: boolean; canGoForward: boolean }): void;
    loadedChanged(): void;
}
class TabHost {
    constructor(factory: ViewFactory, events: TabHostEvents);
    ensure(req: { tabId: string; url: string; parentId?: string }): Promise<{ targetId: string }>; // idempotent per tabId; concurrent calls share one creation
    close(tabId: string): void;
    show(tabId: string, url: string, bounds: Bounds): Promise<void>; // ensure, then show
    hide(tabId: string): void;
    navigate(tabId: string, url: string): void; // these four delegate to the view; an unknown or unloaded tab is a no-op
    back(tabId: string): void;
    forward(tabId: string): void;
    reload(tabId: string): void;
    detachAll(): void;
    freeze(tabId: string): Promise<string>; // capture, then hide
    loaded(): { tabId: string; targetId: string; url: string; title?: string; parentId?: string }[];
    // the factory's glue calls these:
    reportNavigated(tabId: string): void;
    reportChildOpened(parentId: string, view: HostedView): string; // assigns a new tabId (randomUUID), registers it, returns the id
    reportClosed(tabId: string): void;
}
type Bounds = { x: number; y: number; width: number; height: number };
```

## Real view factory rules (`electron-views.ts`)

- **`new WebContentsView`** with:
  - `partition: "persist:browser"`;
  - `preload: join(appPath, "dist", "browser-preload.js")`;
  - `backgroundThrottling: false`;
  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **User agent:** `setUserAgent(toChromeUserAgent(app.userAgentFallback))`.
- **Initial size:** 1280×800 until first shown. Apply the spike's hidden-rendering method.
- **`targetId`:** `debugger.attach("1.3")`, then `Target.getTargetInfo`, then `detach()`. This runs once, at creation.
- **Popups:** `setWindowOpenHandler` returns `{ action: "allow", createWindow }`. `createWindow` handles both of Electron's paths, as the spike recorded:
  - **with a guest** (`options.webContents` set): wrap it in a `WebContentsView`. `BrowserWindowConstructorOptions` doesn't declare the field, so read it through a small type guard (`"webContents" in options`). No `as any`.
  - **without a guest:** create a view with the same prefs and `loadURL(details.url, { httpReferrer: details.referrer, postData: details.postBody?.data })`.

  Either way, call `tabHost.reportChildOpened(parentTabId, view)` and return the view's `webContents`.
- **Navigation events:** `did-navigate`, `did-navigate-in-page` and `page-title-updated` call `reportNavigated` and emit `navState`.
- **Closing:** `destroyed`, a `render-process-gone` that can't reload, and the page's own `window.close()` (`close` event) all call `reportClosed`.
- **Bounds:** the renderer sends CSS pixels relative to the window content. Multiply by `mainWindow.webContents.getZoomFactor()` before `setBounds`.
- **`appTargetIds`:** the main window's own targetId, found by the same debugger method on `mainWindow.webContents`.

## `index.ts` wiring

- `TabHostEvents`:
  - `navigated` → `link.event({ type: "navigated", ... })`;
  - heartbeat `loaded` comes from `tabHost.loaded()`, `parentId` included;
  - `childOpened` → `link.event({ type: "child-opened", ... })` and `link.flush()`;
  - `closed` → `link.event({ type: "closed", tabId })` and `link.flush()`;
  - `loadedChanged` → `link.flush()`;
  - `navState` → send `browser:nav-state` to the main window, if it exists.
- The debug port comes from `parseDevToolsActivePort(readFile(join(app.getPath("userData"), "DevToolsActivePort")))` (or the spike's recorded path). Retry every 200 ms for up to 5 s. If it still fails, log it and don't start the backend link, so the backend reports the host unavailable.
- IPC handlers map one-to-one onto `TabHost` methods.

## Steps

- [ ] **Step 1:** Tests for `debug-port.ts`:
  - `parses the first line as the port`
  - `returns null for empty or non-numeric content`

  Tests for `chrome-user-agent.ts`:
  - `strips Electron and Taskflow tokens and keeps Chrome`
- [ ] **Step 2:** `tab-host.test.ts`, with a fake factory whose views record calls:
  - `ensure creates once for concurrent calls and returns the targetId`
  - `ensure of a loaded tab does not create again`
  - `show ensures then shows at bounds; hide hides`
  - `freeze captures then hides and returns the data url`
  - `close destroys the view, removes it from loaded and fires loadedChanged`
  - `reportChildOpened registers a new tab, fires childOpened with the parent and loadedChanged`
  - `reportClosed removes the tab and fires closed`
  - `detachAll hides every view without destroying any`
  - `navigate, back, forward and reload delegate to the view; an unknown tab is a no-op`
  - `loaded lists tabId, targetId, url, title and the parentId of children`
- [ ] **Step 3:** `control-server.test.ts`, against a fake `TabHost`:
  - `POST /tabs/ensure returns {targetId}`
  - `POST /tabs/close returns {ok:true}`
  - `bad json is 400`
  - `unknown path is 404`
  - `binds 127.0.0.1`

  `backend-link.test.ts`, with a fake fetch and a manual timer:
  - `heartbeat PUTs controlUrl, debugPort, loaded and appTargetIds every 5000 ms`
  - `uses the current backend port on each tick`
  - `flush sends a heartbeat immediately`
  - `event POSTs to /api/browser/host/events`
  - `fetch failures are swallowed`
  - `an event posted before a flush reaches fetch before that heartbeat`
- [ ] **Step 4:** Run `bun test electron/src/browser-host`. Expected: FAIL.
- [ ] **Step 5:** Implement the pure modules.
- [ ] **Step 6:** Run them. Expected: PASS.
- [ ] **Step 7:** Implement `electron-views.ts` and `index.ts`, plus the `main.ts`, `window-manager.ts`, `preload.ts` and `env.d.ts` changes. Build: `cd electron && bun run build` (or the script `package.json` defines). Expected: no type or build errors.
- [ ] **Step 8:** Smoke test, by hand, against the dev app:
  1. Start the app.
  2. `curl -X POST <api>/api/browser/tabs -H 'x-taskflow-task-id: <id>' -d '{"url":"https://example.com"}'` returns 201.
  3. `curl <endpoint>/json/version` shows a gateway `webSocketDebuggerUrl`.

  Record the result in `handoff.md`.
- [ ] **Step 9:** Commit `feat(electron): browser host with WebContentsView tabs`.
