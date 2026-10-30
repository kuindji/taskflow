# Section 1: Auth core (token, checks in report-only mode, handshake file, session env)

Read `design.md` §1 first. This section builds every check and every credential path, but serves every request as today: a request that would fail is logged once and then handled. Section 5 turns enforcement on.

Line anchors are against HEAD `3397b225` plus the agent-browser Section 4 work in the tree (CDP gateway, uncommitted when this was written). The browser chain is still moving `server.ts`, `index.ts` and `browser-routes.ts`; find each anchor by the quoted code, not the number.

**Files:**
- Modify `packages/backend/src/config.ts`:
  - generalise the uid writer: `readBackendUid` (`:85-93`) becomes `readSecret(file, isValid)`, and the body of `readOrCreateBackendUid` (`:106-137`) becomes `readOrCreateSecret(file, isValid, mint)`. `readOrCreateBackendUid` keeps its signature and calls it with `/^[0-9a-f]{32}$/` and `randomBytes(16).toString("hex")`. `withFileLock` (`:143-169`) is reused unchanged;
  - add `export function readOrCreateApiToken(baseDir: string, instanceId: string): string`: file `join(baseDir, \`api-token-${instanceId}\`)`, validator `isApiToken`, mint `randomBytes(32).toString("base64url")`. The writer already creates the temp file with mode `0o600` (`:117`), so the token file is `0600`;
  - add a lazy `get apiToken(): string` to `config`, next to `get backendUid()` (`:193-196`), with the same "minted on first read, not at import" rule.
- Create `packages/backend/tests/config/api-token.test.ts`. Same harness as `tests/config/backend-uid.test.ts` (`runWithConfigDir`, temp dirs).
- Create `packages/shared/src/utils/api-token.ts`: `isApiToken`, `PortHandshake`, `parsePortHandshake`. Export it from the barrel (`packages/shared/src/index.ts`, next to `export * from "./utils/backend-host"` at `:36`) and re-export `parsePortHandshake` from `packages/shared/src/remote/index.ts`. Electron main imports runtime values only from `@taskflow/shared/remote` (`electron/src/main.ts:5`; `backend-url.ts:7-9` explains why it avoids the barrel), and that index pulls no barrel.
- Create `packages/shared/src/utils/api-token.test.ts`.
- Modify `packages/shared/src/constants.ts`: add `export const WS_CLOSE_UNAUTHORIZED = 4401;` after `PROTOCOL_VERSION` (`:9`).
- Modify `packages/shared/src/utils/backend-host.ts`: export `isLoopback` (`:22-24`); `auth.ts` reuses it for the Host check.
- Create `packages/backend/src/ws/auth.ts` + `packages/backend/tests/ws/auth.test.ts` (next to `tests/ws/router.test.ts`).
- Modify `packages/backend/src/ws/server.ts`: a required 5th parameter `auth: ServerAuth` on `createServer` (`:16-21`), the gate at the top of `fetch` (`:74`), the protocol answer on both `server.upgrade` calls (`:81`, `:94`), and an `unauthorized` socket kind in `websocket.open/close/message` (`:103`, `:112`, `:121`).
- Modify `packages/backend/src/ws/server.test.ts`: every `createServer(router, 0)` (`:22`, `:119`, `:141`) passes `undefined, undefined, testAuth()`; new tests below.
- Modify `packages/backend/tests/services/cdp/cdp-gateway.test.ts:190`: pass a report-only `ServerAuth` as the 5th argument (compile fix only).
- Modify `packages/backend/src/index.ts`:
  - right after `await ensureCliScript(config.binDir)` (`:82`): `const apiToken = config.apiToken;`, so the file exists from startup on;
  - `createServer(router, config.port, apiRouter, cdpGateway, { token: apiToken, allowedOrigins: parseUiOrigins(process.env.TASKFLOW_UI_ORIGINS), enforce: AUTH_ENFORCED })` (`~:138`);
  - `createSessionLifecycle({ ..., apiToken })` (`~:149`);
  - the handshake write (`await writeFile(config.portFile, String(startedServer.port))`, `~:527`) becomes `await writePortHandshake(config.portFile, startedServer.port, apiToken)`.
