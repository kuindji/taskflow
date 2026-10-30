# Section 1: Spike (gate)

Throwaway code that proves the hosting and endpoint model before any product code exists. Nothing here ships. The spike files are committed as evidence under `docs/superpowers/plans/2026-10-30-agent-browser/spike/` (prettier/eslint ignore `docs/`; check with `git check-ignore` first and add an eslint ignore entry only if needed).

**Files:**
- Create: `spike/main.cjs`, a plain Electron main script with no build step. Run it with `electron/node_modules/.bin/electron docs/superpowers/plans/2026-10-30-agent-browser/spike/main.cjs`.
- Create: `spike/proxy.ts`, a Bun script. It is the minimal filtering proxy: browser-level WS, target filtering for one allowed target plus its children.
- Create: `spike/client-playwright.mjs`, `spike/client_playwright.py`, `spike/client-puppeteer.mjs`.
- Create: `spike/results.md`

## The spike app (`main.cjs`)

- Before `app.whenReady()`: `app.commandLine.appendSwitch("remote-debugging-port", "0")`, with a throwaway `userData` dir (`app.setPath("userData", <tmp>)`).
- After ready:
  - read `<userData>/DevToolsActivePort` (first line = port);
  - open a `BrowserWindow` (stands in for the Taskflow UI renderer; loads `data:text/html,<h1>app</h1>`);
  - create two `WebContentsView`s in partition `persist:browser`, with `backgroundThrottling: false`: tab A loads a local test page, tab B loads `https://example.com`;
  - attach A to the window at 0,0 800×600; leave B **not added to any window**;
  - for each view, find its `targetId` with `wc.debugger.attach("1.3")`, `sendCommand("Target.getTargetInfo")`, then `detach()`.
- **Popups:** `setWindowOpenHandler` on both views returns `{ action: "allow", createWindow: (options) => { const v = new WebContentsView({ webContents: options.webContents, ...same prefs }); …keep it alive, not in any window…; return v.webContents; } }`. Find the popup's `targetId` the same way.
- Print: the debug port, A's/B's/popup targetIds, and the window renderer's targetId.
- The test page (served from a `data:` URL or a tiny Bun server in `proxy.ts`) has a text input, a button that writes "clicked" into the DOM, `<a target=_blank>`, a button calling `window.open(...)` and checking `window.opener` from the popup, and a `setInterval` counter shown on the page.

## The proxy (`proxy.ts`)

- Listens on `127.0.0.1:9333`. `GET /json/version` returns the real browser's version JSON with `webSocketDebuggerUrl` rewritten to the proxy.
- The WS path `/devtools/browser` connects upstream to the real browser endpoint.
- Allowed = tab A's targetId, plus any target whose `openerId` is allowed.
- **Filtering:**
  - `Target.getTargets` result: allowed targets only.
  - `Target.targetCreated`, `targetInfoChanged`, `targetDestroyed`: allowed targets only.
  - `Target.attachedToTarget` for a denied target: drop it; send `Runtime.runIfWaitingForDebugger` on its session if `waitingForDebugger`, then `Target.detachFromTarget`.
  - Commands carrying a `sessionId` the client was never told about: error.
  - `Target.attachToTarget` with a denied id, `Target.attachToBrowserTarget`, `Target.createBrowserContext`, `Browser.close`: error `Not allowed by Taskflow: <method>`.
  - `Target.createTarget`: tell the spike app over a tiny HTTP side channel to create a child view and return its targetId, **or** pass it through and record what Electron does.
- Log every method the clients send. That log decides Section 4's allow/deny table.

## Criteria (all must pass)

For each of the three clients (Playwright Node via `bunx`, Playwright Python via `uvx --with playwright`, Puppeteer via `bunx`), connecting to `http://127.0.0.1:9333`:

1. The client sees **exactly one page** (A), not B, not the app window.
2. It navigates A, fills the input, clicks the button and reads "clicked".
3. With A **removed from the window** (`win.contentView.removeChildView(A)`), it takes a non-blank screenshot. The interval counter keeps advancing (read it twice, 2 s apart) and the click still works. If a removed view can't screenshot, retry with A parked in a hidden `BrowserWindow` (`show: false`, `paintWhenInitiallyHidden: true`) and record which works.
4. Clicking the `target=_blank` link and the `window.open` button gives the client a new page (`context.on("page")` / `browser.on("targetcreated")`), the popup's `window.opener` is non-null, and the new page is drivable.
5. `browser.close()` / `disconnect()` from the client leaves the app running with A intact.
6. `context.newPage()` (Playwright) / `browser.newPage()` (Puppeteer): record what happens (works via the side channel, works natively, or fails) and with which commands.
7. With `remote-debugging-port=0`, `DevToolsActivePort` exists and is correct.

Also record: Electron's `/json/version` body, and whether attaching `webContents.debugger` while a remote client is connected breaks either side.

## Facts the spike must write into `handoff.md`

- How to read the debug port (file path and format), confirmed.
- How hidden views render: removed from the window, or a parked hidden window.
- Whether `createWindow` with `options.webContents` keeps `window.opener` for `WebContentsView` popups.
- Every CDP method each client sent at connect and during the criteria, with the allow/deny/intercept decision each one needs. Section 4 turns this list into its table.
- How `Target.createTarget` behaves under Electron, and the chosen handling (intercept to `openChild` is the plan's default).
- Anything that contradicts the plan's cross-section interfaces.

## Steps

- [ ] **Step 1:** Write `main.cjs` and `proxy.ts`. Start them. Confirm the printed targetIds and the debug port.
- [ ] **Step 2:** Write the three clients. Each one runs criteria 1–6 and prints PASS/FAIL per criterion.
- [ ] **Step 3:** Run all three. Iterate on the proxy until the criteria pass or a hard blocker is found.
- [ ] **Step 4:** Write `results.md`: a criteria × client table, the method log, the facts above, and the chosen fallbacks.
- [ ] **Step 5:** Commit: `git add docs/superpowers/plans/2026-10-30-agent-browser/spike && git commit -m "docs: agent browser spike and results"`.
- [ ] **Step 6:** Gate (see the plan index). On a fail, record the blocker under **Next step** in `handoff.md`, then stop and notify.
