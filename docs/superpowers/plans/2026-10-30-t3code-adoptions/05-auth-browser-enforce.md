# Section 5: Auth, browser endpoints, then enforcement on

Read `design.md` §1 and Sections 1, 2 and 4 first. Task 5.1 gives the agent-browser endpoints their credential: a per-tab CDP key in the path, and the Electron browser host's backend link through `backendFetch`. Task 5.2 turns enforcement on, deletes report-only mode, and pins with tests that a request with no credential is refused on every route group, every upgrade and every `/cdp/` path.

The agent-browser chain is finished when this runs. Anchors for its code come from its plan and from the gateway work in the tree when this was written (`server.ts:74-100`, `browser-routes.ts`, `services/cdp/cdp-gateway.ts:12-18, :271-277`), so find each by the quoted code.

**Files:**

Task 5.1, CDP key and the backend link:
- Modify `packages/backend/src/ws/auth.ts`:
  - add `export function cdpKey(token: string, tabId: string): string`;
  - `checkRequest` takes the key as a 4th credential on `/cdp/` paths.
- Modify `packages/backend/src/ws/server.ts`, the `/cdp/` branch (`:76-93`):
  - the upgrade regex `^/cdp/([^/]+)/devtools/browser$` becomes `^/cdp/([^/]+)/[^/]+/devtools/browser$`;
  - the JSON-route regex `^/cdp/[^/]+/json(?:/version/?|/list)?$` becomes `^/cdp/[^/]+/[^/]+/json(?:/version/?|/list)?$`.

  The gate (Section 1) has already checked the key before this branch runs, so the branch only routes.
- Modify `packages/backend/src/api/routes/browser-routes.ts`:
  - the four `/cdp/:tabId/json...` routes become `/cdp/:tabId/:key/json/version`, `/cdp/:tabId/:key/json/version/`, `/cdp/:tabId/:key/json/list` and `/cdp/:tabId/:key/json`;
  - `versionJson` gets `params.key`;
  - `endpoint(req, id)` (`:38-41`) appends `/${cdpKeyFor(id)}`;
  - `BrowserRouteDeps` gains `cdpKeyFor: (tabId: string) => string`.
- Modify `packages/backend/src/api/routes.ts`: `ApiRouteDeps` gains `cdpKeyFor: (tabId: string) => string`. Update every test fixture that builds the full deps.
- Modify `packages/backend/src/services/cdp/cdp-gateway.ts`: `versionJson(tabId: string, host: string, key: string)` (interface `:16`, implementation `:271-277`); the rewritten URL is `ws://${host}/cdp/${tabId}/${key}/devtools/browser`. `listJson` is unchanged: it strips the debugger URLs.
- Modify `packages/backend/src/index.ts`: `registerApiRoutes({ ..., cdpKeyFor: (tabId) => cdpKey(apiToken, tabId) })`.
- Modify `packages/backend/src/services/taskflow-cli-browser-commands.md`: the output shape line becomes `{"tab":{"id":…},"endpoint":"http://127.0.0.1:<port>/cdp/<id>/<key>"}`. Add one rule line: `The endpoint is a credential for that tab: don't print it into files or logs others read.`
- Modify the tests that build CDP URLs:
  - `tests/api/browser-routes.test.ts` (`endpoint`, the `/json` routes);
  - `tests/services/cdp/cdp-gateway.test.ts` (every `/cdp/<id>/...` URL gets `cdpKey(TOKEN, id)`, and `createServer`'s 5th argument carries `TOKEN`).
- Modify `electron/src/browser-host/backend-link.ts` + `backend-link.test.ts`:
  - the deps' request function (a fake `fetch` in its tests, per the browser plan's Section 5) becomes `backendFetch: BackendFetch` (`electron/src/backend-fetch.ts`, Section 2);
  - the heartbeat becomes `backendFetch(backendOrigin(getBackendPort()), "/api/browser/host", { method: "PUT", ... })`, and events `backendFetch(<same origin>, "/api/browser/host/events", { method: "POST", ... })`;
  - the queue and retry rules are unchanged.
- Modify `electron/src/browser-host/index.ts` (`initBrowserHost`) and its caller in `electron/src/main.ts`: pass `backendFetch` through.
- Grep first, change only what the grep finds: `grep -rn "/cdp/" packages electron/src --include=*.ts --include=*.tsx --include=*.md --include=*.sh` finds every other builder or parser of CDP paths. The browser plan has none outside the files above.