- Modify `packages/backend/src/services/instance-port-file.ts`: add `export async function writePortHandshake(file: string, port: number, token: string): Promise<void>`. Same shape as `writeInstancePortFile` (`uniqueSibling` temp, `rename`, `rm` in `finally`), but the temp file is created with `writeFile(temp, \`${port}\n${token}\n\`, { mode: 0o600, flag: "wx" })`. `writeFile`'s `mode` only applies to a new file, so writing the path in place would keep a pre-existing file's `0644` (a hand-set `TASKFLOW_PORT_FILE`, or the predictable `$TMPDIR/.taskflow-port-<pid>` fallback, `config.ts:178`). The rename replaces the path with the fresh `0600` file; if the rename is refused (another user's file in a sticky `/tmp`), startup fails rather than leaking the token. Its test is in Task 1.2.
- Modify the handshake readers to `parsePortHandshake`:
  - `electron/src/backend-manager.ts`: `waitForBackendPort` (`:75-99`) becomes `waitForBackendHandshake`, which returns the parsed handshake; `startBackend` (`:108-147`) resolves to it;
  - `electron/src/main.ts:196-198`: `const { port } = await startBackend(devBranch);`. Section 2 keeps the token;
  - `packages/tui/src/backend/manager.ts`: `readPort` (`:88-100`) becomes `readHandshake` (keep the comment's point: a partial file reads as "not written yet"); `BackendHandle` (`:30-33`) gains `token: string`; `:236` returns `{ port, token, stop }`;
  - `packages/tui/src/backend/manager.test.ts`: every fake backend writes the two-line file (helper below);
  - `packages/tui/src/opentui/machine-session.test.ts:248`: the fake `startBackend` resolves `{ port: 4100, token: TOKEN, stop }` (compile fix);
  - `packages/backend/tests/services/platform.test.ts:107-110`: poll until `parsePortHandshake` returns non-null instead of reading `Number(...)`.
- Modify `packages/backend/src/services/session-lifecycle.ts`: `SessionLifecycleDeps` (`:82-95`) gains `apiToken: string`; `taskflowEnv` (`:541-546`) gains `TASKFLOW_API_TOKEN: apiToken`. Every test that builds the deps adds `apiToken` (`tests/handlers/session.test.ts:153`, `:757`; `src/services/__tests__/session-log-leak.repro.test.ts`).

`ApiRouter` (`api/router.ts`) is not touched. The gate runs in `server.ts` before any routing, so route tests that call `apiRouter.handle` directly stay as they are.

**Interfaces:**
- Consumes: `isLoopback` (`backend-host.ts`), `errorResponse` (`api/routes/response-helpers.ts`), `withFileLock` and the uid writer (`config.ts`).
- Produces:

```ts
// packages/shared/src/utils/api-token.ts
function isApiToken(value: unknown): value is string;        // /^[A-Za-z0-9_-]{43}$/ (32 bytes, base64url, no padding)
interface PortHandshake { port: number; token: string }
function parsePortHandshake(content: string): PortHandshake | null;

// packages/shared/src/constants.ts
const WS_CLOSE_UNAUTHORIZED = 4401;

// packages/backend/src/config.ts
function readOrCreateApiToken(baseDir: string, instanceId: string): string;
config.apiToken: string; // getter

// packages/backend/src/services/instance-port-file.ts
function writePortHandshake(file: string, port: number, token: string): Promise<void>; // fresh 0600 temp + rename

// packages/backend/src/ws/auth.ts
const AUTH_ENFORCED = false;                                  // deleted in Section 5
interface AuthContext { token: string; allowedOrigins: ReadonlySet<string> }
interface ServerAuth extends AuthContext {
    enforce: boolean;                                         // deleted in Section 5
    log?: (line: string) => void;                             // default console.warn; deleted in Section 5
}
type AuthReason = "host" | "origin" | "credential";
type AuthVerdict = { ok: true } | { ok: false; reason: AuthReason };
function parseUiOrigins(raw: string | undefined): Set<string>;
function checkRequest(req: Request, url: URL, ctx: AuthContext): AuthVerdict;
function isUpgradeRequest(req: Request): boolean;
function upgradeHeaders(req: Request): Record<string, string> | undefined;
function createReportOnce(log: (line: string) => void): (reason: AuthReason, req: Request, url: URL) => void;

// packages/backend/src/ws/server.ts
function createServer(router: Router, port: number, apiRouter: ApiRouter | undefined,
    cdpGateway: CdpGateway | undefined, auth: ServerAuth): {...};   // return type unchanged

// session env
TASKFLOW_API_TOKEN=<token>   // next to TASKFLOW_API_URL
```

`AuthReason`, `AuthVerdict` and `AuthContext` are not exported unless a second file needs them. `tokensEqual` stays private until Section 5.

## Behavior

**Token file** (`readOrCreateApiToken`): a valid token in the file is returned. A missing file is minted through the shared writer (temp file mode `0600`, `link`, lock-and-rename repair of an invalid file). Concurrent starts agree on one token. The file persists across restarts; deleting it rotates the token on the next start.

**Handshake file** (`TASKFLOW_PORT_FILE`): `<port>\n<token>\n`, mode `0600`, published by temp file and rename (`writePortHandshake`), so it is `0600` even when the path already existed. `parsePortHandshake`:
- line 1 is digits only, `1..65535`; line 2 passes `isApiToken`; a trailing newline is allowed;
- anything else returns `null`: an empty file, one line, a half-written token, extra text. Readers treat `null` as "not written yet" and keep polling. The rename already makes the write atomic; the `null` rule is the reader's safety net.

**`parseUiOrigins(raw)`**: always contains `file://` and `null`. Each comma-separated entry of `raw` is trimmed and normalised with `new URL(entry).origin`. An entry that doesn't parse, or whose origin is `"null"`, is skipped.

**`checkRequest`**, in this order:
1. **Host.** `req.headers.get("host")`, parsed as `new URL("http://" + host).hostname` with brackets stripped, must pass `isLoopback` (`localhost`, `127.0.0.1`, `::1`). A missing or unparsable Host fails. Reason `host`.
2. **Origin.** If `Origin` is present it must be in `ctx.allowedOrigins`, exact string match. Reason `origin`.
3. **Exempt:** `GET /` that is not an upgrade. It returns `{ ok: true }` (the tunnel readiness probe, `tunnel-manager.ts:79-93`).
4. **Credential.** The candidates are:
   - `Authorization: Bearer <t>` (scheme case-insensitive), on any request;
   - on an upgrade whose `Sec-WebSocket-Protocol` list (comma-separated, trimmed) also contains `taskflow`, each entry that starts with `taskflow.auth.`, minus that prefix. An auth entry without `taskflow` is not a candidate;
   - on `GET` of `/api/file/raw` or `^/api/flow/artifact/[^/]+/[^/]+/[^/]+/raw$`, the `token` query parameter.

   The request passes if any candidate equals `ctx.token` under `tokensEqual`: `timingSafeEqual` on UTF-8 buffers, and `false` without comparing when the lengths differ. No candidate, or none equal: reason `credential`.

**`isUpgradeRequest`**: `req.headers.get("upgrade")?.toLowerCase() === "websocket"`.

**`upgradeHeaders(req)`**: `{ "Sec-WebSocket-Protocol": "taskflow" }` when the offered list contains `taskflow`, otherwise `undefined`. It is sent whether or not the credential passed, because a browser fails a socket that offered protocols and got none back. Answering a protocol the client did not offer fails the handshake (RFC 6455 §4.1), so an auth-only offer gets no `taskflow` answer.

The explicit answer is required. Probed on Bun 1.4.2: with no `headers`, `server.upgrade` answers with the **first** offered protocol itself, so a client offering `taskflow.auth.<t>` first would get its token echoed. With the header set, the response carries exactly one `Sec-WebSocket-Protocol: taskflow`.

**Report-only log** (`createReportOnce`): one line per distinct `(reason, pattern, client)`:
`[auth] report-only: would reject (<reason>) <METHOD> <pattern> from <client>`
- `<METHOD>` is `WS` for an upgrade, otherwise `req.method`;
- `<pattern>` is `/cdp/*` for any path under `/cdp/`; otherwise `/` plus the first two path segments (`/api/tasks/abc/log` gives `/api/tasks`, `/` gives `/`);
- `<client>` is `origin=<Origin>` when the header is present, otherwise `ua=<User-Agent up to the first "/" or space>`, or `ua=none`.

  Examples: `... (credential) WS / from origin=file://`, `... (credential) GET /api/settings from ua=node`, `... (credential) WS / from ua=none` (Bun's `WebSocket` sends no User-Agent).

**`server.ts` `fetch`**, first thing, before the `/cdp/` branch:

```ts
const url = new URL(req.url);
const verdict = checkRequest(req, url, auth);
let unauthorized = false;
if (!verdict.ok) {
    if (!auth.enforce) report(verdict.reason, req, url);
    else if (verdict.reason !== "credential") return errorResponse("Forbidden", 403);
    else if (!isUpgradeRequest(req)) return errorResponse("Unauthorized", 401);
    else unauthorized = true;
}
```

- `report = createReportOnce(auth.log ?? console.warn)`, created once per `createServer` call. Use stderr: the TUI ignores the backend's stdout (`packages/tui/src/backend/manager.ts:122`) and Electron logs both streams.
- When `unauthorized` is set, the request is upgraded with `{ data: { kind: "unauthorized" }, headers: upgradeHeaders(req) }` and `fetch` returns, before any CDP or app upgrade. Host and Origin failures are never upgraded.
- Both existing `server.upgrade` calls (the CDP one and the app one) pass `headers: upgradeHeaders(req)`.
- `SocketData` becomes `AppSocketData | CdpSocketData | { kind: "unauthorized" }`.
  - `open`: an `unauthorized` socket gets `ws.close(WS_CLOSE_UNAUTHORIZED, "unauthorized")` and nothing else. It is never added to `clients`, no connect callback runs and no count is broadcast.
  - `close` and `message`: an `unauthorized` socket returns at once. No message reaches the router or the gateway.
- With `enforce: false` (production in Sections 1–4) the 403/401/4401 branches are never taken; only the log line differs from today.

**Session env:** every PTY session gets `TASKFLOW_API_TOKEN` next to `TASKFLOW_API_URL`, so do agents, shells and dev servers started inside it. Headless agents get the backend's `process.env`, which has no token (`agent-accounts.ts:~107-121`); they don't call the API.

Simplest choices made here:
- Enforcement is injected through `ServerAuth.enforce` rather than read from the constant inside `server.ts`, so the enforced branch is tested now. `index.ts` passes `AUTH_ENFORCED`.
- Host and Origin are checked on `GET /` too; only the credential is exempt there. That's harmless for the probe and keeps one rule.

## Task 1.1: token file

- [ ] **Step 1:** Write `tests/config/api-token.test.ts`:
  - `mints a 43-character base64url token once and returns the same one afterwards`
  - `two instances in one base directory get different tokens`
  - `the token file is mode 0600` (skip on `win32`)
  - `replaces a file that holds no valid token`
  - `backends starting at the same moment agree on one token` (same six-child pattern as `mintConcurrently` in `backend-uid.test.ts`)
  - `importing config writes no token file; reading apiToken mints it`
- [ ] **Step 2:** Run `cd packages/backend && bun test tests/config`. Expected: the new tests FAIL; `backend-uid.test.ts` passes.
- [ ] **Step 3:** Write `packages/shared/src/utils/api-token.ts` (`isApiToken` only for now) and its barrel export. Implement the config changes.
- [ ] **Step 4:** Run `cd packages/backend && bun test tests/config`. Expected: PASS, uid tests included.
- [ ] **Step 5:** Run `bun run typecheck`. Commit `feat(backend): per-instance API token file`.

## Task 1.2: handshake file and its readers

- [ ] **Step 1:** Write `packages/shared/src/utils/api-token.test.ts`:
  - `parses a port line and a token line`
  - `accepts a trailing newline and no trailing newline`
  - `returns null for an empty file, a port alone, and a port with a half-written token`
  - `returns null for a non-numeric, zero or out-of-range port`
  - `returns null when a third non-empty line follows`
  - in `packages/backend/tests/services/instance-port-file.test.ts`: `the handshake replaces a pre-existing 0644 file with a 0600 one` (skip on `win32`)
  - `isApiToken accepts 43 base64url characters and rejects 42, 44, padding and other characters`
- [ ] **Step 2:** In `packages/tui/src/backend/manager.test.ts` add `const TOKEN = "a".repeat(43);` and `function handshake(port: number): string { return \`printf '%s\\n%s\\n' ${port} ${TOKEN} > "$TASKFLOW_PORT_FILE"\`; }`. Replace every `echo <port> > "$TASKFLOW_PORT_FILE"` in the fake backends with `${handshake(<port>)}`; the template strings become backtick strings. Keep the `printf "43x\\n"` case at `:233`, which is still invalid. Add:
  - `resolves with the port and token the backend writes to its handshake file`
  - `a port without its token line is not taken as started`: the fake writes `echo 4335`, sleeps 1 s, then writes the full handshake; expect port 4335 and the token.
- [ ] **Step 3:** In `platform.test.ts:107-110`, poll until `parsePortHandshake(await readFile(portFile, "utf-8"))` is non-null. Assert its port is `> 0`, and that its token equals the trimmed contents of `join(isolated, "api-token-dev-config-isolation-test")`, whose mode is `0o600` (skip the mode check on `win32`).
- [ ] **Step 4:** Run `bun test packages/shared/src/utils/api-token.test.ts packages/tui/src/backend/manager.test.ts packages/backend/tests/services/platform.test.ts packages/backend/tests/services/instance-port-file.test.ts`. Expected: FAIL.
- [ ] **Step 5:** Implement `parsePortHandshake` and both exports; `writePortHandshake` and the backend write in `index.ts`; `waitForBackendHandshake` and `startBackend` in Electron; `main.ts`; `readHandshake` and `BackendHandle.token` in the TUI; the `machine-session.test.ts` fake.
- [ ] **Step 6:** Run the Step 4 tests. Expected: PASS. Run `bun run typecheck`, `cd packages/tui && bun test`, `cd electron && bun run build`.
- [ ] **Step 7:** Commit `feat(shared): two-line port handshake carrying the API token`.

## Task 1.3: request checks in report-only mode

- [ ] **Step 1:** Write `tests/ws/auth.test.ts` against `checkRequest`, with `new Request(...)` objects that set `Host` explicitly. `ctx = { token: T, allowedOrigins: parseUiOrigins("http://localhost:5173") }`, `T = "A".repeat(43)`.
  - `Host 127.0.0.1, localhost and [::1] on any port pass the host check`
  - `Host evil.example and 127.0.0.2 fail with reason host`
  - `a missing Host fails with reason host`
  - `no Origin skips the origin check`
  - `Origin file://, null and an allowlisted dev origin pass`
  - `Origin https://evil.example fails with reason origin, before the credential is looked at`
  - `parseUiOrigins trims, normalises a trailing slash, and skips unparsable entries`
  - `GET / without upgrade headers passes with no credential`
  - `an upgrade to / without a credential fails with reason credential`
  - `a Bearer header with the token passes on HTTP and on an upgrade`
  - `a Bearer header with another token of the same length fails`
  - `a token of a different length fails without throwing`
  - `the taskflow.auth.<token> subprotocol passes an upgrade`
  - `the subprotocol credential is ignored on a plain HTTP request`
  - `token query passes GET /api/file/raw and GET /api/flow/artifact/o/f/t/raw`
  - `token query fails POST /api/file/raw, GET /api/settings and GET /api/flow/artifact/o/f/t`
  - `upgradeHeaders answers taskflow only when taskflow was offered, in either order with the auth entry, and nothing for an auth-only offer`
  - `an auth-only subprotocol offer is not a credential`
  - `createReportOnce logs one line per reason, pattern and client, with the exact format`
  - `report patterns: /api/tasks/abc/log gives /api/tasks, /cdp/x/json/version gives /cdp/*, an upgrade is WS`
- [ ] **Step 2:** Add to `src/ws/server.test.ts`. `testAuth(enforce = false, lines: string[] = [])` returns `{ token: T, allowedOrigins: parseUiOrigins(undefined), enforce, log: (l) => lines.push(l) }`. The `connect` helper takes an optional second `WebSocket` argument (protocols or `{ headers }`). The probe confirmed that Bun's `WebSocket` and `fetch` send a custom `Host` and `Origin`.
  - `report-only: a socket without a credential still connects, counts as a client, and is logged once`
  - `report-only: two identical rejected requests log one line`
  - `report-only: a request from a foreign Origin is served and logged with reason origin`
  - `a client offering taskflow and taskflow.auth.<token> gets protocol "taskflow" and no log line`
  - `a client offering taskflow.auth.<token> first, then taskflow, never gets its token back as the protocol` (assert `ws.protocol === "taskflow"`)
  - `a Bearer header on the upgrade connects with no log line`
  - `GET / answers "Taskflow backend" with no credential and no log line`
  - `enforced: an upgrade without a credential closes with 4401 "unauthorized" and never counts as a client`
  - `enforced: a wrong token in the subprotocol closes with 4401, and the protocol answer is still "taskflow"`
  - `enforced: a message sent on a rejected socket reaches no router handler` (register a handler that records calls)
  - `enforced: HTTP without a credential gets 401 {"error":"Unauthorized"}`
  - `enforced: a foreign Origin gets 403 {"error":"Forbidden"} and is not upgraded`
  - `enforced: Host evil.example gets 403`
  - `enforced: the token query is accepted on GET /api/file/raw` (an `ApiRouter` with one fake route at that path)
- [ ] **Step 3:** Run `cd packages/backend && bun test tests/ws src/ws`. Expected: FAIL.
- [ ] **Step 4:** Implement `auth.ts`, the `server.ts` gate, the socket kind and the `index.ts` wiring. Fix `cdp-gateway.test.ts:190` with a report-only `ServerAuth`.
- [ ] **Step 5:** Run the Step 3 tests and `bun test tests/services/cdp`. Expected: PASS.

## Task 1.4: session env

- [ ] **Step 1:** In `tests/handlers/session.test.ts` pass `apiToken: "test-token"` to both `createSessionLifecycle` calls and add `every spawned session's env carries TASKFLOW_API_TOKEN next to TASKFLOW_API_URL`: create a shell session and assert `spawn.env?.TASKFLOW_API_TOKEN === "test-token"` and that `TASKFLOW_API_URL` is set.
- [ ] **Step 2:** Run it. Expected: FAIL (TypeScript error, or the env is missing the key).
- [ ] **Step 3:** Implement the deps field, the env entry, the `index.ts` argument and the repro-test fixture.
- [ ] **Step 4:** Run `bun run typecheck` and `cd packages/backend && bun test`. Expected: PASS (the platform flake rule applies). Run `bun test packages/shared` and `cd packages/tui && bun test`.
- [ ] **Step 5:** Smoke check in a sandbox (memory: dev backend sandbox): `TASKFLOW_CONFIG_DIR=<scratch> TASKFLOW_DEV=1 TASKFLOW_DEV_PORT=18799 TASKFLOW_PORT_FILE=<scratch>/hs bun src/index.ts` from `packages/backend`.
  - `<scratch>/hs` has two lines, and `ls -l` shows `-rw-------` for it and for `<scratch>/api-token-dev-<branch>`.
  - `curl -s http://127.0.0.1:18799/api/settings` still answers, and stderr shows one `[auth] report-only: would reject (credential) GET /api/settings from ua=curl`. A second identical request adds no line.
  - Record both facts in `handoff.md`.
- [ ] **Step 6:** Commit `feat(backend): report-only request authentication and the session token`. Commit the Task 1.3 and 1.4 changes together.

## Planner decisions (2026-10-30)

- Every PTY session gets `TASKFLOW_API_TOKEN`, as design.md intends. Sessions already run as the user.
- A dev renderer (`http://localhost:5173`) talking to a remote backend gets 403 after enforcement unless that remote sets `TASKFLOW_UI_ORIGINS`. That's documented, not fixed: `localhost:5173` doesn't go into the default allowlist.
