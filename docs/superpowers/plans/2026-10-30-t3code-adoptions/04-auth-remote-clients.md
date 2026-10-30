# Section 4: Auth, remote clients (token over ssh, `4401` refresh, `--token`, manual entry)

Read `design.md` §1 and §2, then Sections 1–3. Enforcement is still off. After this section:
- every remote backend record carries its token;
- every client that reaches a remote sends it;
- a `4401` gets exactly one token re-read, and a second one shows `Remote backend rejected the access token`.

**Depends on Section 3** (`03-remote-connectivity.md`, drafted in parallel). The rest of this section assumes the contract under "Consumes from Section 3". Where Section 3's names differ, use Section 3's names; the rules here stay.

Anchors are against HEAD `3397b225`. Section 3 changes `tunnel-args.ts`, `tunnel-manager.ts`, `machine-session.ts` (`:399-468`) and the desktop tunnel-exit path (`backend-store.ts:578-587`), so find code by its landmarks.

**Files:**

Task 4.1, shared:
- Modify `packages/shared/src/types/backend.ts`:
  - `BackendRecord` (`:29-45`) gains `token: string | null`, the backend's API token, or null when none is known yet;
  - `TunnelFailureKind` (`:61-71`) gains `"unauthorized"`.
- Create `packages/shared/src/utils/backend-auth.ts` + `backend-auth.test.ts`, exported from the barrel next to Section 1's `api-token`. The renderer can't import `@taskflow/shared/remote` (it pulls `node:child_process`), so this lives under `utils/`.
- Modify `packages/shared/src/remote/backend-records.ts`:
  - `normalizeRecords` (`:15-58`) reads `token: isApiToken(entry.token) ? entry.token : null`;
  - `adoptUid` merge (`:96-104`) keeps `token: source.token ?? existing.token`;
  - `recordFromDiscovered` (`~:112`) sets `token: null`.
- `packages/shared/src/remote/tunnel-args.ts`: no change. Section 3 defines `buildRemoteReadArgs(record, fileName)`, which runs `cat ~/.config/taskflow/'<fileName>'` with the port read's options; the token read reuses it.
- Modify `packages/shared/src/remote/tunnel-manager.ts`:
  - new `readRemoteToken(record)` with the same `isSafeLabel` guard, `runSsh(buildRemoteReadArgs(record, \`api-token-${record.instanceId}\`))` and the failure rules below;
  - returned from `createTunnelManager` next to `readRemotePort` (`:609`).
