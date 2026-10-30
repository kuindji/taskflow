# Section 4: CDP gateway

Read `handoff.md` first, and `spike/results.md` for the method log. Section 1 recorded every CDP method the three clients send (browser level and session level), Electron's `createTarget` behavior, the tabs' `browserContextId` and the handling of context-scoped commands. This section's tables **must** cover that list. If the spike saw a method missing from the tables below, decide it by the rule "pass if it only touches the caller's own targets or is read-only browser info; deny otherwise", and list it in the handoff.

**Files:**
- Create: `packages/backend/src/services/cdp/cdp-filter.ts` + `packages/backend/tests/services/cdp/cdp-filter.test.ts`. A pure message filter with no sockets.
- Create: `packages/backend/src/services/cdp/cdp-gateway.ts` + `packages/backend/tests/services/cdp/cdp-gateway.test.ts`. Sockets and lifecycle.
- Modify: `packages/backend/src/ws/server.ts`. Today every request upgrades, whatever its path (`server.ts:74`). New order in `fetch`:
  1. a path under `/cdp/`: upgrade only when it matches `^/cdp/([^/]+)/devtools/browser$` (to the gateway); a CDP HTTP route goes to the `ApiRouter`; anything else under `/cdp/` gets 404 and is never upgraded;
  2. other paths: today's behaviour. `SocketData` becomes `{ kind: "app"; clientId: string } | { kind: "cdp"; tabId: string; connId: string }`. The `websocket` handlers branch on `kind`, and only `app` sockets count as clients and get broadcasts. `createServer` takes an optional `cdpGateway` as a 4th parameter.
- Modify: `packages/backend/src/api/routes/browser-routes.ts`. Add the `/cdp/:tabId/json/version`, `/json/version/`, `/json/list` and `/json` GET routes. They call the gateway's `versionJson`/`listJson`.
- Modify: `packages/backend/src/api/routes.ts`. Route handlers get their dependencies only through `ApiRouteDeps` (`routes.ts:34`), so add a required `cdpGateway: CdpGateway` there and pass it to the browser routes' registration. Update the route-test fixtures that build `ApiRouteDeps` (Section 3's `browser-routes.test.ts` and any other test that constructs the full deps) with a fake gateway.
- Modify: `packages/backend/src/index.ts`. Construct the gateway right after the browser tab service (before `createServer`, see Section 3). Pass it to `createServer` (WS upgrades) and to `registerApiRoutes` (the `/json` routes).

**Interfaces:**
- Consumes: from `BrowserTabService`: `ensureLoaded`, `resolveTarget`, `familyOf`, `openChild`, `close`, `tabIdForTarget`, `addAgentConnection`, `subscribeTabGone`, `hostAvailable`.
- Produces:

```ts
// cdp-filter.ts
interface CdpMessage {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    sessionId?: string;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
}
interface CdpFilterDeps {
    rootTabId: string;
    isAllowedTab(tabId: string): boolean;                         // familyOf(rootTabId).has(tabId), live
    resolveTarget(targetId: string): Promise<{ tabId: string } | null>;
    pageOfTabTarget(tabTargetId: string): Promise<string | null>; // the page targetId inside a `tab` target; null if none (see "Tab targets")
    openChild(url: string): Promise<{ targetId: string }>;        // service.openChild(rootTabId, url)
    closeTarget(targetId: string): Promise<boolean>;
    runOnRootPage(method: string, params: Record<string, unknown>): Promise<CdpMessage>; // one command on the root tab's page (see "runOnRootPage"); resolves to the reply ({ result } or { error })
    browserContextId: string | null; // the tabs' context, read from the root target; null if unknown
}
interface CdpFilterIo { toClient(m: CdpMessage): void; toUpstream(m: CdpMessage): void }
class CdpTargetFilter {
    constructor(deps: CdpFilterDeps, io: CdpFilterIo);
    fromClient(m: CdpMessage): Promise<void>;
    fromUpstream(m: CdpMessage): Promise<void>;
}

// cdp-gateway.ts
interface CdpGateway {
    open(ws: ServerWebSocket<{ kind: "cdp"; tabId: string; connId: string }>): void;
    message(ws: ServerWebSocket<{ kind: "cdp"; tabId: string; connId: string }>, data: string): void;
    close(ws: ServerWebSocket<{ kind: "cdp"; tabId: string; connId: string }>): void;
    versionJson(tabId: string, host: string): Promise<Record<string, unknown>>; // for the /json routes
    listJson(tabId: string, host: string): Promise<Record<string, unknown>[]>;
}
function createCdpGateway(deps: {
    service: BrowserTabService;
    connectUpstream?: (url: string) => WebSocket; // default: new WebSocket(url)
    fetchJson?: (url: string) => Promise<unknown>;  // default: fetch(...).json()
}): CdpGateway;
```