Task 5.2, enforcement on:
- Modify `packages/backend/src/ws/auth.ts`: delete `AUTH_ENFORCED`, `ServerAuth` (callers use `AuthContext`), `createReportOnce` and its pattern and client helpers.
- Modify `packages/backend/src/ws/server.ts`:
  - the gate becomes: `host`/`origin` → `403`; `credential` on an upgrade → upgrade as `unauthorized` and close `4401`; otherwise `401`;
  - the `report` closure and the `enforce` checks go;
  - the 5th parameter's type becomes `AuthContext`.
- Modify `packages/backend/src/index.ts`: `createServer(router, config.port, apiRouter, cdpGateway, { token: apiToken, allowedOrigins: parseUiOrigins(process.env.TASKFLOW_UI_ORIGINS) })`, with no `AUTH_ENFORCED` import.
- Modify `packages/backend/src/ws/server.test.ts`:
  - delete Section 1's report-only tests:
    - `report-only: a socket without a credential still connects, counts as a client, and is logged once`
    - `report-only: two identical rejected requests log one line`
    - `report-only: a request from a foreign Origin is served and logged with reason origin`
  - drop `enforce` and `log` from `testAuth`;
  - drop the `enforced:` prefix from test names;
  - add the table tests below.
- Modify `packages/backend/tests/ws/auth.test.ts`: delete the `createReportOnce` and pattern tests.
- Modify `tests/services/cdp/cdp-gateway.test.ts`: its `ServerAuth` loses `enforce`/`log`.

**Interfaces:**
- Consumes:
  - Section 1's `checkRequest`, `isUpgradeRequest`, `upgradeHeaders` and `parseUiOrigins`, plus the private `tokensEqual`;
  - Section 2's `BackendFetch`;
  - the browser plan's `CdpGateway`, `BrowserRouteDeps`, `ApiRouteDeps.cdpGateway` and `createBackendLink(deps)`.
- Produces:

```ts
// packages/backend/src/ws/auth.ts
function cdpKey(token: string, tabId: string): string; // base64url(HMAC-SHA256(key = token, data = "cdp:" + tabId)), 43 chars
// after Task 5.2:
interface AuthContext { token: string; allowedOrigins: ReadonlySet<string> }
function createServer(router, port, apiRouter, cdpGateway, auth: AuthContext): {...};

// CDP surface
GET  /cdp/:tabId/:key/json/version  (and /json/version/)
GET  /cdp/:tabId/:key/json/list     (and /json)
WS   /cdp/:tabId/:key/devtools/browser
endpoint = <request origin>/cdp/<tabId>/<key>
CdpGateway.versionJson(tabId: string, host: string, key: string): Promise<Record<string, unknown>>;
```

## Behavior

**CDP key.**
- `cdpKey(token, tabId) = createHmac("sha256", token).update(\`cdp:${tabId}\`).digest("base64url")`.
- A key per tab means a leaked endpoint exposes that tab, not the API and not another tab (design.md §1).
- The key is stable while the token file is, so an endpoint stays valid across backend restarts except for its port.

**Gate on `/cdp/` paths** (`checkRequest`, credential step):
- when the path matches `^/cdp/([^/]+)/([^/]+)(?:/|$)`, the second segment is a candidate, compared by `tokensEqual` against `cdpKey(ctx.token, <first segment>)`;
- the other candidates (Bearer, subprotocol, raw-route `token` query) still count, so a header-capable caller with the API token can reach any tab;
- a path with no key segment (`/cdp/<id>` or the old `/cdp/<id>/json/version`) presents no valid key, so it gets `401`, or `4401` on an upgrade;
- a valid key for another tab id fails, because the HMAC binds the id.

**Routing after the gate** (`server.ts`, unchanged order):
1. `/cdp/<id>/<key>/devtools/browser` upgrades to the gateway with `tabId = <id>`.
2. Any other upgrade under `/cdp/` gets `404`.
3. The four JSON routes go to the `ApiRouter`.
4. Anything else under `/cdp/` gets `404`.

The gate runs first, so an unauthenticated `/cdp/` request is `401` before it can learn whether the path exists.

**Rewritten URLs.**
- `versionJson` returns `webSocketDebuggerUrl = ws://<Host>/cdp/<tabId>/<key>/devtools/browser`, so Playwright and Puppeteer dial the keyed path without any client option.
- `endpoint` in `POST`/`GET /api/browser/tabs` is `http(s)://<Host>/cdp/<tabId>/<key>`, built from the `Host` header as today. Section 1's Host check has already limited `Host` to loopback names.

**Backend link.** Every heartbeat and event goes through `backendFetch` with the local origin, so it carries `Authorization: Bearer <local token>`. That closes the hole where any local process could `PUT /api/browser/host` with a `controlUrl` and `debugPort` of its own choice (research-6 §3).

