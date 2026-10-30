# Spike results (Section 1)

Date: 2026-10-30. Electron 33.4.11 (Chromium 130.0.6723.191), macOS arm64. Clients: playwright-core 1.64.1 (Node 22.14), Playwright for Python 1.64.1 (`uv run --no-project --with playwright`), puppeteer-core 25.16.0 (Node 22.14). Clients were installed in a scratch dir, not the workspace.

**Gate: PASS.** All criteria pass for all three clients through `proxy.ts` in strict mode (`STRICT=1 CTX_MODE=taskflow`: unlisted methods denied), run back to back against one app.

## How to run

```sh
bun docs/superpowers/plans/2026-10-30-agent-browser/spike/proxy.ts          # env: STRICT=1 CTX_MODE=taskflow
electron/node_modules/.bin/electron docs/superpowers/plans/2026-10-30-agent-browser/spike/main.cjs
bun docs/superpowers/plans/2026-10-30-agent-browser/spike/probe.ts          # raw facts, straight to the debug port
PW=<playwright-core>/index.mjs node .../spike/client-playwright.mjs
PPT=<puppeteer-core>/lib/puppeteer/puppeteer-core.js node .../spike/client-puppeteer.mjs
uv run --no-project --with playwright python .../spike/client_playwright.py
```

Start the proxy first: it serves the test page (`:9340`) that tab A loads. `main.cjs` env switches reproduce the failures below: `SPIKE_PARK=0`, `SPIKE_GUEST_PREFS=0|full`, `SPIKE_NO_AUTOMATION_FLAG=0`. Clients: `HIDE=detach` for the removed-from-window variant.

## Criteria × client

| Criterion | Playwright Node | Playwright Python | Puppeteer |
|---|---|---|---|
| 1. exactly one page (A) | PASS | PASS | PASS |
| 2. navigate, fill, click, read | PASS | PASS | PASS |
| 3. hidden: screenshot, counter +20 in 2 s, click | PASS (parked) | PASS (parked) | PASS (parked) |
| 4. popup `target=_blank` (opener null) | PASS | PASS | PASS |
| 4. popup `rel=opener` (opener set) | PASS | PASS | PASS |
| 4. popup `window.open` (opener set) | PASS | PASS | PASS |
| 4b. `target=_blank` form, urlencoded | PASS | PASS | PASS |
| 4b. `target=_blank` form, multipart (boundary kept) | PASS | PASS | PASS |
| cookies: read + add through the context/browser | PASS | PASS | PASS |
| 5. `browser.close()` leaves the app and A intact | PASS | PASS | PASS (its `Browser.close` is refused) |
| 6. `newPage()` | PASS (intercepted) | PASS (intercepted) | PASS (intercepted) |
| 7. `DevToolsActivePort` with port 0 | PASS | | |

Every popup ran the preload, had `navigator.webdriver === false` and advanced its counter while parked. Screenshots are 460–775 KB with real content (checked by eye).

## Findings that changed the plan

1. **Hidden rendering: park, don't detach.**
   - A view that was never in a window has a 0×0 viewport; `setBounds` has no effect. `Page.captureScreenshot` fails with `Cannot take screenshot with 0 width`, and Playwright's `waitForSelector` (visible) hangs.
   - A view removed from its window keeps painting only while the CDP client that was connected at the time stays connected. After a reconnect `requestAnimationFrame` never fires, so clicks hang (`detach` + reconnect: rAF TIMEOUT; reproduced 3 times).
   - Parked in one hidden `BrowserWindow` (`show: false`, `paintWhenInitiallyHidden: true`, 1280×800): screenshots, rAF, timers and clicks work, across reconnects.
   - Hiding or minimizing the main window doesn't affect a shown view (rAF, screenshot, counter +20 in 2 s after a reconnect).
   - The park window's own renderer is a page target. Unlisted, it cost a 2000 ms `resolveTarget` wait per decision in the ordered upstream chain, and Puppeteer's connect hit its protocol timeout. It must be in `appTargetIds`.
2. **Guest popups lose their preferences** when wrapped as `new WebContentsView({ webContents: guest })`. With an existing `webContents` the constructor calls `SetFromDictionary` with the given `webPreferences` (`electron_api_web_contents.cc` `CreateFromWebPreferences`), so an empty set resets them (no preload). `overrideBrowserWindowOptions.webPreferences.preload` alone isn't enough.
   - Passing the tab prefs **with** `partition`: preload works, but the next `new WebContentsView(...)` after that guest closes crashes main with SIGSEGV (bisected: a bare constructor call, any close path).
   - Passing the tab prefs **without** `partition`: preload works, no crash.
3. **All popup kinds took the guest path** (`options.webContents` defined): `<a target=_blank>`, `rel=opener`, `window.open`, and both `target=_blank` forms (disposition `foreground-tab`). Electron delivered the POSTs itself with the right `content-type` (multipart boundary included). The no-guest path was never reached. `window.opener`: null for plain `_blank` and the forms, set for `rel=opener` and `window.open`.
4. **`navigator.webdriver` is `true`** in every page's main world while `remote-debugging-port` is set (Blink's `AutomationControlled`). The preload's patch runs in the isolated world (`contextIsolation: true`) and never reaches the page; the existing `browser-preload.ts` is a no-op there. `app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled")` gives `false`.
5. **Context-scoped commands can't target the tabs' context.**
   - `browserContextId`s: tabs (A, B, popups, created pages) share one context; the app window has another. `Target.getBrowserContexts` returns `[]`.
   - With the tabs' id, `Storage.getCookies`, `Browser.setDownloadBehavior` and `Browser.grantPermissions` fail: `Failed to find browser context for id <id>` (-32602). So the plan's "inject the tabs' id" can't work, and injecting it failed Playwright's `connectOverCDP`.
   - Without an id they act on the app's default session: `Storage.setCookies` landed in the app's jar, `Storage.getCookies` returned it. The same holds on A's **page session** (`Storage.getCookies` there returned the app's cookie; `Storage.clearCookies` there cleared the app's jar).
   - `Network.getAllCookies` / `Network.getCookies` on A's page session read the `persist:browser` jar.
   - Handling chosen and verified with all three clients: `Browser.setDownloadBehavior` → reply `{}`; `Storage.getCookies|setCookies|clearCookies` → `Network.getAllCookies|setCookies|clearBrowserCookies` on the root page over a separate connection; permissions → refused.