## Filter rules

**State.** The filter keeps `allowedSessions: Map<sessionId, targetId>`, and `targetTypes: Map<targetId, type>` learned from every upstream `targetInfo` it sees (`targetCreated`, `targetInfoChanged`, `attachedToTarget`, `getTargets` results).

**Tab targets.** Chromium 130 puts each WebContents behind a `tab` target whose id differs from its page's. Puppeteer auto-attaches at browser level with `{ type: "page", exclude: true }` and reaches pages only through each tab session's own `setAutoAttach`. Playwright uses the default filter, which excludes tabs.
- A target whose recorded type is `tab` is decided by its page: `deps.pageOfTabTarget(id)`, then `resolveTarget` on that page id. A `null` page is denied. The decision is cached per tab id for this connection.
- This applies wherever a rule below decides a target: events, `getTargets` results, and commands naming a `targetId`. An id with no recorded type takes the page path.
- `Target.closeTarget` on an allowed tab target calls `deps.closeTarget` with its page id.
- A page attached under an allowed tab session arrives with that outer `sessionId`, so the nested-attach rule below admits it.

**Upstream messages are processed strictly in order** (one promise chain). An `attachedToTarget` that waits on `resolveTarget` delays the messages behind it, never reorders them.

**Client → upstream.** Rules apply in this order.
1. A message carrying a `sessionId` not in `allowedSessions`: error, don't forward.
2. **Target domain, at any level** (browser or an allowed session):
   - `Target.sendMessageToTarget`: error. Tunneled messages would bypass every rule here.
   - `Target.attachToTarget` or `Target.setAutoAttach` with `flatten` not `true`: error.
   - `Target.attachToBrowserTarget`, `Target.createBrowserContext`, `Target.disposeBrowserContext`, `Target.exposeDevToolsProtocol`, `Target.setRemoteLocations`: error.
   - `Target.attachToTarget`, `Target.activateTarget`, `Target.getTargetInfo` with a `targetId`: forward only if `resolveTarget` maps it to an allowed tab; otherwise error. `getTargetInfo` without a `targetId` at browser level describes the browser: forward.
   - `Target.closeTarget` with an allowed target: call `deps.closeTarget` and reply `{ success: true }`. Never forward it. Otherwise error.
   - `Target.createTarget`: call `deps.openChild(params.url ?? "about:blank")`, reply `{ targetId }`, never forward. A `browserContextId` param other than the tabs' context: error. Electron answers a forwarded `createTarget` with `Not supported`, so the intercept is required.
     - **Hold the reply** until the filter has forwarded the new target's browser-level `attachedToTarget` to the client (the page itself, or a `tab` target whose page is it), at most 2000 ms, then reply anyway. Chromium sends the auto-attach before the `createTarget` reply, and Playwright reads the page right after the reply (`crBrowser.ts`: `_crPages.get(targetId)`); an early reply fails `newPage()` with `Cannot read properties of undefined (reading '_page')`. The spike saw the attach 1–5 ms after `openChild` returned.
   - `Target.setAutoAttach` (flattened), `setDiscoverTargets`, `getTargets`, `getBrowserContexts`, `detachFromTarget` (for an allowed session): forward.
