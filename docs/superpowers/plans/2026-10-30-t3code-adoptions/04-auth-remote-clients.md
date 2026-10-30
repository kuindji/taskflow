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
- Modify `packages/shared/src/remote/tunnel-args.ts`: `buildRemoteReadArgs(record: BackendRecord, fileName: string): string[]`. This is the argv of `readRemotePort` (`tunnel-manager.ts:146-156`) with the remote command `cat ~/.config/taskflow/'<fileName>'`, plus Section 3's multiplexing options. If Section 3 already moved that argv into a builder, extend it with the `fileName` parameter instead of adding a second one.
- Modify `packages/shared/src/remote/tunnel-manager.ts`:
  - `readRemotePort` (`:122-176`) calls `runSsh(buildRemoteReadArgs(record, \`${record.instanceId}.port\`))`;
  - new `readRemoteToken(record)` with the same `isSafeLabel` guard, `runSsh(buildRemoteReadArgs(record, \`api-token-${record.instanceId}\`))` and the failure rules below;
  - returned from `createTunnelManager` next to `readRemotePort` (`:609`).
- Modify `packages/shared/src/remote/backend-registry.ts`:
  - `RegistryDeps` (`:22-35`) gains `readRemoteToken`;
  - `AddBackendInput` (`:37-43`) gains `token?: string`;
  - `persist` (`:94-104`) writes the temp file with `{ mode: 0o600 }`;
  - `addBackend` (`:241-275`) validates and stores the token;
  - `attachBackend` (`:307-347`) reads a missing token and returns it;
  - add `refreshToken(id)`;
  - `attached()` (`:236-238`) returns each record's token.
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
- Modify `packages/ui/src/lib/connection.ts`:
  - `ConnectionHooks` (`:19-23`) gains `onUnauthorized(): void`;
  - `socket.onclose` (`:114-122`) handles code `WS_CLOSE_UNAUTHORIZED` (below).
- Modify `packages/ui/src/lib/connection-registry.ts`: `onUnauthorized(handler: (backendId: string) => void): () => void`, one listener set shared by every connection (the `onEvent` pattern, `:152-165`), fed from each `Connection`'s hook with `connection.backendId`.
- Modify `packages/ui/src/stores/backend-store.ts`:
  - `handshake` (`:148-167`) answers `"unauthorized"` instead of patching when the error is a `BackendUnauthorizedError`;
  - `attach` (`:209-...`) runs the refresh rule;
  - one module-level `createTokenRefreshGate()`;
  - an `onUnauthorized` listener next to `onBackendDropped` (`:578`).
- Modify `packages/ui/src/stores/fake-desktop-bridge.ts`: add `refreshBackendToken` to `FakeMain` and to `bridge`, recording ids in `main.refreshed: string[]`.
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
- **Consumes from Section 3** (assumed; reconcile names when both drafts are merged):
  - a reconnect loop in `packages/shared/src/remote/` that the TUI machine session (and the desktop, if Section 3 moves it there) runs per remote machine. Each attempt resolves to `{ ok: true } | { ok: false; failure: TunnelFailure }`;
  - an "on connect failure" hook, given the failure, that can **stop** the loop. That's where TUI's existing stop on `failure.kind === "no-backend"` (`machine-session.ts:428-432`) lives after Section 3.

  This section adds one rule there: **`failure.kind === "unauthorized"` stops the loop**, and the machine shows `failure.message`. A rejected token is not retried on a timer: the refresh below has already run once.
  - the argv builder for remote file reads in `tunnel-args.ts` (see Files).
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

// IPC (main ⇄ renderer)
"refresh-backend-token"(id) -> { ok: boolean }
"get-local-api-token"() -> string | null

// packages/ui/src/lib/connection-registry.ts
function onUnauthorized(handler: (backendId: string) => void): () => void;

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
- `persist` writes mode `0600`: the file now holds secrets. `rename` keeps the temp file's mode, and the temp file is created fresh on every write.

**`createTokenRefreshGate`**
- `unauthorized(id)` returns `"refresh"` the first time for an id, and `"reject"` on every call after that until `authenticated(id)`.
- `authenticated(id)` forgets the id.