**Enforcement (Task 5.2).** The rules of design.md §1, with no report-only path left:
- **Host** not loopback: `403 {"error":"Forbidden"}`, never upgraded.
- **Origin** present and not allowed: `403 {"error":"Forbidden"}`, never upgraded.
- **`GET /`** with no upgrade: `200 "Taskflow backend"`, the only request that needs no credential.
- **No valid credential**:
  - HTTP gets `401 {"error":"Unauthorized"}`. This covers any path, including unknown ones: an unknown path no longer falls through to the `200 "Taskflow backend"` fallback;
  - an upgrade, to `/` or under `/cdp/`, completes and then closes with `4401` `unauthorized`. The socket never joins `clients`, never reaches the gateway, and no message reaches the router.

## Task 5.1: CDP key and backend link

- [ ] **Step 1:** Tests:
  - `tests/ws/auth.test.ts`:
    - `cdpKey is the base64url HMAC-SHA256 of "cdp:<tabId>" keyed by the token` (compare with `createHmac` computed in the test)
    - `a /cdp/<id>/<key>/json/version request with the right key passes`
    - `a key for another tab id fails`
    - `a /cdp/<id>/json/version request without a key segment fails`
    - `a /cdp/ upgrade with the right key passes`
  - `browser-routes.test.ts`:
    - `POST returns an endpoint ending in /cdp/<id>/<key>` (the fake `cdpKeyFor` returns `key-<id>`)
    - `GET lists each tab's keyed endpoint`
    - `json/version passes the path key to the gateway`
  - `cdp-gateway.test.ts`:
    - `json/version rewrites webSocketDebuggerUrl to the keyed gateway path using Host`
    - the existing connect tests use keyed URLs
    - `an upgrade to /cdp/<id>/<key>/devtools/page/<x> gets 404 and is not an app client`
  - `backend-link.test.ts`: the fake becomes a recording `backendFetch`:
    - `heartbeat goes through backendFetch with the local origin and /api/browser/host`
    - `events go through backendFetch to /api/browser/host/events`
    - the existing queue and retry tests keep their assertions on the new fake
