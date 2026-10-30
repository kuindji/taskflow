# Section 5: Electron browser host

Read `handoff.md` first. Section 1 recorded how to read the debug port, how hidden views render, and how guest popups keep their preferences; the rules below already apply them (spike amendments). The working reference is `spike/main.cjs`.

The Electron-free logic lives in pure modules with tests (`bun test electron/src/browser-host/...`, the same as `notification-poller.test.ts`). The Electron glue stays thin and is verified in Section 8.

**Files** (all new under `electron/src/browser-host/` unless noted):
- `debug-port.ts` + `debug-port.test.ts`: `parseDevToolsActivePort(content: string): number | null`.
- `post-body-headers.ts` + `post-body-headers.test.ts`: `postBodyHeaders(body: { contentType: string; boundary?: string } | undefined): string | undefined`, the no-guest popup's `extraHeaders`.
- `chrome-user-agent.ts` + `chrome-user-agent.test.ts`: `toChromeUserAgent(ua: string): string`. It strips `Electron/x` and `Taskflow/x` tokens; the rule moves from `BrowserPane.tsx:11-13` (Section 6 deletes the renderer copy).
- `tab-host.ts` + `tab-host.test.ts`: `TabHost`, the view registry over an injected `ViewFactory` (below).
- `control-server.ts` + `control-server.test.ts`: `startControlServer(tabHost): Promise<{ url: string; close(): void }>`. A Node `http` server on `127.0.0.1:0` with `POST /tabs/ensure` and `POST /tabs/close`. Bad JSON returns 400; an unknown path returns 404.
  - **Secret path (t3code amendment).** Any local process or web page can reach a loopback port, including pages in the hosted tabs themselves. At start the server draws a random secret (32 bytes, base64url) and returns `url = http://127.0.0.1:<port>/<secret>`. The routes live under that prefix (`/<secret>/tabs/ensure`, `/<secret>/tabs/close`), so Section 2's client, which calls `controlUrl + "/tabs/ensure"`, needs no change. A path without the prefix returns 404. A request that carries an `Origin` header returns 403 before any routing; the backend's Bun `fetch` sends none.
- `permission-policy.ts` + `permission-policy.test.ts` (t3code amendment): `isPermissionAllowed(permission: string): boolean` and `isNavigableScheme(url: string): boolean`. See "Session policy" below.
- `backend-link.ts` + `backend-link.test.ts`: `createBackendLink(deps)`. Every 5000 ms it `PUT`s the heartbeat to `<backendOrigin(getBackendPort())>/api/browser/host`, and it `POST`s events to `/api/browser/host/events`. `flush()` sends a heartbeat now; it is called whenever the loaded set changes. All posts (heartbeats and events) go out one at a time, in call order, on one queue, so an event is never overtaken by a later heartbeat. Failures:
  - a heartbeat that fails is dropped; the next one replaces it;
  - an event that fails **without an HTTP response** (backend down or restarting) stays at the head of the queue. Nothing behind it is sent; each tick retries it first. The heartbeat can't repair a lost event: a tab missing from `loaded` is only unloaded, never closed, because lazy tabs are missing too;
  - an event answered with a 5xx is retried the same way, up to 3 attempts in total, then dropped and logged (Section 2 makes `closed` idempotent, so a retry is safe);
  - an event answered with any other status is done, so the backend can't wedge the queue.
- `electron-views.ts`: the real `ViewFactory`, built on `WebContentsView`. No unit test.
- `index.ts`: `initBrowserHost({ getBackendPort, getMainWindow })`. It composes everything and registers the IPC handlers.
- Modify `electron/src/main.ts`:
  - `app.commandLine.appendSwitch("remote-debugging-port", "0")` before `whenReady`, next to the other pre-ready setup;
  - `app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled")` next to it. Remote debugging turns Blink's `AutomationControlled` on, so `navigator.webdriver` is `true` in every page's main world; `browser-preload.ts` can't fix it because with `contextIsolation` its patch only reaches the isolated world. The switch gives `false`. Keep the preload;
  - after `setBackendPort(port)`, `await initBrowserHost(...)`;
  - the park window (below) is a `BrowserWindow`, so `app.on("window-all-closed")` (`main.ts:219`: quit on Windows/Linux, hide the dock icon on macOS) would never fire again. Move that body into a named function and also call it when the main window is `closed` and every remaining window is the park window (`browserHost.isParkWindow(w)`, exported from `index.ts`). Section 8 checks both platforms' close behaviour.