**Renderer `Connection` on close code `4401`** (`event.code === WS_CLOSE_UNAUTHORIZED`):
- the waiting `open()` (`fail`) and every pending request reject with `new BackendUnauthorizedError()`;
- status becomes `{ connected: false, reconnecting: false }`;
- **no** `scheduleReconnect`: retrying with the same token can't succeed;
- `hooks.onUnauthorized()` runs.

Every other close is handled as today.

**Desktop `attach(id)`**, when `handshake` answers `"unauthorized"` (or `openConnection` rejected with `BackendUnauthorizedError`). Check `current()` after every await, as today:
- `id === LOCAL_BACKEND_ID`: `drop(id)`, `patch(id, { state: "offline", failure: unauthorizedFailure(true) })`, return `null`.
- Otherwise ask `gate.unauthorized(id)`:
  - `"refresh"`: `await bridge().refreshBackendToken(id)` (the result doesn't matter: a failed read leaves the old token, and the second `4401` decides), then `drop(id)` and `return useBackendStore.getState().attach(id)`. The new attach bumps the attempt and dials with whatever token main now holds.
  - `"reject"`: `drop(id)`, `patch(id, { state: "offline", failure: unauthorizedFailure(false) })`, return `null`.
- A handshake that succeeds calls `gate.authenticated(id)` (and `gate.authenticated(liveId)` after a rename).

**Desktop, a `4401` on a connection that was already attached** (a reconnect after the remote restarted with a new token): the `onUnauthorized` listener calls `retry(id)` only when that machine's row is `"attached"`. A row in `"attaching"` is the attach's own business. `retry` re-runs `attach`, which applies the rule above, so one refresh happens, then a reject.

**Desktop reconnect loop** (Section 3): an attempt whose row ends with `failure.kind === "unauthorized"` stops the loop.

**TUI `WsClient` on close code `4401`**: the same as the renderer:
- `settle(new BackendUnauthorizedError())` and `failPending(new BackendUnauthorizedError())`;
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
- Going `online` calls `this.gate.authenticated(machine.machineId)`.
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

**Settings → Remote: the local token** (`AccessTokenRow`):
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
  - `tunnel-args.test.ts`:
    - `buildRemoteReadArgs reads the named file under ~/.config/taskflow with the port read's options` (single-quoted name, `BatchMode=yes`, host-key options, Section 3's multiplexing options)
  - `tunnel-manager.test.ts`: extend `FAKE_SSH` so a call without `-L` logs its last argument and prints `process.env.FAKE_SSH_CAT_OUTPUT`, exiting with `FAKE_SSH_CAT_CODE` (default 0). Tests:
    - `readRemoteToken cats api-token-<instanceId> and returns a valid token`
    - `readRemoteToken reports no-backend with the exact message when cat fails`
    - `readRemoteToken refuses content that is not a token`
    - `readRemotePort uses the same builder` (the logged command is `cat ~/.config/taskflow/'main.port'`)
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
    - `backends.json is written with mode 0600` (skip on `win32`)
- [ ] **Step 2:** Run `bun test packages/shared/src`. Expected: FAIL.
- [ ] **Step 3:** Implement. Wire `readRemoteToken` into `electron/src/main.ts` and `packages/tui/src/remote/machines.ts`. Add `token: null` to the fixtures.
- [ ] **Step 4:** Run `bun test packages/shared/src`, `cd packages/tui && bun test`, `bun run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shared): remote backend tokens read over ssh and kept in records`.

## Task 4.2: Electron and renderer

- [ ] **Step 1:** Tests, each UI file run on its own from the repo root:
  - `connection-registry.test.ts` (the test server closes with 4401: give `startTestServer` an option `rejectAll?: boolean` that upgrades and then calls `ws.close(4401, "unauthorized")` on open):
    - `a 4401 close rejects open with BackendUnauthorizedError`
    - `a 4401 close does not reconnect`
    - `onUnauthorized hears the backend id`
  - `backend-store.test.ts` (its `startBackend` gains `accept?: (protocolHeader: string | null) => boolean`; refused sockets close 4401 on open):
    - `a remote attach refused with 4401 refreshes the token once and attaches with the new one` (the second `main.attachBackend` answer carries the accepted token)
    - `a remote attach refused twice ends offline with "Remote backend rejected the access token" and kind unauthorized`
    - `a local attach refused with 4401 ends offline with "The local backend rejected the access token" and no refresh`
    - `a successful handshake re-arms the refresh for a later 4401`
    - `a 4401 on an attached machine re-runs attach`
  - `AccessTokenRow.test.tsx`:
    - `shows the first six characters and copies the full token`
    - `renders nothing without the desktop bridge or without a token`
  - `ConnectBackendDialog`: no test file exists; Step 5 checks it by hand.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the IPC handlers, preload, `env.d.ts`, `connection.ts`, `connection-registry.ts`, `backend-store.ts`, the fake bridge, `ConnectBackendDialog.tsx`, `AccessTokenRow.tsx` and its use in `GeneralSection.tsx`. Add the "unauthorized stops the loop" rule to Section 3's desktop loop hook.
- [ ] **Step 4:** Run the Step 1 files and `hard-switch.test.ts` one by one; `cd packages/ui && bun run typecheck`; `cd electron && bun run typecheck && bun run build`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): token refresh after 4401, manual token entry and the local token in Settings`.

## Task 4.3: TUI

- [ ] **Step 1:** Tests:
  - `client.test.ts` (a `Bun.serve` that closes 4401 on open, and one that accepts only a given `authorization`):
    - `a 4401 close rejects connect with BackendUnauthorizedError and does not redial`
    - `wasUnauthorized is set by a 4401 and cleared by the next successful open`
    - `retarget with a new token redials an unauthorized client and sends the new token`
  - `connect.test.ts`:
    - `a first 4401 refreshes the token and the handshake succeeds on a client with the new token`
    - `a second 4401 detaches and reports kind unauthorized with the exact message`
    - `createClient receives the attach's token`
  - `machine-session.test.ts`:
    - `a live 4401 on a remote refreshes once and reattaches with the token the attach returns`
    - `a second live 4401 shows "Remote backend rejected the access token" and stops reattaching`
    - `an unauthorized attach failure stops the reconnect loop` (Section 3's hook)
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
- [ ] **Step 4:** Settings → Remote Agent shows the local token, and Copy puts the full token on the clipboard.

## Planner decisions (2026-10-30)

1. **Section 3's interface, reconciled.** Section 3 provides `createReconnectPolicy({ attempt(): Promise<boolean>, schedule?, random? })` with `start / retryNow / setConnected / stop` in `packages/shared/src/remote/reconnect-policy.ts` (a pure subpath the renderer can import), and the desktop's `createBackendReconnects({ isWanted(id), attempt(id), … })` in `packages/ui/src/lib/backend-reconnect.ts`, which runs in the renderer. There is no failure hook. Instead:
   - **TUI:** the TUI adapter's `attempt` calls `policy.stop()` and returns `false` when the attach failure is `no-backend` or `unauthorized`. Today's `no-backend` stop moves there.
   - **Desktop:** a row whose failure is `unauthorized` is not wanted: `isWanted(id)` returns `false` for it, so `createBackendReconnects` drops it. A later manual Retry or a token edit makes it wanted again.
   - The remote-read argv is this section's `buildRemoteReadArgs` in `tunnel-args.ts`. It reuses Section 3's multiplexing options from the same file.
   Wherever this section says "Section 3's hook", use these instead. The test `an unauthorized attach failure stops the reconnect loop` stays.
2. **The local token is shown in Settings → General**, under "Discoverable on this network", through the `AccessTokenRow` component. Don't put it in `RemoteSection.tsx`, which is the Claude remote-agent pane and only shows when Claude is installed. `design.md` and Section 13 are amended.
3. A local `4401` shows `The local backend rejected the access token`.
4. **The saved token is editable:** add `token` to `updateBackend` and to the machine's edit dialog. Tests: `updateBackend stores a new token`, `editing the token of an unauthorized machine makes it wanted again`.
5. A remote without a readable token costs one failing ssh `cat` per attach. That's accepted.