- [ ] **Step 2:** Run `cd packages/backend && bun test tests/ws tests/api/browser-routes.test.ts tests/services/cdp` and `bun test electron/src/browser-host/backend-link.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `cdpKey` and the gate rule, the `server.ts` regexes, the routes, the gateway signature, `index.ts`, the command doc, and `backend-link.ts`/`index.ts`/`main.ts` in Electron.
- [ ] **Step 4:** Run the Step 2 tests, `cd packages/backend && bun test`, `bun run typecheck`, `cd electron && bun run build`. Expected: PASS.
- [ ] **Step 5:** Smoke check in a sandbox (report-only is still on):
  - start the dev app with `TASKFLOW_CONFIG_DIR=<scratch>`;
  - from a task session, `taskflow-cli browser open "https://example.com"` prints an endpoint ending `/cdp/<id>/<key>`;
  - `curl <endpoint>/json/version` shows `webSocketDebuggerUrl` with the same `/<key>/` segment;
  - a scratch Playwright `chromium.connectOverCDP(endpoint)` (browser handoff: scratch install, `bunx`/`uv run`) lists the tab's page;
  - the backend's stderr has no `[auth] report-only` line with pattern `/cdp/*`, and none from the browser host (`PUT /api/browser`).

  Record the results in `handoff.md`.
- [ ] **Step 6:** Commit `feat(backend): per-tab CDP key in gateway paths and an authenticated browser host link`.

## Task 5.2: enforcement on

- [ ] **Step 1: gate check.** Exercise every client once against a sandbox backend before changing code: the Electron app (local plus one remote), the plain-browser dev UI, the TUI (local, a saved machine, `--connect --token`), both CLIs, a browser tab driven by Playwright, and the tray and notifications. Then read the backend's stderr, and the remote's. Expected: **no** `[auth] report-only` line. Any line names its client (`from ...`). Fix that client in the section that owns it before going on, or stop and notify if it can't be fixed without a design change.
- [ ] **Step 2:** Tests in `src/ws/server.test.ts`. The fixture is an `ApiRouter` with one recording handler for every row below, plus a fake `CdpGateway` whose `open` records calls.
  - `every route group refuses a request with no credential`, table-driven. Each row expects `401 {"error":"Unauthorized"}` and its handler never called:
    - session: `POST /api/sessions`, `POST /api/sessions/s1/input`
    - task: `PATCH /api/tasks/t1/worktree`, `GET /api/tasks/archived`
    - project: `DELETE /api/projects/p1`, `GET /api/projects`
    - flow: `POST /api/flow/artifact`, `GET /api/flow/artifact/o/f/t/raw`
    - schedule: `POST /api/schedules/x/trigger`
    - settings: `GET /api/settings`, `PATCH /api/settings`, `GET /api/cli-help`, `GET /api/tray-state`
    - notification: `GET /api/notifications`
    - dev server: `GET /api/dev-servers`
    - attribute: `GET /api/tasks/t1/attributes`
    - file: `GET /api/file/raw?path=/etc/hosts`
    - browser: `POST /api/browser/tabs`, `PUT /api/browser/host`, `POST /api/browser/host/events`
    - CDP: `GET /cdp/tab1/json/version`, `GET /cdp/tab1/wrong-key/json/version`, `GET /cdp/tab1/<cdpKey(T, "tab2")>/json/list`
    - unknown: `GET /nothing-here`
  - `the same requests with Authorization: Bearer <token> reach their handlers`
  - `a text/plain cross-site POST with Origin https://evil.example gets 403 and its handler is not called` (`POST /api/flow/artifact`, the arbitrary-file-read vector from design.md §1)
  - `GET /api/file/raw?token=<token> reaches its handler; the same token query on GET /api/settings gets 401`
  - `GET / with no credential still answers "Taskflow backend"`
  - `an upgrade to / with no credential closes 4401 and the client count stays 0`
  - `an upgrade to / with a wrong subprotocol token closes 4401`
  - `an upgrade to /cdp/tab1/wrong-key/devtools/browser closes 4401 and the gateway's open is never called`
  - `an upgrade to /cdp/tab1/<cdpKey(T, "tab1")>/devtools/browser reaches the gateway`
  - `a foreign Origin on an upgrade gets 403 and no socket`
- [ ] **Step 3:** Run `cd packages/backend && bun test src/ws tests/ws`. Expected: the new tests FAIL, because report-only serves the requests.
- [ ] **Step 4:** Delete the constant, the report-only branch and its helpers; switch `createServer` to `AuthContext`; update `index.ts` and the test fixtures.
- [ ] **Step 5:** Run `cd packages/backend && bun test`, `bun test packages/shared/src`, `cd packages/tui && bun test`, `bun test electron/src`, each UI test file touched by Sections 2 and 4 on its own, and `bun run typecheck`. Expected: PASS.
- [ ] **Step 6:** Live check, sandbox, enforcement on. Record each result in `handoff.md`:
  1. `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/api/settings` gives `401`; with `-H "Authorization: Bearer $(cat <scratch>/api-token-<id>)"` it gives `200`.
  2. `curl -s http://127.0.0.1:<port>/` gives `Taskflow backend`.
  3. `curl -s -H 'Host: evil.example' http://127.0.0.1:<port>/api/settings` gives `403`.
  4. Run these inside a web page (`https://example.com`) in a hosted browser tab, through the item 6 Playwright connection's `page.evaluate`:
     - `fetch("http://127.0.0.1:<port>/api/flow/artifact", { method: "POST", body: "{}" }).then(r => r.status, () => "blocked")` gives `403` or `"blocked"`, never `200`/`400`;
     - `new WebSocket("ws://127.0.0.1:<port>")` never fires `open`.
  5. The desktop app, the TUI, both CLIs and the dev UI all work. Opening a markdown file with a local image shows the image.
  6. Playwright through the CDP endpoint still works. The same endpoint with its key segment changed gets `401`.
  7. Remote: delete the remote's `api-token-<id>` and restart it. The desktop and the TUI reconnect after one refresh with no user action. Then give a record a wrong manual token (add form) on a remote whose token can't be read (`TASKFLOW_CONFIG_DIR` set there): the machine shows `Remote backend rejected the access token` and stops retrying.
  8. The tray icon and desktop notifications still follow a remote machine's state.
- [ ] **Step 7:** Commit `feat(backend): enforce API authentication`.

## Planner decisions (2026-10-30)

- The CDP endpoint is a credential for its tab, and agents may print it into session logs. That's accepted. Add one line to the `browser` command doc: `The endpoint grants control of this tab; don't share it outside this machine.`
- The API token is also accepted on `/cdp/` paths, next to the per-tab key. Kept.
- Old clients get `401`/`4401` after enforcement, with no explanation. No `PROTOCOL_VERSION` bump. Section 5 adds a line to `handoff.md` for the release notes: `Clients older than this release can't connect; update every machine.`
- A dev UI against a remote: see Section 1's decisions.