- Modify `electron/src/window-manager.ts`:
  - on the main window's `close`, call `browserHost.detachAll()` **before** the window is destroyed, so views survive the close to tray;
  - on the main window's `webContents` `did-start-navigation` with `isMainFrame && !isSameDocument` (a reload, force reload or full navigation of the UI), and on its `render-process-gone`, call `browserHost.detachAll()`. A reload runs no React cleanup and the rebuilt UI may not show the pane that was visible, so an attached view would cover it. Views stay alive; the new renderer shows its active panes;
  - keep `will-attach-webview` for the legacy fallback pane.
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
    hide(): void;                    // move into the park window at 0,0 1280×800; keeps rendering
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
    freeze(tabId: string): Promise<string>; // capture, then hide; "" when the tab has no view
    loaded(): { tabId: string; targetId: string; url: string; title?: string; parentId?: string }[];
    // the factory's glue calls these:
    reportNavigated(tabId: string): void;
    claimPopupName(parentId: string, frameName: string): boolean; // see "Popup names"; reserves the name on success
    reportChildOpened(parentId: string, view: HostedView, frameName: string): string; // assigns a new tabId (randomUUID), registers it and its frame name, returns the id
    reportClosed(tabId: string): void;
}
type Bounds = { x: number; y: number; width: number; height: number };
```

**Visibility ordering.** `show` and `freeze` await (creation, capture), so an older call can finish after a newer one. `TabHost` keeps a per-tab visibility generation:
- `show`, `hide` and `freeze` bump the tab's generation; `detachAll` and `close` bump every affected tab's.
- After its await, `show` attaches the view only if its generation is still current. `freeze` returns the image either way, but hides only if its generation is still current.
- `hide` of a tab whose creation is pending records the hidden state, so the pending `show` doesn't attach it.
- A creation that finishes after `close` destroys the new view and doesn't register it; the waiting `ensure` rejects.

**Popup names.** Electron 33 keeps one process-wide frame-name map (`guest-window-manager.ts` `frameNamesToWindow`) and, before `createWindow` runs, navigates any existing popup with the requested name. Nothing checks the opener, so a page in A's family could navigate B's named popup.
- The open handler and `createWindow` run in separate tasks (`-will-add-new-contents`, then `-add-new-contents`), so two families can both see a name as free before either popup exists. Ownership is therefore taken when the handler grants it, not when the popup is created.
- `claimPopupName(parentId, frameName)`:
  - an empty name: `true`, nothing recorded;
  - a name owned (reserved or registered) by the parent's own family: `true`;
  - a free name: reserve it for the parent's family root, `true`;
  - a name owned by another family: `false`.
- `reportChildOpened` registers the child's name for its family (keeping the reservation). `reportClosed` of the named child frees the name. Closing a family root frees every name its family holds, so a reservation that never became a popup (the opener died, Electron reused an existing window) blocks other families only until then.

## Real view factory rules (`electron-views.ts`)

- **`new WebContentsView`** with:
  - `partition: "persist:browser"`;
  - `preload: join(appPath, "dist", "browser-preload.js")`;
  - `backgroundThrottling: false`;
  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **User agent:** `setUserAgent(toChromeUserAgent(app.userAgentFallback))`. Section 8 item 15 compares this with Electron's native UA on challenge and login pages. If only the native UA passes, drop the `setUserAgent` call (one line) and record it under Deviations; keep the module either way.
- **Session policy (t3code amendment).** Once, when the factory first touches `session.fromPartition("persist:browser")`:
  - `setPermissionRequestHandler((wc, permission, cb, details) => cb(isPermissionAllowed(permission)))` and `setPermissionCheckHandler((wc, permission) => isPermissionAllowed(permission))`. The allowlist is exactly `clipboard-sanitized-write`, `storage-access`, `top-level-storage-access` and `persistent-storage`. Everything else is denied, with no prompt: camera, microphone, geolocation, notifications, clipboard read, display capture, MIDI, pointer and keyboard lock, fullscreen, window management, idle detection, and `openExternal`. An agent drives these pages, so nothing in them may open a prompt or a native app.
  - `setDevicePermissionHandler(() => false)` (HID, serial, USB).
  - On every tab and popup `webContents`, `will-navigate` and `will-frame-navigate` call `event.preventDefault()` when `!isNavigableScheme(url)`. Navigable means `http:`, `https:`, `about:`, `data:` and `blob:`. So `mailto:`, `vscode:` and other custom schemes do nothing, and the refusal is logged.
- **Capture.** `HostedView.capture()` keeps one capture in flight per view: a second call waits for the first to settle, then runs. Each call resolves `""` if `capturePage()` fails, takes longer than 3000 ms, or the view was destroyed while it awaited. The deadline doesn't cancel Chromium's capture, so the next call still waits for the real one to settle, not for the deadline. t3code saw main-process crashes from overlapping captures and from captures racing a renderer exit (`apps/desktop/src/preview/Manager.ts`, `DesktopBrowserHost.ts`). Section 6 already treats `""` as "no image".
- **Park window.** One hidden `BrowserWindow` (`show: false`, `paintWhenInitiallyHidden: true`, 1280×800), created lazily by the factory and never shown. Every view that isn't shown lives in it at `{ x: 0, y: 0, width: 1280, height: 800 }`: a new view is added to it at creation, `hide()` moves the view back into it, `show()` moves it into the main window. The spike found the two alternatives broken:
  - a view that was never in any window has a 0×0 viewport whatever `setBounds` says: `Page.captureScreenshot` fails (`Cannot take screenshot with 0 width`) and nothing in it is visible, so Playwright's `waitForSelector` hangs;
  - a view removed from every window keeps painting only while the CDP client attached at the time stays connected. After a reconnect `requestAnimationFrame` never fires, so clicks and visibility waits hang.

  A parked view survives reconnects, screenshots at 1280×800 and keeps timers and rAF running. The main window being hidden or minimized doesn't stop a shown view. Electron gives a view one parent, so remove it from its current window before adding it to the other.
- **First load:** for a new view whose URL is `about:blank`, `create` resolves only after that `loadURL` settles (log a failure, don't throw). Otherwise a client's first `goto` on a page from `Target.createTarget` is cut off: `Navigation ... is interrupted by another navigation to "about:blank"`. Other URLs start loading and `create` resolves at once, inside the host client's 10 s timeout.
- **`targetId`:** `debugger.attach("1.3")`, then `Target.getTargetInfo`, then `detach()`. This runs once, at creation.
- **Popups:** if `!tabHost.claimPopupName(parentTabId, details.frameName)`, `setWindowOpenHandler` returns `{ action: "deny" }`. Otherwise it returns `{ action: "allow", overrideBrowserWindowOptions: { webPreferences: <the shared tab prefs above> }, createWindow }`. Electron fixes a guest's preferences from `overrideBrowserWindowOptions` before `createWindow` runs, so this is the only place the preload and `backgroundThrottling: false` reach guest popups. Keep the prefs in one builder used by both. `createWindow` handles both of Electron's paths, as the spike recorded:
  - **with a guest:** wrap it in `new WebContentsView({ webContents, webPreferences: <the shared tab prefs without partition> })` and return that same `webContents` (Electron throws on any other). The `webPreferences` are required: on an existing `webContents` the constructor runs `SetFromDictionary` with them (`electron_api_web_contents.cc` `CreateFromWebPreferences`), and without them the guest's prefs are reset and the preload is lost. `partition` must be left out: with it, the next `new WebContentsView` after that guest closes crashes main (SIGSEGV). The prefs builder therefore has two outputs, the tab prefs and the guest prefs (the same minus `partition`). In the spike every popup kind took this path: `<a target=_blank>`, `rel=opener`, `window.open` and both `target=_blank` form posts (Electron 33 posts them itself, with the right `content-type` and boundary). `BrowserWindowConstructorOptions` doesn't declare `webContents`, and on the no-guest path the key is present with `undefined`. An `in` check plus a null check narrows only to `{}` (TS2740 on 33.4.11), so read it as `const guest = "webContents" in options ? options.webContents : undefined` and test it with a real predicate, `isWebContents(value: unknown): value is WebContents`: an object with a numeric `id` where `webContents.fromId(value.id) === value`. No `as any`.
  - **without a guest** (not reached in the spike; keep it, Electron documents it): create a view with the shared prefs and `loadURL(details.url, { httpReferrer: details.referrer, postData: details.postBody?.data, extraHeaders })`. `extraHeaders` is `content-type: <contentType>` plus `; boundary=<boundary>` when `postBody` has one, built by a pure `postBodyHeaders(postBody)` in `post-body-headers.ts` (+ test).

  Either way, call `tabHost.reportChildOpened(parentTabId, view, details.frameName)` and return the view's `webContents`.
- **Navigation events:** `did-navigate`, `did-navigate-in-page` and `page-title-updated` call `reportNavigated` and emit `navState`.
- **`show` emits `navState` too.** `TabHost.show` fires `events.navState(tabId, view.navState())` after showing, so a remounted toolbar (task switch, renderer reload) gets the current history state of an already loaded view.
- **Closing:** on `destroyed`, remove the view from whichever window holds it. `destroyed` and a `render-process-gone` that can't reload call `reportClosed`. The page's own `window.close()` is covered by `destroyed`: Electron's `CloseContents` emits `close` and then destroys the contents. Don't listen for `close`; 33.4.11's typings don't declare it (TS2769).
- **Bounds:** the renderer sends CSS pixels relative to the window content. Multiply by `mainWindow.webContents.getZoomFactor()` before `setBounds`.
- **`appTargetIds`:** the main window's and the park window's own targetIds, found by the same debugger method on their `webContents`. Every page target that isn't a tab must be listed: an unknown target makes the gateway's `resolveTarget` wait 2000 ms inside the ordered upstream chain. In the spike the unlisted park window stalled Puppeteer's connect past its protocol timeout.

## `index.ts` wiring

- `TabHostEvents`:
  - `navigated` → `link.event({ type: "navigated", ... })`;
  - heartbeat `loaded` comes from `tabHost.loaded()`, `parentId` included;
  - `childOpened` → `link.event({ type: "child-opened", ... })` and `link.flush()`;
  - `closed` → `link.event({ type: "closed", tabId })` and `link.flush()`;
  - `loadedChanged` → `link.flush()`;
  - `navState` → send `browser:nav-state` to the main window, if it exists.
- The debug port comes from `parseDevToolsActivePort(readFile(join(app.getPath("userData"), "DevToolsActivePort")))`. The spike confirmed the path and format: line 1 is the port, line 2 the `/devtools/browser/<uuid>` path; the file exists shortly after `ready`. Retry every 200 ms for up to 5 s. If it still fails, log it and don't start the backend link, so the backend reports the host unavailable.
- IPC handlers map one-to-one onto `TabHost` methods.

## Steps

- [ ] **Step 1:** Tests for `debug-port.ts`:
  - `parses the first line as the port`
  - `returns null for empty or non-numeric content`

  Tests for `post-body-headers.ts`:
  - `urlencoded body gives its content-type`
  - `multipart body appends the boundary`
  - `no body gives undefined`

  Tests for `chrome-user-agent.ts`:
  - `strips Electron and Taskflow tokens and keeps Chrome`
- [ ] **Step 2:** `tab-host.test.ts`, with a fake factory whose views record calls:
  - `ensure creates once for concurrent calls and returns the targetId`
  - `ensure of a loaded tab does not create again`
  - `show ensures then shows at bounds; hide hides`
  - `show of an already loaded tab emits navState with the view's current state`
  - `freeze captures then hides and returns the data url`
  - `close destroys the view, removes it from loaded and fires loadedChanged`
  - `reportChildOpened registers a new tab, fires childOpened with the parent and loadedChanged`
  - `reportClosed removes the tab and fires closed`
  - `detachAll hides every view without destroying any`
  - `navigate, back, forward and reload delegate to the view; an unknown tab is a no-op`
  - `loaded lists tabId, targetId, url, title and the parentId of children`
  - `hide during a pending show: the view is created but never shown`
  - `show during a pending freeze capture: the freeze returns its image and the view stays shown`
  - `detachAll during a pending show: the view is not shown`
  - `close during a pending creation destroys the new view, leaves it out of loaded, and rejects ensure`
  - `freeze of a tab with no view returns an empty string`
  - `freeze returns an empty string when capture resolves empty, and still hides`
  - `claimPopupName allows an empty name, a free name, and a name owned by the same family`
  - `claimPopupName refuses a name owned by another family`
  - `claimPopupName reserves: family A claims "oauth", family B's claim is refused before A's popup is reported` (the interleaved case)
  - `reportClosed of the named child frees its name`
  - `closing a family root frees its unused reservations`