3. **Context-scoped commands, at any level** (`Browser.setDownloadBehavior`, `Browser.setPermission`, `Browser.grantPermissions`, `Browser.resetPermissions`, `Storage.getCookies`, `Storage.setCookies`, `Storage.clearCookies`). The spike showed none of them can reach the tabs' context: Electron registers no partition with DevTools (`Target.getBrowserContexts` is `[]`), the tabs' `browserContextId` fails with `Failed to find browser context for id <id>`, and an omitted id acts on the app's default session, at browser level and on page sessions alike. So:
   - a `browserContextId` other than `deps.browserContextId` (or any id when that is null): error;
   - `Browser.setDownloadBehavior`: reply `{}`, never forward. Playwright's `connectOverCDP` sends it at connect and fails the connect on an error. Downloads in hosted tabs are not reported to agents (spec Amendment 11);
   - `Storage.getCookies` / `Storage.setCookies` / `Storage.clearCookies`: run `Network.getAllCookies` / `Network.setCookies { cookies: params.cookies }` / `Network.clearBrowserCookies` through `deps.runOnRootPage` and reply with its `result` (or its `error`). These act on the `persist:browser` jar, inside the boundary of rule 6. Playwright's `context.cookies()`/`addCookies()` and Puppeteer's `browser.cookies()`/`setCookie()` work through this;
   - `Browser.setPermission`, `Browser.grantPermissions`, `Browser.resetPermissions`: error.
