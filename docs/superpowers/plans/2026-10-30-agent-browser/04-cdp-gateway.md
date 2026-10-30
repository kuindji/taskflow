# Section 4: CDP gateway

Read `handoff.md` first. Section 1 recorded every CDP method the three clients send (browser level and session level), Electron's `createTarget` behavior, the tabs' `browserContextId` and the handling of context-scoped commands. This section's tables **must** cover that list. If the spike saw a method missing from the tables below, decide it by the rule "pass if it only touches the caller's own targets or is read-only browser info; deny otherwise", and list it in the handoff.

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
    openChild(url: string): Promise<{ targetId: string }>;        // service.openChild(rootTabId, url)
    closeTarget(targetId: string): Promise<boolean>;
    browserContextId: string | null; // the tabs' context from the spike's facts, read from the root target; null if unknown
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

**State.** The filter keeps `allowedSessions: Map<sessionId, targetId>`.

**Upstream messages are processed strictly in order** (one promise chain). An `attachedToTarget` that waits on `resolveTarget` delays the messages behind it, never reorders them.

**Client → upstream.** Rules apply in this order.
1. A message carrying a `sessionId` not in `allowedSessions`: error, don't forward.
2. **Target domain, at any level** (browser or an allowed session):
   - `Target.sendMessageToTarget`: error. Tunneled messages would bypass every rule here.
   - `Target.attachToTarget` or `Target.setAutoAttach` with `flatten` not `true`: error.
   - `Target.attachToBrowserTarget`, `Target.createBrowserContext`, `Target.disposeBrowserContext`, `Target.exposeDevToolsProtocol`, `Target.setRemoteLocations`: error.
   - `Target.attachToTarget`, `Target.activateTarget`, `Target.getTargetInfo` with a `targetId`: forward only if `resolveTarget` maps it to an allowed tab; otherwise error. `getTargetInfo` without a `targetId` at browser level describes the browser: forward.
   - `Target.closeTarget` with an allowed target: call `deps.closeTarget` and reply `{ success: true }`. Never forward it. Otherwise error.
   - `Target.createTarget`: call `deps.openChild(params.url ?? "about:blank")`, reply `{ targetId }`, never forward. A `browserContextId` param other than the tabs' context: error.
   - `Target.setAutoAttach` (flattened), `setDiscoverTargets`, `getTargets`, `getBrowserContexts`, `detachFromTarget` (for an allowed session): forward.
3. **Context-scoped commands, at any level** (`Browser.setDownloadBehavior`, `Browser.setPermission`, `Browser.grantPermissions`, `Browser.resetPermissions`, `Storage.getCookies`, `Storage.setCookies`, `Storage.clearCookies`, plus any the spike found): handled the way the spike recorded. The default is: when `browserContextId` is missing, set it to `deps.browserContextId`; when it is another context, error. If `deps.browserContextId` is null, error. Chromium's `BrowserHandler` also runs on page sessions (`render_frame_devtools_agent_host.cc`) and picks the default context, the app's, when the id is omitted, so a page session gets no exemption.
4. **The rest of the `Browser` and `SystemInfo` domains, at any level:** forward only `Browser.getVersion`, `Browser.getWindowForTarget` with an allowed `targetId` (or none, on an allowed session), `SystemInfo.getInfo`, plus the spike's recorded methods that pass the rule above. Everything else is an error: `Browser.crash`, `Browser.crashGpuProcess`, `Browser.close`, `Browser.cancelDownload`, `Browser.getHistograms`, `Browser.getBrowserCommandLine`, and any unknown `Browser.*`.
5. **Browser level, everything else** (no `sessionId`): forward only methods on the browser-level allowlist (rules 2–4 plus the spike's recorded browser-level methods that pass the rule above). Everything else is an error, `Tracing.*` included.
6. **On an allowed session, everything else:** forward. Rules 2–4 have already taken every domain that reaches beyond the page.
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
  - `Browser.setPermission on an allowed page session without browserContextId gets the tabs' context injected`
  - `Browser.setPermission on an allowed page session naming another browserContextId is refused`
  - `setDownloadBehavior without browserContextId gets the tabs' context injected`
  - `Storage.getCookies naming another browserContextId is refused`
  - `createTarget calls openChild and replies with its targetId`
  - `closeTarget on T-child calls closeTarget and is not forwarded`
  - `closeTarget on T-other is refused`
  - `createTarget and closeTarget sent on an allowed child session reply with that sessionId`
  - `a refused command on an allowed session replies with that sessionId`
  - `upstream messages keep order while an attach waits on resolveTarget`
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