6. **`Target.createTarget`** returns `Not supported` from Electron (no ctx, with the tabs' ctx, and `newWindow: true`). Intercepted to a host-created child view, all three clients' `newPage()` work, with two conditions:
   - the reply must wait until the client got the new target's `attachedToTarget` (Playwright reads `_crPages.get(targetId)` right after the reply: `Cannot read properties of undefined (reading '_page')`); it came 1–5 ms after the host returned;
   - the host must finish the `about:blank` load before returning, or the client's first `goto` fails: `interrupted by another navigation to "about:blank"`.
7. **Tab targets.** Electron exposes a `tab` target for every WebContents (A, B, the app window, the park window), in the same context as its page. The mapping method (`attachToTarget { flatten: true }` on the tab, then `setAutoAttach { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }` on its session, first nested `page` attach) answered every time: 10 mappings in the strict runs, 0 null, 1–3 ms, including new tabs paused by Puppeteer's `waitForDebuggerOnStart`.
8. **`webContents.debugger`** attached from main while a remote client is connected breaks neither side (attach, `Runtime.evaluate`, detach; the client's next `evaluate` works).
9. `Browser.close` forwarded (non-strict run) quit the whole app. It must stay refused.

## Method log (strict runs)

Browser level (no `sessionId`):

| Method | Sent by | Decision |
|---|---|---|
| `Browser.getVersion` | Playwright | forward |
| `Browser.setDownloadBehavior` (no `browserContextId`) | Playwright (at connect) | intercept: reply `{}` |
| `Browser.close` | Puppeteer (`browser.close()`) | deny; Puppeteer still disconnects cleanly |
| `Storage.getCookies` (no id) | all | intercept: `Network.getAllCookies` on the root page |
| `Storage.setCookies` (no id) | all | intercept: `Network.setCookies` on the root page |
| `Target.setAutoAttach` (flatten; Puppeteer filter `[{type:page,exclude:true},{}]`) | all | forward |
| `Target.setDiscoverTargets` (filter `[{}]`) | Puppeteer | forward |
| `Target.getBrowserContexts` | Puppeteer | forward (returns `[]`) |
| `Target.getTargetInfo` (no `targetId`) | Playwright | forward |
| `Target.createTarget` | all (`newPage()`) | intercept: openChild, reply held for the attach |
| `Target.closeTarget` | all (`page.close()`) | intercept: host closes the view |

Session level (allowed sessions): `Audits.enable`, `DOM.describeNode`, `DOM.getContentQuads`, `DOM.resolveNode`, `DOM.scrollIntoViewIfNeeded`, `Emulation.setEmulatedMedia`, `Emulation.setFocusEmulationEnabled`, `Input.dispatchKeyEvent`, `Input.dispatchMouseEvent`, `Input.insertText`, `Inspector.enable`, `Log.enable`, `Network.enable`, `Network.getCookies`, `Page.addScriptToEvaluateOnNewDocument`, `Page.captureScreenshot`, `Page.createIsolatedWorld`, `Page.enable`, `Page.getFrameTree`, `Page.getLayoutMetrics`, `Page.navigate`, `Page.setLifecycleEventsEnabled`, `Performance.enable`, `Runtime.addBinding`, `Runtime.callFunctionOn`, `Runtime.enable`, `Runtime.evaluate`, `Runtime.releaseObject`, `Runtime.runIfWaitingForDebugger` (also on Puppeteer's tab sessions), `Target.setAutoAttach` (flatten, on page and tab sessions). All are forwarded and all fall in Section 4's domain allowlist (or rule 2 for `Target`).

Denied at session level: `WebMCP.enable` (Puppeteer, every page session; not a Chromium 130 domain, Puppeteer catches the error).

No client sent `Target.sendMessageToTarget`, a non-flattened attach, `Target.attachToTarget` by id, `Target.attachToBrowserTarget`, `Target.createBrowserContext`, or any permission command during the criteria.

## Raw facts

- **Debug port:** `<userData>/DevToolsActivePort`. Line 1 is the port, line 2 `/devtools/browser/<uuid>`. It exists right after `ready` (first poll). Electron also prints `DevTools listening on ws://127.0.0.1:<port>/devtools/browser/<uuid>` to stderr.
- **`/json/version`:**
  `{"Browser":"Chrome/130.0.6723.191","Protocol-Version":"1.3","User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.191 Electron/33.4.11 Safari/537.36","V8-Version":"13.0.245.25","WebKit-Version":"537.36 (@c1d103c8adf1b8483bccf49fb437be07f2bc170a)","webSocketDebuggerUrl":"ws://127.0.0.1:<port>/devtools/browser/<uuid>"}`
- **Targets** (`Target.getTargets` with filter `[{}]`): one `page` and one `tab` per WebContents. The default filter lists only the pages.
- **The spike set no user agent**, so pages report `Electron/33.4.11`; Section 5's `toChromeUserAgent` handles it.