- Modify `packages/shared/src/remote/backend-registry.ts`:
  - `RegistryDeps` (`:22-35`) gains `readRemoteToken`;
  - `AddBackendInput` (`:37-43`) gains `token?: string`;
  - `persist` (`:94-104`) writes a unique temp file (`${deps.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`, the naming of `uniqueSibling` in `packages/backend/src/services/instance-port-file.ts:5`, which shared can't import) with `{ mode: 0o600, flag: "wx" }`, renames it, and removes it in `finally`;
  - `addBackend` (`:241-275`) validates and stores the token;
  - `attachBackend` (`:307-347`) reads a missing token and returns it;
  - add `refreshToken(id)`;
  - `attached()` (`:236-238`) returns each record's token;
  - `BackendPatch` (`:45`) gains `token?: string | null`; `updateBackend` (`:438`) validates a string with `isApiToken` (else `{ ok: false, reason: "That access token is not valid." }`), stores it, or clears it on `null`.
- Wire `readRemoteToken: tunnels.readRemoteToken` into both registries: `electron/src/main.ts:127-137` and `packages/tui/src/remote/machines.ts:46-55`.
- Fixtures: every `BackendRecord` literal in tests gains `token: null` (`tunnel-manager.test.ts:31-42`, `tunnel-args.test.ts`, `backend-records.test.ts`, `backend-registry.test.ts`, `machine-session.test.ts`; `grep -rl lastKnownPort packages --include=*.test.ts`). The registry test harness (`backend-registry.test.ts:44-58`) gets `readRemoteToken: async () => ({ token: TOKEN })`.

Task 4.2, Electron and renderer:
- `electron/src/attached-backends.ts`: no change. Section 2 already reads `entry.token`, and `registry.attached()` now fills it, so `backendFetch` authenticates the tray (`tray-manager.ts:164-180`), notification and artifact calls against every attached origin.
- Modify `electron/src/ipc-handlers.ts` (`registerBackendHandlers`, `:301-399`):
  - `refresh-backend-token` (id): `LOCAL_BACKEND_ID` answers `{ ok: false }`; otherwise `registry.refreshToken(id)`, mapped to `{ ok: true } | { ok: false }`;
  - `get-local-api-token`: `deps.getBackendToken()`;
  - the `add-backend` input type (`:355-367`) gains `token?: string`.
- Modify `electron/src/preload.ts` (the backend bridge entries next to `attachBackend`): `refreshBackendToken(id)` and `getLocalApiToken()`.
- Modify `packages/ui/src/env.d.ts:83-114`: `refreshBackendToken(id: string): Promise<{ ok: boolean }>`, `getLocalApiToken(): Promise<string | null>`, and `addBackend` input `token?: string`.
- Modify `packages/ui/src/lib/connection.ts`: `socket.onclose` (`:114-122`) handles code `WS_CLOSE_UNAUTHORIZED`, and an `unauthorized` flag makes later requests reject with `BackendUnauthorizedError` (below). No new hook and no registry listener: every `4401` lands on a handshake (see "Desktop" below).
- Modify `packages/ui/src/stores/backend-store.ts`:
  - `handshake` (`:148-167`) answers `"unauthorized"` instead of patching when the error is a `BackendUnauthorizedError`;
  - one private `recoverUnauthorized(id, attempt)`, called from both `attach` (`:209-...`) and `rehandshake` (`:419-432`) when `handshake` answers `"unauthorized"`;
  - one module-level `createTokenRefreshGate()`.
- Modify `packages/ui/src/stores/fake-desktop-bridge.ts`: add `refreshBackendToken` to `FakeMain` and to `bridge`, recording ids in `main.refreshed: string[]`.
- Modify `electron/src/ipc-handlers.ts` `update-backend` (`:376`) and `packages/ui/src/env.d.ts` `updateBackend` (`:102`): the patch type gains `token?: string | null`.
- Modify `packages/ui/src/components/sidebar/ManageBackendsDialog.tsx`: the edit form (`:57-61`) gets an "Access token" field (same attributes as the connect dialog), sent as `token` only when the user changed it; an emptied field sends `null`. After a save that changed the token answers `ok`, when the machine's row has `failure?.kind === "unauthorized"` and `keepAttached`, call `useBackendStore.getState().retry(entry.id)`: `refresh` keeps the row's failure (`backend-store.ts:342`), so the save alone would leave it offline and unwanted. `retry`'s `attach` clears the failure (`:212`), which makes it wanted again. Extend `ManageBackendsDialog.test.tsx`.
- Modify `packages/ui/src/components/sidebar/ConnectBackendDialog.tsx`: an "Access token" field under "Backend port" (`:119-128`), passed as `token: token.trim() || undefined` in `addBackend` (`:56-61`).
- Create `packages/ui/src/components/settings/sections/AccessTokenRow.tsx` + `AccessTokenRow.test.tsx` (style of `AgentAccountsSection.test.tsx`: `createRoot`, `act`). Render it in `GeneralSection` (`sections/GeneralSection.tsx`), right under the "Discoverable on this network" row (see "Planner decisions"). It reuses `SettingRow` and `CopyButton` (`components/ui/copy-button.tsx`).

Task 4.3, TUI:
- Modify `packages/tui/src/net/client.ts`:
  - 4401 handling;
  - `wasUnauthorized(): boolean`;
  - `retarget(port, host, token)` (`:60-66`) takes the token.
- Modify `packages/tui/src/remote/connect.ts`:
  - `MachineClient` (`:14-20`) gains `wasUnauthorized(): boolean`, and `retarget` takes `(port, host, token: string | null)`;
  - `ConnectDeps.createClient(port, host, token)` (`:28-34`);
  - `RegistryPort` (`:7`) adds `"refreshToken"`;
  - `connectMachine` (`:56-134`) runs the refresh rule.
- Modify `packages/tui/src/opentui/machine-session.ts`:
  - `SessionRegistry` (`:18-31`) adds `"refreshToken"`;
  - `reconcile` (`:374-389`) handles an unauthorized drop;
  - `reattachOnce` (`:410-448`) retargets with the attach's token;
  - `connectLocal` (`:544-560`) maps the local error.
- Modify `packages/tui/src/cli.ts`: `--token <t>` / `--token=<t>`, falling back to `env.TASKFLOW_TOKEN`; `CliOptions.connect` becomes `{ host; port; token: string | null }`; `parseArgs(argv, env = process.env)`.
- Modify `packages/tui/src/opentui/entry.ts:60-79`: `new WsClient(port, host, options.connect.token)`, then a handshake check before `openWorkspace`.
- Modify `packages/tui/src/opentui/machine-picker.ts`:
  - `AddMachineInput` (`:16-21`) gains `token?: string`;
  - `AddField` and `ADD_FIELDS` (`:36-43`) gain `{ field: "token", label: "Access token" }` after "Backend port";
  - empty means "not given".
- Tests: `client.test.ts`, `connect.test.ts` (`FakeClient` gains `wasUnauthorized`, a `token` constructor argument and a scripted unauthorized flag), `machine-session.test.ts`, `cli.test.ts` (the existing `toEqual` connect targets gain `token: null`), `machine-picker.test.ts:137-148`.

**Interfaces:**
- Consumes from Section 1: `isApiToken`, `WS_CLOSE_UNAUTHORIZED`, the token file name `api-token-<instanceId>`.
- Consumes from Section 2: `BackendFetch`, `AttachedBackend.token`, `AttachResult.token?`, `openConnection(id, origin, token)`, `getBackendToken()`, the `WsClient` token parameter.
- **Consumes from Section 3** (see Planner decision 1 for how this section hooks in):
  - `createReconnectPolicy` (`packages/shared/src/remote/reconnect-policy.ts`), run by the TUI machine session, and `createBackendReconnects` (`packages/ui/src/lib/backend-reconnect.ts`) on the desktop;
  - `buildRemoteReadArgs(record, fileName)` in `tunnel-args.ts`.

  This section adds one rule: **a token rejected after its one refresh stops the loop**, and the machine shows `Remote backend rejected the access token`. Every other failure, `no-backend` included, keeps retrying (design.md §2).
- Produces:

```ts
// packages/shared/src/utils/backend-auth.ts
const ACCESS_TOKEN_REJECTED = "Remote backend rejected the access token";
const LOCAL_ACCESS_TOKEN_REJECTED = "The local backend rejected the access token";
class BackendUnauthorizedError extends Error {}   // message "Unauthorized", name "BackendUnauthorizedError"
function unauthorizedFailure(local: boolean): TunnelFailure; // { kind: "unauthorized", message: <one of the two>, stderr: "" }
interface TokenRefreshGate {
    unauthorized(id: string): "refresh" | "reject"; // "refresh" once per id until authenticated(id)
    authenticated(id: string): void;
}
function createTokenRefreshGate(): TokenRefreshGate;

// tunnel-manager / RegistryDeps
readRemoteToken(record: BackendRecord): Promise<{ token: string } | { failure: TunnelFailure }>;

// backend-registry
attachBackend(id): Promise<{ ok: true; origin: string; token?: string } | { ok: false; failure: TunnelFailure }>;
refreshToken(id: string): Promise<{ ok: true; token: string } | { ok: false; failure: TunnelFailure }>;
attached(): { id: string; origin: string; token?: string }[];
addBackend(input: { host; user?; sshPort?; port?; instanceId?; token?: string }): Promise<BackendRecord>;
updateBackend(id, patch: { displayName?; user?; sshPort?; token?: string | null }): Promise<{ ok: boolean; reason?: string }>;

// IPC (main ⇄ renderer)
"refresh-backend-token"(id) -> { ok: boolean }
"get-local-api-token"() -> string | null

// packages/tui/src/net/client.ts
retarget(port: number, host: string | null, token: string | null): void;
wasUnauthorized(): boolean;

// packages/tui/src/cli.ts
interface CliOptions { connect: { host: string; port: number; token: string | null } | null; machine: string | null }
function parseArgs(argv: string[], env?: { TASKFLOW_TOKEN?: string }): CliOptions;
```

## Behavior

**Reading the token over ssh** (`readRemoteToken`). The argv is `buildRemoteReadArgs(record, "api-token-<instanceId>")`: the port read's exact argv, host-key and multiplexing options included, with the remote command `cat ~/.config/taskflow/'api-token-<instanceId>'`. Results:
- stdout, trimmed, passes `isApiToken`: `{ token }`;
- `code` neither `255` nor `null` (connected, `cat` failed): `{ failure: { kind: "no-backend", message: "Could not read Taskflow's access token on <host>. Enter it in the connect dialog.", stderr } }`;
- `cat` succeeded but the content is not a token: `{ failure: { kind: "unknown", message: "Taskflow's access token on <host> is not valid.", stderr: "" } }`;
- otherwise `{ failure: classifyTunnelFailure(stderr, code) }`, as the port read does.

**Registry**
- `addBackend`: a given `token` must pass `isApiToken`, otherwise it rejects with `That access token is not valid.`. An empty string counts as not given. The record stores `token ?? null`.
- `attachBackend`, after the tunnel opened and the record was re-read (`:330-336`):
  - when `current.token === null`, call `deps.readRemoteToken(current)` once and keep the token on success;
  - a failed read never fails the attach. The client dials without a token, which report-only accepts and enforcement turns into `4401`, handled below;
  - the upserted record carries the token, and the result is `{ ok: true, origin, token }`, with `token` omitted when null.

  Records with a token never trigger a read, so beacon and remembered-port attaches add an ssh call only on their first attach.
- `refreshToken(id)` (through `serializeCanonical`):
  - read the token again;
  - on success store it (`upsertRecord`, `persist`, `notifyChanged`) and return `{ ok: true, token }`;
  - on failure leave the record alone and return the failure;
  - a missing record gives `{ ok: false, failure: unknownFailure("No such backend") }`.
- `attached()` returns `{ id, origin, token }` for each live origin, with the token from its record and omitted when null.
- `persist` writes mode `0600`: the file now holds secrets. Today's temp path is fixed (`backends.json.tmp`, `backend-registry.ts:96`), and an interrupted write can leave one behind with `0644`; `writeFile`'s `mode` doesn't apply to an existing file, so the token-bearing write would rename a `0644` file into place. A unique temp name created with `flag: "wx"` is always new, so `rename` publishes a `0600` file. A stale legacy `backends.json.tmp` is then never written again.

**`createTokenRefreshGate`**
- `unauthorized(id)` returns `"refresh"` the first time for an id, and `"reject"` on every call after that until `authenticated(id)`.
- `authenticated(id)` forgets the id.

**Renderer `Connection` on close code `4401`** (`event.code === WS_CLOSE_UNAUTHORIZED`):
- the server upgrades before it closes, so `open()` has normally resolved already. A still-waiting `open()` (`fail`) and every pending request reject with `new BackendUnauthorizedError()`;
- `this.unauthorized = true`: until the next successful open, `request()` rejects at once with `new BackendUnauthorizedError()` instead of a generic not-connected error. That covers a handshake request sent just after the close;
- status becomes `{ connected: false, reconnecting: false }`;
- **no** `scheduleReconnect`: retrying with the same token can't succeed.

Every other close is handled as today.

**Desktop `recoverUnauthorized(id, attempt)`**, called by `attach` and by `rehandshake` when `handshake` answers `"unauthorized"` (or `openConnection` rejected with `BackendUnauthorizedError`). It returns at once unless `attempts.get(id) === attempt` and the machine is still wanted (its row's `keepAttached`), and checks both again after every await. It does not look at the row's `state`: `followSocket` has already patched it `offline` by then (`backend-store.ts:473-476`).
- `id === LOCAL_BACKEND_ID`: `drop(id)`, `patch(id, { state: "offline", failure: unauthorizedFailure(true) })`, return `null`.
- Otherwise ask `gate.unauthorized(id)`:
  - `"refresh"`: `await bridge().refreshBackendToken(id)` (the result doesn't matter: a failed read leaves the old token, and the second `4401` decides), then `drop(id)` and `return useBackendStore.getState().attach(id)`. The new attach bumps the attempt and dials with whatever token main now holds.
  - `"reject"`: `drop(id)`, `patch(id, { state: "offline", failure: unauthorizedFailure(false) })`, return `null`.
- A handshake that succeeds calls `gate.authenticated(id)` (and `gate.authenticated(liveId)` after a rename). A socket open alone never does.

**Desktop, a `4401` on a connection that was already attached** (the remote restarted with a new token): the `Connection` redials by itself, the upgrade opens, `followSocket` sees `connected` and runs `rehandshake`, whose `SYSTEM_INFO` rejects with `BackendUnauthorizedError` when the `4401` close arrives. `rehandshake` then calls `recoverUnauthorized`, so one refresh happens, then a reject. No separate listener is needed.

**Desktop reconnect loop** (Section 3): an attempt whose row ends with `failure.kind === "unauthorized"` stops the loop. Any other failure, `no-backend` included, keeps retrying (design.md §2).

**TUI `WsClient` on close code `4401`**: the same as the renderer:
- `settle(new BackendUnauthorizedError())` (normally a no-op: `onopen` has already settled `connect()`) and `failPending(new BackendUnauthorizedError())`; a `request()` made while the flag is set rejects with `BackendUnauthorizedError`;
- `this.unauthorized = true`;
- no `scheduleReconnect`;
- `setStatus(false)`.

`wasUnauthorized()` reports the flag. A successful open clears it. `retarget(port, host, token)` sets all three. When the client is unauthorized, it also clears the flag and calls `scheduleReconnect()` (`retarget` returns early today when `ws === null`, `:63`; after a `4401` it must redial).

**TUI `connectMachine`**, around `client.connect()` and the `SYSTEM_INFO` request (`:98-104`):
- the first `BackendUnauthorizedError`:
  - close the client;
  - `await registry.refreshToken(id)`;
  - create a new client on the same origin with the refreshed token (or the old one when the refresh failed);
  - try `connect` and `SYSTEM_INFO` once more;
- a second `BackendUnauthorizedError`: `closeQuietly`, `detachQuietly`, return `{ ok: false, machineId: id, failure: unauthorizedFailure(false) }`.

The retry-once is structural here (one function call), so no gate is needed.

**TUI machine session, live `4401`** (in `reconcile`, which every status change reaches):
- `!machine.local && machine.net.wasUnauthorized()` → `this.gate.unauthorized(machine.machineId)`:
  - `"refresh"`: `await registry.refreshToken(id)`, then `scheduleReattach(machine, 0)`. `reattachOnce` retargets with `result.token ?? null`;
  - `"reject"`: `cancelReattach()`, then `setStatus(machine, { state: "offline", reason: ACCESS_TOKEN_REJECTED })`.
- Going `online` does **not** reset the gate: an unauthorized socket opens before it is closed `4401`. Instead, each time a remote goes `online` the session sends `MSG.SYSTEM_INFO` once; success calls `this.gate.authenticated(machine.machineId)`, and a `BackendUnauthorizedError` leaves the gate as it is, so the next `4401` rejects.
- A local machine with `wasUnauthorized()` gets `{ state: "offline", reason: LOCAL_ACCESS_TOKEN_REJECTED }`.
- `connectLocal`'s catch rethrows a `BackendUnauthorizedError` as `new Error(LOCAL_ACCESS_TOKEN_REJECTED)`.

**TUI `--connect`**
- Token resolution: `--token <t>` or `--token=<t>`, else `env.TASKFLOW_TOKEN` when `--connect` is given, else `null`.
- `--token` without `--connect`: `--token needs --connect. <USAGE>`.
- A token failing `isApiToken`: `--token expects a Taskflow access token (43 characters). <USAGE>`.
- `USAGE` (`cli.ts:14-15`) becomes `usage: taskflow-tui [machine] [--connect <host:port> [--token <token>]] (IPv6 must be bracketed: [::1]:7777)`.
- `entry.ts`: after `await net.connect()`, `await net.request(MSG.SYSTEM_INFO)`. A `BackendUnauthorizedError` there throws `new Error(ACCESS_TOKEN_REJECTED)`, which `fail` prints. There is nothing to re-read a token from.

**Manual entry.** The token can be typed where a port can (design.md §1):
- desktop: "Access token", placeholder `read over ssh`, `type="password"`, `autoComplete="off"`;
- TUI add form: "Access token".

Both validate through `addBackend`, so a bad token shows `That access token is not valid.`.

**Settings → General: the local token** (`AccessTokenRow`):
- only when `window.taskflow` exists. The token is read once through `getLocalApiToken()` in an effect; `null` renders nothing;
- `SettingRow` label `Access token`, hint `For machines that can't read it over ssh: paste it in their connect dialog`;
- the value shows as its first 6 characters followed by `…`, plus `<CopyButton value={token} />` copying the whole token;
- it is the local backend's token whichever machine is primary.

## Task 4.1: shared

- [ ] **Step 1:** Tests:
  - `backend-auth.test.ts`:
    - `the gate refreshes once per id, then rejects until authenticated`
    - `ids are independent`
    - `unauthorizedFailure has kind unauthorized and the exact remote and local messages`
  - `tunnel-manager.test.ts`: extend `FAKE_SSH` so a call without `-L` logs its last argument and prints `process.env.FAKE_SSH_CAT_OUTPUT`, exiting with `FAKE_SSH_CAT_CODE` (default 0). Tests:
    - `readRemoteToken cats api-token-<instanceId> and returns a valid token`
    - `readRemoteToken reports no-backend with the exact message when cat fails`
    - `readRemoteToken refuses content that is not a token`
  - `backend-records.test.ts`:
    - `normalizeRecords keeps a valid token and drops an invalid one`
    - `adoptUid keeps the source token, else the existing one`
  - `backend-registry.test.ts`:
    - `attach reads a missing token once and stores it`
    - `attach of a record with a token does not read it again`
    - `a failed token read does not fail the attach and returns no token`
    - `attach returns the token`
    - `refreshToken re-reads, stores and returns the new token`
    - `refreshToken leaves the record alone when the read fails`
    - `attached() lists each live origin with its token`
    - `addBackend stores a valid token and rejects an invalid one with the exact message`
    - `backends.json is written with mode 0600, even with a leftover 0644 backends.json.tmp next to it` (skip on `win32`)
- [ ] **Step 2:** Run `bun test packages/shared/src`. Expected: FAIL.
- [ ] **Step 3:** Implement. Wire `readRemoteToken` into `electron/src/main.ts` and `packages/tui/src/remote/machines.ts`. Add `token: null` to the fixtures.
- [ ] **Step 4:** Run `bun test packages/shared/src`, `cd packages/tui && bun test`, `bun run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shared): remote backend tokens read over ssh and kept in records`.

## Task 4.2: Electron and renderer

- [ ] **Step 1:** Tests, each UI file run on its own from the repo root:
  - `connection-registry.test.ts` (the test server closes with 4401: give `startTestServer` an option `rejectAll?: boolean` that upgrades and then calls `ws.close(4401, "unauthorized")` on open):
    - `a 4401 close after open rejects the pending request with BackendUnauthorizedError` (send a request in the open callback, before the close)
    - `after a 4401 close a new request rejects with BackendUnauthorizedError`
    - `a 4401 close does not reconnect`
  - `backend-store.test.ts` (its `startBackend` gains `accept?: (protocolHeader: string | null) => boolean`; refused sockets close 4401 on open):
    - `a remote attach refused with 4401 refreshes the token once and attaches with the new one` (the second `main.attachBackend` answer carries the accepted token)
    - `a remote attach refused twice ends offline with "Remote backend rejected the access token" and kind unauthorized`
    - `a local attach refused with 4401 ends offline with "The local backend rejected the access token" and no refresh`
    - `a successful handshake re-arms the refresh for a later 4401`
    - `a remote that restarts with a new token while attached refreshes once through rehandshake and reattaches` (restart the fake backend accepting only the new token; the real `followSocket` path drives it)
    - `a refreshed token that is still wrong ends offline after exactly one refresh` (live path; `main.refreshed` has one entry)
    - `a detached machine's late 4401 starts no refresh`
    - `a primary remote that rotates its token is primary again after the refresh` (Section 3's primary restore in `attach`; assert `getPrimary()` and the primary status listener)
  - `ManageBackendsDialog.test.tsx`:
    - `editing the access token sends it; emptying it sends null`
    - `saving a new token for a machine rejected as unauthorized reattaches it` (drive the dialog's save, not `retry` directly; the fake bridge's second `attachBackend` answer carries the accepted token, and the row ends `attached`)
    - `saving only a new name does not retry an unauthorized machine`
  - `backend-registry.test.ts` (Task 4.1): `updateBackend stores a new token, clears it on null and rejects an invalid one`
  - `AccessTokenRow.test.tsx`:
    - `shows the first six characters and copies the full token`
    - `renders nothing without the desktop bridge or without a token`
  - `ConnectBackendDialog`: no test file exists; Step 5 checks it by hand.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the IPC handlers, preload, `env.d.ts`, `connection.ts`, `backend-store.ts`, the fake bridge, `ConnectBackendDialog.tsx`, `ManageBackendsDialog.tsx`, `AccessTokenRow.tsx` and its use in `GeneralSection.tsx`. Make `isWanted` false for a row whose failure is `unauthorized` (decision 1).
- [ ] **Step 4:** Run the Step 1 files, `ManageBackendsDialog.test.tsx` and `hard-switch.test.ts` one by one; `cd packages/ui && bun run typecheck`; `cd electron && bun run typecheck && bun run build`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): token refresh after 4401, manual token entry and the local token in Settings`.

## Task 4.3: TUI

- [ ] **Step 1:** Tests:
  - `client.test.ts` (a `Bun.serve` that closes 4401 on open, and one that accepts only a given `authorization`):
    - `a 4401 close after open rejects the pending request with BackendUnauthorizedError and does not redial`
    - `wasUnauthorized is set by a 4401 and cleared by the next successful open`
    - `retarget with a new token redials an unauthorized client and sends the new token`
  - `connect.test.ts`:
    - `a first 4401 refreshes the token and the handshake succeeds on a client with the new token`
    - `a second 4401 detaches and reports kind unauthorized with the exact message`
    - `createClient receives the attach's token`
  - `machine-session.test.ts`:
    - `a live 4401 on a remote refreshes once and reattaches with the token the attach returns`
    - `a second live 4401 shows "Remote backend rejected the access token" and stops reattaching`
    - `a refreshed token that is still wrong is refused after exactly one refresh` (the socket opens before each `4401`; `refreshToken` is called once)
    - `the gate re-arms only after SYSTEM_INFO succeeds`
    - `a rejected token stops the reconnect policy`
    - `a stopped remote backend (no-backend) keeps retrying after Section 4` (Section 3's regression test still passes)
    - `a local 4401 shows "The local backend rejected the access token"`
  - `cli.test.ts`:
    - `--token and --token= set the connect token`
    - `TASKFLOW_TOKEN is the fallback`
    - `--token wins over TASKFLOW_TOKEN`
    - `--token without --connect is a usage error`
    - `a malformed token is a usage error with the exact message`
    - update the existing connect `toEqual`s with `token: null`
  - `machine-picker.test.ts`: `the add form passes the access token, and leaves it out when empty`
- [ ] **Step 2:** Run `cd packages/tui && bun test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement `client.ts`, `connect.ts`, `machine-session.ts`, `cli.ts`, `entry.ts` and `machine-picker.ts`.
- [ ] **Step 4:** Run `cd packages/tui && bun test && bun run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(tui): remote tokens, --token and one refresh after 4401`.

## Task 4.4: verification (record in `handoff.md`)

- [ ] **Step 1:** With a second machine (or a second instance reached over `ssh localhost`, `instanceId` `dev-<branch>`):
  - attach it from the desktop and from the TUI;
  - its backend stderr shows no `[auth] report-only` line from `origin=file://`, `ua=node` (tray, notifications) or `ua=none` (TUI);
  - `backends.json` (desktop `userData`, TUI state dir) holds the token and is `-rw-------`.
- [ ] **Step 2:** Delete the remote's `api-token-<instanceId>` and restart it. Report-only mode sends no `4401`, so the clients keep the stale token. The remote's stderr shows one `(credential)` line per client kind, which proves a stale token is detected. Remove and re-add the record, and check that `backends.json` now holds the fresh token. The refresh after `4401` is pinned by the tests and checked live in Section 5.
- [ ] **Step 3:** `taskflow-tui --connect 127.0.0.1:<tunnel port> --token "$(ssh <host> cat ~/.config/taskflow/api-token-main)"` connects with no report line.
- [ ] **Step 4:** Settings → General (under "Discoverable on this network") shows the local token, and Copy puts the full token on the clipboard.

## Planner decisions (2026-10-30)

1. **Section 3's interface, reconciled.** Section 3 provides `createReconnectPolicy({ attempt(): Promise<boolean>, schedule?, random? })` with `start / retryNow / setConnected / stop` in `packages/shared/src/remote/reconnect-policy.ts` (a pure subpath the renderer can import), and the desktop's `createBackendReconnects({ isWanted(id), attempt(id), … })` in `packages/ui/src/lib/backend-reconnect.ts`, which runs in the renderer. There is no failure hook. Instead:
   - **TUI:** no attach failure kind stops the policy. `no-backend` keeps retrying, as Section 3 made it (design.md §2). A token rejected after its one refresh stops it: the live-`4401` `"reject"` branch calls the policy's `stop()` (through `cancelReattach`).
   - **Desktop:** a row whose failure is `unauthorized` is not wanted: `isWanted(id)` returns `false` for it, so `createBackendReconnects` drops it. A later manual Retry or a token edit makes it wanted again.
   - The remote-read argv is Section 3's `buildRemoteReadArgs(record, fileName)` in `tunnel-args.ts`.
2. **The local token is shown in Settings → General**, under "Discoverable on this network", through the `AccessTokenRow` component. Don't put it in `RemoteSection.tsx`, which is the Claude remote-agent pane and only shows when Claude is installed. `design.md` and Section 13 are amended.
3. A local `4401` shows `The local backend rejected the access token`.
4. **The saved token is editable** on the desktop: `updateBackend` takes `token` and `ManageBackendsDialog` edits it (Task 4.1, 4.2 files). A token save on an `unauthorized` row calls `retry` (Task 4.2's `ManageBackendsDialog` bullet). Tests as listed there. The TUI only renames machines today; it gets no token edit (remove and re-add).
5. A remote without a readable token costs one failing ssh `cat` per attach. That's accepted.