4. **The rest of the `Browser` and `SystemInfo` domains, at any level:** forward only `Browser.getVersion`, `Browser.getWindowForTarget` with an allowed `targetId` (or none, on an allowed session), `SystemInfo.getInfo`, plus the spike's recorded methods that pass the rule above. Everything else is an error: `Browser.crash`, `Browser.crashGpuProcess`, `Browser.close`, `Browser.cancelDownload`, `Browser.getHistograms`, `Browser.getBrowserCommandLine`, and any unknown `Browser.*`.
5. **Browser level, everything else** (no `sessionId`): forward only methods on the browser-level allowlist (rules 2–4 plus the spike's recorded browser-level methods that pass the rule above). Everything else is an error, `Tracing.*` included.
6. **On an allowed session, everything else:** a domain allowlist, default deny. Chromium puts browser-reaching handlers on page sessions too (`render_frame_devtools_agent_host.cc`: `TracingHandler` traces the browser and GPU processes, `ServiceWorkerHandler` acts on the whole partition's workers and reports other pages' target ids), so a known `sessionId` proves nothing.
   - **Boundary:** effects inside the shared `persist:browser` partition are accepted (the spec's non-goal "per-task login isolation"), e.g. `Network.clearBrowserCookies`. Effects on the browser or GPU process, the app's own session, or other tasks' live targets are not.
   - **Forwarded domains:** `Accessibility`, `Animation`, `Audits`, `Autofill`, `CSS`, `CacheStorage`, `Console`, `DOM`, `DOMDebugger`, `DOMSnapshot`, `DOMStorage`, `Debugger`, `DeviceAccess`, `DeviceOrientation`, `Emulation`, `EventBreakpoints`, `FedCm`, `Fetch`, `HeapProfiler`, `IO`, `IndexedDB`, `Input`, `Inspector`, `LayerTree`, `Log`, `Media`, `Network`, `Overlay`, `Page`, `Performance`, `PerformanceTimeline`, `Preload`, `Profiler`, `Runtime`, `Schema`, `Security`, `WebAudio`, `WebAuthn`. Plus `Storage.getStorageKeyForFrame`, and the spike's recorded session-level methods that pass the boundary (add each to the table with its reason).
   - **Everything else is an error**, including `Tracing.*`, `ServiceWorker.*`, `Memory.*`, `BackgroundService.*`, `PWA.*`, `Extensions.*`, `Cast.*`, `Tethering.*`, the rest of `Storage.*`, and any unknown domain. Puppeteer's `page.tracing` fails as a result; that is a documented limitation (spec amendment 9).
7. **Replies made by the filter** (intercept results and errors) go through one helper that copies the request's `id` and, when present, its `sessionId`. Clients route replies by `sessionId` (Playwright's `crConnection.ts`), so a reply without it hangs the caller. Errors are `{ id, sessionId?, error: { code: -32000, message: "Not allowed by Taskflow: <method>" } }`.

**Upstream → client**
- Response to `Target.getTargets`: `targetInfos` filtered to allowed targets.
- `Target.targetCreated`, `targetInfoChanged`, `targetDestroyed`, `targetCrashed`: forward only for allowed targets. `targetDestroyed` carries only a `targetId`; use the last known decision for that id.
- `Target.attachedToTarget`:
  - **Without** an outer `sessionId` (browser level): if allowed, add it to `allowedSessions` and forward. If denied: if `waitingForDebugger`, send upstream `{ method: "Runtime.runIfWaitingForDebugger", sessionId }`; then send `Target.detachFromTarget { sessionId }`. Don't forward. Track the ids of these internal commands and swallow their responses.
  - **With** an outer `sessionId` that is allowed (an iframe or worker inside an allowed page): add the child session and forward.
- `Target.detachedFromTarget`: remove the session, then forward if the session was allowed.
- Any other message carrying a `sessionId` not in `allowedSessions`: drop it.

## Gateway rules

**On open**
1. `service.ensureLoaded(tabId)`. On `BrowserTabNotFoundError`, close with code 4404 and reason `Browser tab not found`. On host unavailable, close with code 1011 and the exact unavailable message.
2. Fetch `http://127.0.0.1:<debugPort>/json/version` and connect upstream to its `webSocketDebuggerUrl`.
3. Once upstream is open, send an internal `Target.getTargetInfo { targetId: <root targetId> }` and take `targetInfo.browserContextId` as the filter's `browserContextId`. Swallow its response.
4. Buffer client messages until steps 2 and 3 are done.
5. `addAgentConnection(tabId, 1)`. It is decremented exactly once on close, whichever side closes first.

**On close**
- If the root tab goes away (`subscribeTabGone` fires for `tabId`), or upstream closes, close the client socket with 1001.
- If the client closes, close upstream.

**`versionJson`**
- Ensures the tab is loaded (same errors, as HTTP 404 or 503 in the route).
- Returns the real JSON with `webSocketDebuggerUrl` = `ws://<host>/cdp/<tabId>/devtools/browser`.

**`pageOfTabTarget`** runs on a **separate** short-lived upstream connection to the same `webSocketDebuggerUrl`, never on the client's: the client's upstream is processed strictly in order, and the `attachedToTarget` waiting on the answer would block the messages that carry it. On that connection: `Target.attachToTarget { targetId, flatten: true }`; on the new session `Target.setAutoAttach { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }`; the first nested `attachedToTarget` of type `page` gives the answer; then close the connection. Timeout 2000 ms, then `null`. Use the method the spike recorded if it differs.

**`runOnRootPage`** uses the same kind of separate short-lived upstream connection: `Target.attachToTarget { targetId: <root targetId>, flatten: true }`, then the command on the new session; the command's reply is the answer; then close the connection. Timeout 5000 ms, then `{ error: { code: -32000, message: "Timeout" } }`. The spike measured both helpers at 1–3 ms.

**`listJson`**
- The real `/json/list`, filtered to the family's targets.
- `webSocketDebuggerUrl` and `devtoolsFrontendUrl` are removed (page-level sockets aren't proxied).

## Steps

- [ ] **Step 1:** Write `cdp-filter.test.ts`. A fake io records both directions; fake deps use a fixed family `{root, child}` and targets `T-root`, `T-child`, `T-other` (another task) and `T-app` (app renderer). Tests:
  - `getTargets result lists only family targets`
  - `targetCreated for another task's target is not forwarded`
  - `attachedToTarget for T-app is resumed and detached, never forwarded`
  - `attachedToTarget for T-root is forwarded and its session allowed`
  - `nested attachedToTarget under an allowed session is forwarded`
  - `command on an unknown sessionId is refused with -32000`
  - `attachToTarget T-other is refused with the exact message`
  - `attachToBrowserTarget is refused`
  - `Browser.close is refused`
  - `createBrowserContext is refused`
  - `sendMessageToTarget is refused, even on an allowed session`
  - `attachToTarget with flatten false is refused`
  - `setAutoAttach with flatten false is refused`
  - `attachToTarget T-app sent on an allowed page session is refused`
  - `an unlisted browser-level method (Tracing.start) is refused`
  - `Browser.crash and Browser.crashGpuProcess on an allowed page session are refused`
  - `Browser.close on an allowed page session is refused`
  - `Browser.setPermission on an allowed page session is refused with that sessionId`
  - `Browser.grantPermissions at browser level is refused`
  - `setDownloadBehavior without browserContextId replies {} and is not forwarded`
  - `setDownloadBehavior naming another browserContextId is refused`
  - `Storage.getCookies runs Network.getAllCookies through runOnRootPage and replies with its cookies`
  - `Storage.setCookies runs Network.setCookies with the same cookies; Storage.clearCookies runs Network.clearBrowserCookies`
  - `Storage.getCookies on an allowed page session replies with that sessionId`
  - `Storage.getCookies naming another browserContextId is refused`
  - `a runOnRootPage error is passed back as the reply's error`
  - `Tracing.start on an allowed page session is refused with that sessionId`
  - `ServiceWorker.enable and ServiceWorker.stopAllWorkers on an allowed page session are refused`
  - `Memory.simulatePressureNotification on an allowed page session is refused`
  - `a method of an unknown domain on an allowed session is refused`
  - `Page.navigate and Runtime.evaluate on an allowed session are forwarded`
  - `createTarget calls openChild and replies with its targetId only after the new target's attachedToTarget was forwarded`
  - `createTarget whose target is announced through a family tab target replies after that tab's attach`
  - `createTarget replies after 2000 ms when no attach arrives`
  - `closeTarget on T-child calls closeTarget and is not forwarded`
  - `closeTarget on T-other is refused`
  - `createTarget and closeTarget sent on an allowed child session reply with that sessionId`
  - `a refused command on an allowed session replies with that sessionId`
  - `upstream messages keep order while an attach waits on resolveTarget`
  - `a tab target whose page is in the family: its attachedToTarget is forwarded and its session allowed` (Puppeteer's hierarchy: browser-level auto-attach excludes pages)
  - `a page attached under that allowed tab session is forwarded`
  - `a tab target whose page is T-other or T-app is resumed and detached, never forwarded`
  - `targetCreated and getTargets list a family tab target and drop another task's tab target`
  - `attachToTarget and closeTarget naming a family tab target are allowed; closeTarget closes its page's tab`
  - `responses to internal resume/detach commands are swallowed`
  - one test per extra method from the spike's list that the table denies
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `cdp-filter.ts`.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Write `cdp-gateway.test.ts`:
  - Build a fake upstream as a `Bun.serve` that serves `/json/version` and a WS echoing scripted CDP.
  - Use a fake service; tests drive a real backend `createServer` with the gateway on port 0.
  - Tests:
    - `connect to an unknown tab closes 4404`
    - `connect with no host closes 1011 with the exact message`
    - `connect buffers client messages until upstream opens`
    - `agentConnections goes +1 on open and -1 once on close`
    - `tab-gone for the root closes the client with 1001`
    - `upstream close closes the client`
    - `pageOfTabTarget answers from a separate upstream connection and closes it` (the fake upstream scripts the tab → page auto-attach)
    - `runOnRootPage attaches to the root page on a separate connection, returns the command's reply and closes it`
    - `json/version rewrites webSocketDebuggerUrl to the gateway path using Host`
    - `json/version/ with trailing slash works`
    - `json/list lists only family page targets without debugger urls`
    - `app WS clients still receive broadcasts and cdp sockets do not`
    - `an upgrade to /cdp/<id>/devtools/page/<x> gets 404 and is not an app client`
    - `an unknown GET under /cdp/ gets 404`
- [ ] **Step 6:** Run them. Expected: FAIL.
- [ ] **Step 7:** Implement the gateway, the `server.ts` changes and the routes. Wire the gateway in `index.ts`.
- [ ] **Step 8:** Run `bun run typecheck` and `cd packages/backend && bun test`. Expected: PASS.
- [ ] **Step 9:** Commit `feat(backend): filtered CDP gateway for browser tabs`.