- [ ] **Step 3:** `control-server.test.ts`, against a fake `TabHost`:
  - `POST /tabs/ensure returns {targetId}`
  - `POST /tabs/close returns {ok:true}`
  - `bad json is 400`
  - `unknown path is 404`
  - `binds 127.0.0.1`
  - `url ends with a secret path segment; a route without it is 404`
  - `a request with an Origin header is 403`

  `permission-policy.test.ts`:
  - `allows exactly the four allowlisted permissions`
  - `denies media, geolocation, notifications, clipboard-read and openExternal`
  - `navigable schemes are http, https, about, data and blob; mailto and vscode are not`

  `backend-link.test.ts`, with a fake fetch and a manual timer:
  - `heartbeat PUTs controlUrl, debugPort, loaded and appTargetIds every 5000 ms`
  - `uses the current backend port on each tick`
  - `flush sends a heartbeat immediately`
  - `event POSTs to /api/browser/host/events`
  - `a failed heartbeat is dropped, not retried`
  - `an event posted before a flush reaches fetch before that heartbeat`
  - `an event that fails without a response is retried on the next tick, before that tick's heartbeat`
  - `an event answered with HTTP 500 is retried on the next ticks and dropped after 3 attempts`
  - `an event answered with HTTP 400 is not retried`
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
