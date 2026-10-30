# Section 4: CDP gateway

Read `handoff.md` first. Section 1 recorded every CDP method the three clients send, along with Electron's `createTarget` behavior. This section's allow/deny table **must** cover that list. If the spike saw a method missing from the table below, decide it by the rule "pass if it only touches the caller's own targets or is read-only browser info; deny otherwise", and list it in the handoff.

**Files:**
- Create: `packages/backend/src/services/cdp/cdp-filter.ts` + `packages/backend/tests/services/cdp/cdp-filter.test.ts`. A pure message filter with no sockets.
- Create: `packages/backend/src/services/cdp/cdp-gateway.ts` + `packages/backend/tests/services/cdp/cdp-gateway.test.ts`. Sockets and lifecycle.
- Modify: `packages/backend/src/ws/server.ts`. Upgrades whose path matches `^/cdp/([^/]+)/devtools/browser$` go to the gateway. `SocketData` becomes `{ kind: "app"; clientId: string } | { kind: "cdp"; tabId: string; connId: string }`. The `websocket` handlers branch on `kind`, and only `app` sockets count as clients and get broadcasts. `createServer` takes an optional `cdpGateway` as a 4th parameter.
- Modify: `packages/backend/src/api/routes/browser-routes.ts`. Add the `/cdp/:tabId/json/version`, `/json/version/`, `/json/list` and `/json` GET routes.
- Modify: `packages/backend/src/index.ts`. Construct the gateway and pass it to `createServer`.

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

**Client → upstream**
- Message carrying a `sessionId` not in `allowedSessions`: reply with an error, don't forward.
- `Target.attachToBrowserTarget`, `Target.createBrowserContext`, `Target.disposeBrowserContext`, `Target.exposeDevToolsProtocol`, `Target.setRemoteLocations`, `Browser.close`, `Browser.crash`, `Browser.crashGpuProcess`: error.
- `Target.attachToTarget`, `Target.activateTarget`, `Target.getTargetInfo` with a `targetId`: forward only if `resolveTarget` maps it to an allowed tab; otherwise error.
- `Target.closeTarget` with an allowed target: call `deps.closeTarget` and reply `{ success: true }`. Never forward it. Otherwise error.
- `Target.createTarget`: call `deps.openChild(params.url ?? "about:blank")`, reply `{ targetId }`, never forward. A `browserContextId` param other than the default context's: error.
- Everything else at browser level (no `sessionId`), and everything on an allowed session: forward. That includes `Target.setAutoAttach`, `setDiscoverTargets`, `getTargets`, `getBrowserContexts`, `Browser.getVersion`, `Browser.setDownloadBehavior`, plus the spike's list.
- Errors use `{ id, error: { code: -32000, message: "Not allowed by Taskflow: <method>" } }`.

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
3. Buffer client messages until upstream is open.
4. `addAgentConnection(tabId, 1)`. It is decremented exactly once on close, whichever side closes first.

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
  - `createTarget calls openChild and replies with its targetId`
  - `closeTarget on T-child calls closeTarget and is not forwarded`
  - `closeTarget on T-other is refused`
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
- [ ] **Step 6:** Run them. Expected: FAIL.
- [ ] **Step 7:** Implement the gateway, the `server.ts` changes and the routes. Wire the gateway in `index.ts`.
- [ ] **Step 8:** Run `bun run typecheck` and `cd packages/backend && bun test`. Expected: PASS.
- [ ] **Step 9:** Commit `feat(backend): filtered CDP gateway for browser tabs`.
