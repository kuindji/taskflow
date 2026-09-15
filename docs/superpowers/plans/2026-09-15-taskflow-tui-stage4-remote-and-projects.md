# Taskflow TUI Stage 4 — remote machines, projects, archived tasks — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the TUI attach to one Taskflow backend at a time on another machine (discovery, ssh tunnel, host-key trust), and add local-only project management plus archived-task browsing, unarchive and local-only delete.

**Architecture:** The Electron-free remote modules move from `electron/src` into `packages/shared/src/remote` and both clients use them. The TUI gets a machine picker in front of a disposable workspace built by `openWorkspace(net, context)`, so launch and machine switches share one wiring path on one renderer. Project and archive commands register in `COMMAND_METADATA` with a `localOnly` flag that the router, footer and help all read.

**Tech Stack:** Bun, TypeScript, OpenTUI 0.5.7, `ws`-style `WsClient`, OpenSSH client, UDP multicast discovery from `@taskflow/shared/discovery`.

**Spec:** `docs/superpowers/specs/2026-09-15-taskflow-tui-stage4-remote-and-projects-design.md`

## Global Constraints

- Use `bun` for every install, script and test run. Never `npm` or `yarn`.
- No `as any`. No new eslint-disable comments.
- Export only what another module imports. Remove exports the move leaves unused.
- Reuse existing types (`BackendRecord`, `MenuEntry`, `TunnelFailure`, `DiscoveredBackend`, `Project`, `Task`) before adding new ones. New shared types go in `packages/shared/src/types`.
- Commits: conventional prefixes (`feat(tui):`, `refactor(shared):`, `fix(tui):`, `test(tui):`, `docs(tui):`), no `Co-Authored-By` line.
- Formatting: run prettier only on changed files, `bunx prettier --write <files>`. `bun run format` rewrites the whole repo.
- `mock.module` leaks across files. Run any test file that uses it on its own: `bun test <file>`.
- The desktop remote-projects behaviour must not change. Task 1 is a refactor.
- Project commands and archived-task delete are allowed only when `workspace.local === true`.
- Saved TUI machines live in the TUI state directory, never in Electron's userData. Host keys use the shared `KNOWN_HOSTS_FILE` (`~/.taskflow/known_hosts`).
- No AI provider runs during validation or smoke tests.
- Work on `main`. Do not create branches or persistent worktrees.

## Review policy

- Before implementation: at least two Codex gpt-5.5 review rounds over this plan, recorded in the handoff.
- Per task: Level 0 validation (the task's focused tests, `bun run typecheck`, eslint on changed files).
- After Task 11's smoke: one Level 1 review over the Stage 4 diff, including the moved desktop code, then a verification-only pass after fixes.
- Do not add optional hardening without separate authorization.

## Handoff

Create `docs/superpowers/plans/2026-09-15-taskflow-tui-stage4-remote-and-projects.handoff.md` when Task 1 starts. Record per task: status, commits, test counts, deviations. Record human gates as open until the user reports them.

## Facts verified while planning

- `electron/src/{backend-records,tunnel-args,tunnel-manager,backend-registry}.ts` import no Electron API. Their tests are colocated: `backend-records.test.ts`, `tunnel-args.test.ts`, `tunnel-manager.test.ts`, `backend-registry.test.ts`.
- Importers outside the moved set: `electron/src/main.ts:5-15` (`createRegistry` and eight tunnel-manager functions) and `electron/src/ipc-handlers.ts:9,12` (`BackendRegistry` type, `onTunnelExit`).
- `tunnel-manager.ts` holds module-level `tunnels`, `pendingOpens` and `exitHandler` (`:51,62,64`) plus the scanned-fingerprint cache. Its test imports `closeTunnel, hasTunnel, onTunnelExit, openTunnel, rekeyTunnel`.
- `createRegistry(deps).init()` (`backend-registry.ts:190-205`) loads records and starts the discovery listener in one call.
- `registry.attachBackend(id)` returns `{ok: true, origin: "http://127.0.0.1:<localPort>"}` or `{ok: false, failure}`. `confirmBackend(id, {backendUid, protocolVersion})` returns `{id, merged}` and rekeys the record and tunnel onto the uid.
- `electron/build.ts` bundles `@taskflow/shared` (only `electron` and `electron-updater` are external), so a new `./remote` subpath needs no build change.
- `PROTOCOL_VERSION` is exported from `packages/shared/src/constants.ts:9`. The desktop handshake compares `SYSTEM_INFO.protocolVersion` to it (`packages/ui/src/stores/backend-store.ts:158`).
- `WsClient` takes `(port, host)` as readonly constructor fields (`packages/tui/src/net/client.ts:49-52`) and already reconnects with backoff.
- `opentui/entry.ts:73-150` builds one `WsClient`, eight stores, `SessionController`, `ActionRunner` and `OpenTuiApp` inline.
- The backend's task log is keyed by task id file (`task-store.ts:874`), so it resolves for archived tasks. Attributes are fields on the `Task` record. **No backend change is needed for archived task detail.** The TUI `TaskDetail` currently reads the selected active task, so it needs an explicit task and a read-only mode.
- Over WebSocket, `project:add`, `project:remove`, `project:update`, `task:unarchive` and `task:delete` do not broadcast. `project:reordered` does.
- Global keys in `opentui/keys.ts` today: `↑↓/jk Enter/l 1-9 z Q s q r t n f c g , ! / ?`. Inside product views, `p` is taken in `flow-run.ts:93` and `task-detail.ts:157`, and `u` in `git-changes.ts:128` and `task-detail.ts:138`. Product views receive keys before global routing (`app.ts:695-760`), so the new global `p` and `A` stay safe as long as they route only from the main sidebar screen.
- The TUI's runtime settings are backend settings. The TUI has no local config directory. `dev.ts` sets `TASKFLOW_CONFIG_DIR` to a disposable root for the backend.

## File structure

Shared:

- `packages/shared/src/remote/backend-records.ts` (moved)
- `packages/shared/src/remote/tunnel-args.ts` (moved)
- `packages/shared/src/remote/tunnel-manager.ts` (moved; factory)
- `packages/shared/src/remote/backend-registry.ts` (moved; `load`/`startDiscovery` split)
- `packages/shared/src/remote/index.ts` (barrel for the `./remote` subpath)
- the four colocated `*.test.ts` files (moved)

TUI, new:

- `packages/tui/src/remote/state-dir.ts`: resolve the TUI state directory
- `packages/tui/src/remote/tui-state.ts`: `state.json` read/write (last machine, selection per machine)
- `packages/tui/src/remote/machines.ts`: build the TUI registry and tunnel manager
- `packages/tui/src/remote/connect.ts`: attach → socket → handshake → confirm
- `packages/tui/src/remote/picker-model.ts`: picker rows and selection logic
- `packages/tui/src/opentui/machine-picker.ts`: picker view, add form, rename, forget, trust prompt
- `packages/tui/src/opentui/workspace.ts`: `openWorkspace` and `Workspace`
- `packages/tui/src/opentui/path-input.ts`: single-line path input with local Tab completion
- `packages/tui/src/projects/store.ts`: project mutations
- `packages/tui/src/opentui/project-add.ts`
- `packages/tui/src/opentui/linked-projects.ts`
- `packages/tui/src/archive/store.ts`: archived task list, unarchive, delete
- a colocated `*.test.ts` for each new module

TUI, modified: `cli.ts`, `net/client.ts`, `opentui/entry.ts`, `opentui/app.ts`, `opentui/keys.ts`, `opentui/help.ts`, `opentui/confirm.ts`, `opentui/task-detail.ts`, `state/store.ts`, `dev.ts`, `README.md`.

Electron, modified: `electron/src/main.ts`, `electron/src/ipc-handlers.ts`.

---

## Task 1: Move the remote modules into `packages/shared` (gate)

**Files:**

- Move: `electron/src/backend-records.ts` → `packages/shared/src/remote/backend-records.ts`, and its test
- Move: `electron/src/tunnel-args.ts` → `packages/shared/src/remote/tunnel-args.ts`, and its test
- Move: `electron/src/tunnel-manager.ts` → `packages/shared/src/remote/tunnel-manager.ts`, and its test
- Move: `electron/src/backend-registry.ts` → `packages/shared/src/remote/backend-registry.ts`, and its test
- Create: `packages/shared/src/remote/index.ts`
- Modify: `packages/shared/package.json` (exports)
- Modify: `electron/src/main.ts:5-15,136-147`
- Modify: `electron/src/ipc-handlers.ts:9,12,395-398`

**Interfaces:**

- Produces `@taskflow/shared/remote` exporting:
  - `createTunnelManager(): TunnelManager`, where `TunnelManager` has exactly the current module's operations as methods: `openTunnel(record, backendPort): Promise<TunnelResult>`, `closeTunnel(id): void`, `closeAllTunnels(): void`, `rekeyTunnel(fromId, toId): void`, `hasTunnel(id): boolean`, `onTunnelExit(handler: (id: string, failure: TunnelFailure) => void): void`, `readRemotePort(record)`, `fetchHostKeyFingerprint(record)`, `trustHostKey(record)`, `forgetScannedHostKey(id)`.
  - `type TunnelManager`, `type TunnelResult`.
  - `createRegistry(deps)` and `type BackendRegistry`, whose methods now include `load(): Promise<void>`, `startDiscovery(): Promise<void>` and `stopDiscovery(): void`. `init()` stays and runs `load()` then `startDiscovery()`. `stop()` stays as an alias of `stopDiscovery()`.
  - `KNOWN_HOSTS_FILE`.
- Only names imported by Electron or the TUI are exported from `index.ts`. `backend-records` helpers stay internal unless a consumer imports them.

Runtime constraint: the Electron main process runs these modules on Node, not Bun. `electron/tsconfig.src.json` rechecks shipped sources with `types: []`, and it still covers the moved modules transitively through `main.ts`'s imports. The moved sources must use `node:` APIs only, never `Bun.*`. The TUI binary runs them under Bun, which also supports `node:` APIs.

- [ ] **Step 1: Move the files with history.** Use `git mv` for the four modules and their four tests. Fix relative imports inside them: `./tunnel-args` and `./backend-records` stay relative, `@taskflow/shared` imports of types become relative `../types/backend` or `../index` imports matching how `packages/shared/src/discovery/socket.ts` imports types, and `@taskflow/shared/discovery` becomes `../discovery`.

- [ ] **Step 2: Add the subpath export.** In `packages/shared/package.json` `exports`, add `"./remote": "./src/remote/index.ts"`. Create `index.ts` exporting only the names listed under Interfaces.

- [ ] **Step 3: Convert the tunnel manager to a factory.** Wrap the module-level state (`tunnels`, `pendingOpens`, `exitHandler`, the scanned-fingerprint map, and the `closing` flag at `tunnel-manager.ts:257`, which `closeAllTunnels` sets at `:456` and `openTunnel` reads at `:385`) and every function that reads it inside `function createTunnelManager()`, returning the operation object. Keep the constants (`READINESS_TIMEOUT_MS`, `LOCAL_PORT_ATTEMPTS`) module-level. Change no logic.

- [ ] **Step 4: Update the tunnel-manager test.** Replace the named imports with `const manager = createTunnelManager();` in each `describe` setup (a fresh manager per test file section) and call `manager.openTunnel` etc. Add two tests.
  - Two managers side by side: open a tunnel on the first, and assert `second.hasTunnel(id)` is false.
  - `first.closeAllTunnels()`, then `second.openTunnel(record, port)` against the fake ssh still succeeds, and does not return the "Taskflow is quitting." failure. This one fails if `closing` stays module-level. This fails before Step 3 only in the sense that the factory doesn't exist; it guards isolation from now on.

- [ ] **Step 5: Split registry init.** In `backend-registry.ts`, split `init()` into `load()` (records) and `startDiscovery()` (listener creation and `start()`), add `stopDiscovery()` that stops and nulls the listener so `startDiscovery()` can run again, and keep `init()` as `load()` then `startDiscovery()`. Add a registry test: `load()` alone never creates a listener (inject a fake by seeding `__setDiscoveredForTest` and asserting `listBackends()` works without `startDiscovery`), and `startDiscovery()` → `stopDiscovery()` → `startDiscovery()` does not throw.

- [ ] **Step 6: Rewire Electron.** In `main.ts`, `import { createRegistry, createTunnelManager } from "@taskflow/shared/remote"`, create `const tunnels = createTunnelManager();` and pass `tunnels.openTunnel` etc. to `createRegistry` (bound methods: the factory returns closures, so no `this` binding is needed). Replace `closeAllTunnels()` calls with `tunnels.closeAllTunnels()`. Pass `tunnels` into `registerIpcHandlers` deps as `tunnels: TunnelManager` and replace `onTunnelExit(...)` with `deps.tunnels.onTunnelExit(...)`. Change the `BackendRegistry` type import to `@taskflow/shared/remote`.

- [ ] **Step 7: Run the gate.**

```bash
bun test packages/shared/src/remote
bun test electron/src
bun run typecheck
bunx eslint packages/shared/src/remote electron/src/main.ts electron/src/ipc-handlers.ts
bun run build:electron
```

Expected: all moved tests pass with the same counts as before the move plus the two new tests; typecheck, eslint and the Electron build pass. Record the before and after counts in the handoff.

- [ ] **Step 8: Commit.** `refactor(shared): move remote tunnel and registry modules out of electron`

---

## Task 2: TUI state directory, state file and registry

**Files:**

- Create: `packages/tui/src/remote/state-dir.ts`, `state-dir.test.ts`
- Create: `packages/tui/src/remote/tui-state.ts`, `tui-state.test.ts`
- Create: `packages/tui/src/remote/machines.ts`, `machines.test.ts`
- Modify: `packages/tui/src/dev.ts`

**Interfaces:**

- Consumes: `createRegistry`, `createTunnelManager`, `BackendRegistry`, `TunnelManager` from Task 1.
- Produces:
  - `resolveStateDir(env: NodeJS.ProcessEnv, homeDir: string): string`: `TASKFLOW_TUI_STATE_DIR` (must be absolute, else throws), else `$XDG_CONFIG_HOME/taskflow/tui`, else `<home>/.config/taskflow/tui`.
  - `interface TuiState { lastMachineId: string | null; selections: Record<string, { projectId: string | null; taskId: string | null }> }`
  - `readTuiState(dir: string): Promise<TuiState>` (missing or unparsable file → empty state), `writeTuiState(dir: string, state: TuiState): Promise<void>` (temp file then rename).
  - `LOCAL_MACHINE_ID = "local"` constant.
  - `interface Machines { registry: BackendRegistry; tunnels: TunnelManager }`, `createMachines(stateDir: string): Machines` using `join(stateDir, "backends.json")` and `userInfo().username`.

- [ ] **Step 1: Write failing tests.**
  - `state-dir.test.ts`: the three resolution branches, plus a relative override throwing.
  - `tui-state.test.ts`: round trip in a `mkdtemp` directory; a file containing `{` reads as the empty state; after a write, no `*.tmp` file is left.
  - `machines.test.ts`: `createMachines(tmp)` then `registry.load()` then `registry.addBackend({host: "10.0.0.5"})` writes `<tmp>/backends.json` containing that host, and no listener starts (no `startDiscovery` call).
- [ ] **Step 2: Run them.** `bun test packages/tui/src/remote` → FAIL (modules missing).
- [ ] **Step 3: Implement the three modules** as specified in Interfaces. Create the directory with `mkdir(dir, {recursive: true, mode: 0o700})` before writes.
- [ ] **Step 4: Dev isolation.** In `dev.ts` `main()`, set `process.env.TASKFLOW_TUI_STATE_DIR = join(launch.configDir, "tui")` unless it's already set. Add a case to the existing `resolveDevLaunchConfig` tests only if the value is computed there. Otherwise, test `main`'s env assignment through the extracted helper `devStateDir(configDir: string): string`.
- [ ] **Step 5: Run.** `bun test packages/tui/src/remote packages/tui/src/dev.test.ts` → PASS. `bun run typecheck`.
- [ ] **Step 6: Commit.** `feat(tui): add local machine state and registry wiring`

---

## Task 3: Extract `openWorkspace`

A refactor with no behaviour change. It makes the machine switch in Task 6 possible.

**Files:**

- Create: `packages/tui/src/opentui/workspace.ts`, `workspace.test.ts`
- Modify: `packages/tui/src/opentui/entry.ts:44-200`

**Interfaces:**

- Produces:
  - `interface WorkspaceContext { renderer: CliRenderer; machineId: string; machineLabel: string; local: boolean; onQuit(): void; onSwitchMachine(): void }`
  - `interface Workspace { readonly app: OpenTuiApp; readonly local: boolean; readonly machineId: string; hasOpenEditor(): boolean; resetSessionResizes(): void; selection(): { projectId: string | null; taskId: string | null }; restoreSelection(selection: { projectId: string | null; taskId: string | null }): void; dispose(): void }`
  - `openWorkspace(net: NetLike, context: WorkspaceContext): Promise<Workspace>`. `NetLike` is not `WsClient`: tests pass a fake, and Task 7 passes `OfflineGuardNet`. A class with private fields can't be satisfied structurally, so export the `NetLike` interface from `net/client.ts`.
  - `dispose()` order: `app.destroy()` first, which removes the renderer key and resize listeners (`app.ts:370-380`) and the root renderable; then the session controller; then every store. `dispose()` never touches the renderer itself.

- [ ] **Step 1: Write failing tests** in `workspace.test.ts` using the fake `NetLike` and renderer helpers already used by `app.test.ts`. Import them from there, or move them into a shared test helper file if they're local to that test.
  - `dispose()` calls `dispose` once on every store and `destroy` on the session controller, calls `app.destroy()` exactly once before them, sends no `SESSION_STOP`/`session:close` request, and a second `dispose()` is a no-op.
  - Same-renderer rebuild: open workspace A, `dispose()` it, open workspace B on the same fake renderer, then emit one keypress. Only B's handler runs, the renderer has exactly one `keypress` and one `resize` listener, and A's root renderable is no longer a child of the renderer root.
  - `hasOpenEditor()` is true while an `onEditTaskText` or `onEditRecord` promise is pending and false after it settles.
- [ ] **Step 2: Run.** `bun test packages/tui/src/opentui/workspace.test.ts` → FAIL.
- [ ] **Step 3: Move the wiring.** Cut store, controller, action runner, editor dependency and `OpenTuiApp` construction out of `entry.ts` into `openWorkspace`. Track pending external editor work with a counter incremented and decremented around `editRecord` and task text edits. `selection()` reads the app's selected owner. `restoreSelection` selects a project or task only if the store still has it. `entry.ts` keeps argument parsing, the runtime owner, backend start and `finish`, and calls `openWorkspace` once.
- [ ] **Step 4: Run.** `bun test packages/tui` → the full TUI suite passes with the same count as before plus the new tests. `bun run typecheck`.
- [ ] **Step 5: Commit.** `refactor(tui): build the workspace in one disposable unit`

---

## Task 4: Connect service and picker model

**Files:**

- Create: `packages/tui/src/remote/connect.ts`, `connect.test.ts`
- Create: `packages/tui/src/remote/picker-model.ts`, `picker-model.test.ts`
- Modify: `packages/tui/src/net/client.ts`, `client.test.ts`

**Interfaces:**

- Consumes: `Machines`, `LOCAL_MACHINE_ID` (Task 2).
- Produces:
  - `WsClient.retarget(port: number, host: string | null): void`: replaces the dial target. If connected, the socket is closed and the existing reconnect loop dials the new target. `port`/`host` stop being readonly.
  - `type ConnectOutcome = { ok: true; machineId: string; net: WsClient } | { ok: false; machineId: string; failure: TunnelFailure } | { ok: false; machineId: string; incompatible: true } | { ok: false; machineId: string; alreadyAttached: true }`. The success variant keeps `WsClient`, because `MachineSession` needs `retarget` and `close`. It wraps the client in `OfflineGuardNet` (Task 7) before passing it to `openWorkspace(net: NetLike)`.
  - `connectMachine(machines: Machines, id: string, deps?: { createClient?: (port: number, host: string) => WsClient }): Promise<ConnectOutcome>`. Order: `registry.attachBackend(id)` → parse origin port → `client.connect()` → `SYSTEM_INFO` → if `protocolVersion !== PROTOCOL_VERSION`, close the client, `registry.detachBackend(id)`, return `incompatible` → `registry.confirmBackend(id, info)` → return `{ok: true, machineId: confirmed.id}`. Everything after a successful `attachBackend` has cleanup: parsing the origin, `client.connect()`, the `SYSTEM_INFO` request, and `confirmBackend`. The registry has already recorded the origin and set `attached: true` by then (`backend-registry.ts:323-330`). Any throw or rejection in those steps closes the client (if it was created), calls `registry.detachBackend(id)`, and returns `{ok: false, machineId: id, failure: {kind: "unknown", message, stderr: ""}}`. `connectMachine` never throws. A thrown `confirmBackend` likewise detaches, closes the client and returns `{ok: false, failure: {kind: "unknown", message, stderr: ""}}`.
    - **Merge case.** When `confirmBackend` returns `merged: true`, the registry has already closed the new tunnel (`backend-registry.ts:399-410`), because the target is an alias of a backend attached under its uid. `connectMachine` closes the new client and returns `{ok: false, machineId: confirmed.id, alreadyAttached: true}`. It doesn't decide what that means.

`MachineSession.switchTo` decides:
- If `machineId === currentMachineId`, it's a no-op. Keep the workspace and close the picker.
- If it differs, the registry holds a stale origin for a machine that isn't the current workspace, for example after a partial switch or a missed tunnel exit. Call `registry.detachBackend(machineId)` to close the stale tunnel and origin, then run `connectMachine(machines, machineId)` once more and continue the switch with that result.
- `MachineSession` also calls `registry.detachBackend` for any remote id it attached that isn't the current machine: on every switch failure after a successful attach, and at the end of every switch. So stale origins shouldn't arise in normal operation. Add `{ ok: false; machineId: string; alreadyAttached: true }` to `ConnectOutcome`.
  - `type PickerRow = { kind: "local" } | { kind: "machine"; entry: MenuEntry } | { kind: "add" }`
  - `buildPickerRows(entries: MenuEntry[]): PickerRow[]`: local first, then saved entries (seen before unseen, each in `listBackends` order), then unsaved discovered, then add.
  - `initialIndex(rows: PickerRow[], lastMachineId: string | null): number`
  - `findMachineByName(entries: MenuEntry[], name: string): MenuEntry | null` (exact `displayName`, then exact `id`, saved entries only).

- [ ] **Step 1: Failing tests.**
  - `client.test.ts`: `retarget` on a connected client closes the socket and the next successful connect targets the new port. Reuse the existing local `Bun.serve` pattern in that file.
  - `connect.test.ts` with a fake registry object satisfying the used subset of `BackendRegistry` and a fake client:
    - success returns the confirmed id;
    - an attach failure is returned unchanged and no client is created;
    - a protocol mismatch returns `incompatible` and calls `detachBackend`;
    - `client.connect()` rejecting returns a failure, calls `detachBackend(id)` once, and does not throw;
    - the `SYSTEM_INFO` request rejecting returns a failure, closes the client, and calls `detachBackend(id)` once;
    - `confirmBackend` resolving `{id: "uid-1", merged: true}` returns `alreadyAttached`, closes the new client, and does not call `detachBackend`, because detaching the canonical id would kill the live tunnel;
    - a `confirmBackend` throw returns a failure, closes the client and detaches.
  - `picker-model.test.ts`: row order; `initialIndex` for local, a saved id, a missing id (→ 0); name lookup ignores unsaved entries.
- [ ] **Step 2: Run.** `bun test packages/tui/src/remote packages/tui/src/net/client.test.ts` → FAIL.
- [ ] **Step 3: Implement.** For typing the fake, define `type RegistryPort = Pick<BackendRegistry, "attachBackend" | "detachBackend" | "confirmBackend">` in `connect.ts` and have `connectMachine` accept `{ registry: RegistryPort }`, so tests don't need casts.
- [ ] **Step 4: Run** → PASS. `bun run typecheck`.
- [ ] **Step 5: Commit.** `feat(tui): connect to saved machines through the shared registry`

---

## Task 5: Machine picker and launch

**Files:**

- Create: `packages/tui/src/opentui/machine-picker.ts`, `machine-picker.test.ts`
- Modify: `packages/tui/src/cli.ts`, `cli.test.ts`
- Modify: `packages/tui/src/opentui/entry.ts`

**Interfaces:**

- Consumes: `Machines`, `readTuiState`/`writeTuiState`, `connectMachine`, `buildPickerRows`, `initialIndex`, `findMachineByName`, `openWorkspace`.
- Produces:
  - `CliOptions` becomes `{ connect: {host: string; port: number} | null; machine: string | null }`. A single positional argument sets `machine`. `--connect` and a positional together throw a usage error. Update `USAGE` to `usage: taskflow-tui [machine] [--connect <host:port>] (IPv6 must be bracketed: [::1]:7777)`.
  - `class MachinePicker { readonly renderable; keyHints: string; handleKey(event: KeyEvent): void; setEntries(entries: MenuEntry[]): void; showFailure(message: string): void; destroy(): void }` with deps `{ renderer; entries: MenuEntry[]; lastMachineId: string | null; mode: "launch" | "switch"; onPick(row: PickerRow): void; onAdd(input: {host: string; user?: string; sshPort?: number; port?: number}): void; onRename(id: string, name: string): void; onForget(id: string): void; onCancel(): void }`. In `launch` mode Esc quits. In `switch` mode Esc closes.
  - `askTrust(renderer, fingerprint: string, host: string): Promise<boolean>` built on `Confirm`.

Picker keys: `↑↓/jk` move, Enter pick, `a` add machine form, `R` rename saved row, `F` forget saved row (with `Confirm`), Esc as above.

- [ ] **Step 1: Failing tests.**
  - `cli.test.ts`: positional name; positional plus `--connect` → usage error; two positionals → usage error.
  - `machine-picker.test.ts` with the renderer test helper:
    - rows render local, saved, discovered and add in model order;
    - Enter on the preselected row calls `onPick` with it;
    - the add form rejects an empty host without calling `onAdd` and parses numeric ports;
    - `R` and `F` are ignored on local, add and unsaved rows;
    - `showFailure` renders the message until the next key.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement the picker.** Follow `session-picker.ts` for the list, and `task-create.ts` for the add and rename forms.
- [ ] **Step 4: Launch flow in `entry.ts`.**
  1. Resolve the state dir, `createMachines`, `registry.load()`, `readTuiState`.
  2. With `--connect`: the current direct path, `local: false`, `machineId: "connect:<host>:<port>"`, no picker.
  3. With a machine name: `findMachineByName`. If none, print `Unknown machine "<name>". Saved: <names>` and exit 2. Otherwise `connectMachine`, falling back to the picker with the failure shown.
  4. Otherwise create the renderer, `registry.startDiscovery()`, show `MachinePicker` in `launch` mode, and refresh entries on `registry.onChanged`.
  5. On pick:
     - local: start or reuse the owned local backend (existing `startBackend`), connect `WsClient`, read `SYSTEM_INFO` and call `registry.setLocalUid(info.backendUid)`, `local: true`, `machineId: LOCAL_MACHINE_ID`;
     - unsaved discovered: `registry.addDiscoveredBackend(entry.id)` first;
     - failure kind `unknown-host-key`: `registry.getHostFingerprint(id)`, then `askTrust`; on yes `registry.trustBackendHost(id)` and retry once; on no return to the picker;
     - `changed-host-key` or any other failure: `showFailure(failure.message)`;
     - incompatible: `showFailure("<name> runs an incompatible Taskflow version.")`.
  6. On success: `registry.stopDiscovery()`, destroy the picker, `writeTuiState` with `lastMachineId`, `openWorkspace`, then `restoreSelection(state.selections[machineId])`.
- [ ] **Step 5: Run.** `bun test packages/tui` → PASS. `bun run typecheck`.
- [ ] **Step 6: Commit.** `feat(tui): open a machine picker at launch`

---

## Task 6: Switching machines and the local backend lifecycle

**Files:**

- Modify: `packages/tui/src/opentui/entry.ts`
- Modify: `packages/tui/src/opentui/app.ts`, `app.test.ts`
- Modify: `packages/tui/src/opentui/keys.ts`, `keys.test.ts`
- Create: `packages/tui/src/opentui/machine-session.ts`, `machine-session.test.ts`

**Interfaces:**

- Consumes: `Workspace`, `openWorkspace`, `connectMachine`, `MachinePicker` (`mode: "switch"`), `TuiState`.
- Produces:
  - UI command `"machines"` in `COMMAND_METADATA`: key `m`, group `"Machines"` (add to `CommandGroup` and `GROUP_ORDER`), label `Machines`, routes from the main screen only.
  - `class MachineSession` in `machine-session.ts` owning the current `{workspace, net, machineId, local}`, the owned local backend handle and `Machines`:
    - `switchTo(row: PickerRow): Promise<{ ok: true } | { ok: false; message: string }>`
    - `shutdown(): Promise<void>`

`switchTo` order, which the tests assert as a call log:

1. If `workspace.hasOpenEditor()`, return `{ok: false, message: "Close the external editor before switching machines."}`.
2. Connect the target first (Task 5's pick logic, moved here so launch and switch share it). On failure, return the message and keep the current workspace untouched.
3. Save `workspace.selection()` into `state.selections[oldMachineId]`.
4. `workspace.dispose()`, then `net.close()`. If the old machine was remote, `registry.detachBackend(oldMachineId)`. The owned local backend is **not** stopped.
5. `openWorkspace(newNet, context)`, `restoreSelection`, write `lastMachineId`.

`shutdown()`: dispose the workspace, close the net, `tunnels.closeAllTunnels()`, stop the owned local backend if one was started, `registry.stopDiscovery()`.

**Signal and fatal paths.** `OpenTuiRuntimeOwner` handles `SIGINT`/`SIGTERM`/`SIGHUP`, uncaught exceptions and unhandled rejections through its own `shutdown()` (`runtime.ts:90-138`), which knows only one socket and one backend.
- Add `OpenTuiRuntimeOwner.setShutdownHook(hook: () => Promise<void>): void`. `shutdownOnce` awaits the hook **before** `renderer.destroy()`, because the hook disposes the workspace and its OpenTUI renderables, which must happen while the renderer is alive (`runtime.ts:128-138` destroys the renderer first today). The resulting order: hook (workspace dispose → net close → `closeAllTunnels` → owned local backend stop → `stopDiscovery`) → `renderer.destroy()` → the runtime's own socket and backend cleanup, which is empty for machine connections. A hook rejection is reported and does not stop the rest of cleanup.
- `entry.ts` registers `machineSession.shutdown` as the hook and stops using `ownSocket`/`ownBackend` for machine connections. `MachineSession` owns them.
- Tests in `packages/tui/src/opentui/runtime.test.ts`:
  - emitting `SIGTERM` on a runtime with a hook logs `hook → renderer.destroy → exit`, in that order;
  - a rejecting hook still destroys the renderer and exits.

- [ ] **Step 1: Failing tests** in `machine-session.test.ts` with fakes for `connectMachine`, `openWorkspace` and the backend handle:
  - a successful switch logs `connect(new) → dispose(old) → close(oldNet) → detach(old) → open(new)`, in that order;
  - a failed connect logs no dispose, and the old workspace stays current;
  - `alreadyAttached` for the current machine id: no connect retry, no dispose;
  - `alreadyAttached` for a different id (stale origin): logs `detach(stale) → connect(stale) → dispose(old) → … → open(stale)`;
  - an open editor refuses before any connect;
  - switching local → remote never calls the local backend's `stop`, and switching back reuses the same handle without `startBackend`;
  - `shutdown` calls `closeAllTunnels` and stops the local backend once.
  - `keys.test.ts`: `m` resolves to `machines`, and help lists it under Machines.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `MachineSession`. Refactor `entry.ts` launch to call `switchTo` for the first pick, with no current workspace. Wire `OpenTuiApp`'s new `onSwitchMachine` dep (from `WorkspaceContext`) to open the picker in `switch` mode over the app. Opening the switch picker calls `registry.startDiscovery()`, and closing it by pick or Esc calls `registry.stopDiscovery()`. Add a `machine-session.test.ts` case asserting both calls. Show `MachineSession` failures with `showFailure`. The header shows `machineLabel`.
- [ ] **Step 4: Run.** `bun test packages/tui` → PASS. `bun run typecheck`.
- [ ] **Step 5: Commit.** `feat(tui): switch machines without leaving the terminal`

---

## Task 7: Dropped connections and quit

**Files:**

- Modify: `packages/tui/src/opentui/machine-session.ts`, `machine-session.test.ts`
- Modify: `packages/tui/src/opentui/app.ts`, `app.test.ts`

**Interfaces:**

- Consumes: `tunnels.onTunnelExit`, `registry.tunnelExited`, `registry.attachBackend`, `WsClient.retarget`.
- Produces:
  - `OpenTuiApp.setMachineStatus(status: { state: "online" } | { state: "offline"; reason: string } | { state: "stopped"; reason: string }): void`. The header renders `<label> offline: <reason>`.
  - While the status is not online, anything that sends a request shows the notice `<label> is offline.` and sends nothing. Navigation, help and `m` still work.
  - **Gate at the net layer, not in command dispatch.** Product views receive keys before global dispatch (`app.ts:752-763`) and call request-backed callbacks directly: flow pause at `flow-run.ts:93`, stage/unstage/commit at `git-changes.ts:122-128`, and task edits and pin/archive in `task-detail.ts`. So a dispatch-level check would miss them.
    - Add `class OfflineGuardNet implements NetLike` in `packages/tui/src/net/offline-guard.ts`. It wraps the real `WsClient`, and while `offline` is set, `request()` rejects with `class MachineOfflineError extends Error` without calling the inner client. `on`/`onStatusChange` pass through.
    - `openWorkspace` receives the guard, so every store and view uses it.
    - Add error display: product-view and command request failures that are `MachineOfflineError` show the footer notice `<label> is offline.`. Don't assume an existing generic display covers them; wire it where each view already reports request errors.
    - **Terminal input path.** `SessionBridge.sendInput` and `sendResize` swallow request errors (`session-bridge.ts:198-213`), so the guard alone would drop keystrokes silently. Add `OpenTuiApp` handling: while the machine status is not online and a key would go to a focused session bridge (`app.ts:769`), don't forward it, and show `<label> is offline.` once per offline period. Resize requests may still be dropped silently while offline. Today nothing ever clears `lastResize` (`session-bridge.ts:54,208-209`), so a size dropped while offline would never be resent. Add `SessionBridge.resetResize(): void`, which sets `lastResize = null` and immediately resends the current pane size. Bridges are private to `OpenTuiApp` and `SessionController`, so reach them in layers:
- add `resetResize(): void` to `SessionBridgeLike` (`app.ts`) and to the controller's bridge type (`sessions/controller.ts`);
- add `SessionController.resetResizes(): void`, which calls it on every live bridge;
- `Workspace.resetSessionResizes()` (Task 3 interface) calls `controller.resetResizes()`;
- `MachineSession` calls `workspace.resetSessionResizes()` on the transition to online.

Test in `machine-session.test.ts`: an offline → online status change calls `resetSessionResizes` once on the fake workspace. Test in `session-bridge.test.ts`: a resize to 80x24 while the fake net rejects, then `resetResize()` after it accepts, records one `TERMINAL_RESIZE {cols: 80, rows: 24}` on the accepting net.
    - No per-command `sendsRequest` flag.

Behaviour in `MachineSession`:

- On `onTunnelExit(id, failure)` for the current remote machine: `registry.tunnelExited(id)`, `setMachineStatus({state: "offline", reason: failure.message})`, then re-attach with backoff 1 s, 2 s, 4 s, capped at 30 s.
  - On success, `net.retarget(newPort, "127.0.0.1")`, then set online when `net.onStatusChange` reports connected.
  - On `no-backend`, stop retrying and `setMachineStatus({state: "stopped", reason})`.
  - A switch or shutdown cancels the retry timer.
- For the local machine, the existing `WsClient` reconnect is unchanged. Its status change sets offline or online with reason `Connection lost`.
- On quit: `shutdown()` from Task 6.

- [ ] **Step 1: Failing tests** with fake timers (`setSystemTime` or an injected `schedule` function in `MachineSession` deps):
  - a tunnel exit sets offline with the failure message;
  - a re-attach retargets the net with the new port;
  - `no-backend` stops after one attempt with state `stopped`;
  - a switch during backoff cancels the pending attempt, so no attach runs after the switch;
  - `offline-guard.test.ts`: while offline, `request()` rejects with `MachineOfflineError` and the inner fake records no call; after going online, requests pass through.
  - `app.test.ts`: while offline, opening task detail with `t` still renders the cached task; submitting a new task shows `<label> is offline.` and the inner net records no `TASK_CREATE`; in the Git changes view, `s` on an unstaged file records no `GIT_STAGE`; with a focused session while offline, typing `x` records no `SESSION_INPUT` on the inner net and shows `<label> is offline.` once.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `OfflineGuardNet` and the error display. `MachineSession` flips the guard's `offline` flag from the tunnel exit and status handlers.
- [ ] **Step 4: Run.** `bun test packages/tui` → PASS.
- [ ] **Step 5: Commit.** `feat(tui): show offline machines and reattach dropped tunnels`

---

## Task 8: Local-only gating and the `Confirm` toggle

**Files:**

- Modify: `packages/tui/src/opentui/keys.ts`, `keys.test.ts`
- Modify: `packages/tui/src/opentui/help.ts`, `help.test.ts`
- Modify: `packages/tui/src/opentui/confirm.ts`, `confirm.test.ts`
- Modify: `packages/tui/src/opentui/app.ts`, `app.test.ts`

**Interfaces:**

- Produces:
  - `localOnly?: boolean` on command metadata. The footer omits a `localOnly` command when `workspace.local` is false. Help always lists it, with the suffix ` (this machine only)`. Dispatching one while remote shows the notice `Only available on this machine.` and runs nothing.
  - `OpenTuiAppDeps.local: boolean`.
  - `ConfirmDeps.toggle?: { label: string; initial: boolean }`, and `onConfirm(toggleValue: boolean): void`. Existing callers ignore the argument. `Space` or `t` flips the toggle, and it renders as `[x] label` or `[ ] label`.

- [ ] **Step 1: Failing tests.**
  - `confirm.test.ts`: Space flips the toggle; Enter calls `onConfirm(true)` after one flip from `initial: false`; a confirm without `toggle` renders no toggle line and still passes `false`.
  - `help.test.ts`: a synthetic `localOnly` command gets the suffix.
  - `app.test.ts` with `local: false`: a registered `localOnly` command is absent from the footer, and dispatching it shows the notice and sends no request. With `local: true`, it runs.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Keep the check in one function, `canRun(command)`, used by dispatch and footer.
- [ ] **Step 4: Run.** `bun test packages/tui` → PASS.
- [ ] **Step 5: Commit.** `feat(tui): gate this-machine-only commands`

---

## Task 9: Project management

**Files:**

- Create: `packages/tui/src/projects/store.ts`, `store.test.ts`
- Create: `packages/tui/src/opentui/path-input.ts`, `path-input.test.ts`
- Create: `packages/tui/src/opentui/project-add.ts`, `project-add.test.ts`
- Create: `packages/tui/src/opentui/linked-projects.ts`, `linked-projects.test.ts`
- Modify: `packages/tui/src/state/store.ts`, `store.test.ts`
- Modify: `packages/tui/src/opentui/app.ts`, `app.test.ts`, `keys.ts`, `keys.test.ts`, `help.ts`

**Interfaces:**

- Consumes: `localOnly` gating and the `Confirm` toggle (Task 8).
- Produces:
  - `Store.applyProject(project: Project): void`, `Store.removeProject(id: string): void`, `Store.setProjectOrder(ids: string[]): void`. The same reducers the existing `PROJECT_*` event handlers use are extracted and called from both paths.
  - `class ProjectStore` with:
    - `add(path: string, name?: string): Promise<Project>` (`project:add`)
    - `hide(id: string): Promise<Project>` (`project:update {id, hidden: true}`)
    - `remove(id: string): Promise<void>` (`project:remove`)
    - `reorder(orderedIds: string[]): Promise<void>` (`project:reorder`)
    - `setLinks(id: string, linkedProjects: Project["linkedProjects"]): Promise<Project>` (`project:update`)
  - Each successful response is applied through the `Store` methods.
  - `completePath(input: string, deps?: { home: string; readdir: (dir: string) => Promise<Dirent[]> }): Promise<{ value: string; candidates: string[] }>`: expands a leading `~`, lists directories only, completes to the longest common prefix, appends `/` on a unique match, and hides dot-directories unless the typed segment starts with `.`.
  - Commands, all `localOnly: true`, group `"Projects"`:

| Command | Key | Where it routes |
|---|---|---|
| `project-add` | `p` | main screen |
| `project-remove` | `X` | project row selected |
| `project-move-down` | `J` | project row selected |
| `project-move-up` | `K` | project row selected |
| `project-links` | `L` | project row selected |

- [ ] **Step 1: Failing tests.**
  - `path-input.test.ts` (fake `readdir`): `~/Pro` with `Projects` and `Prototypes` completes to `~/Pro` with two candidates; `~/Proj` completes to `~/Projects/`; files are never candidates; dot-directories are hidden unless typed.
  - `projects/store.test.ts` with a fake net:
    - `add` applies the returned project;
    - `hide` removes it from `visibleProjects()`;
    - `remove` removes the project and its tasks from the store;
    - `reorder` rolls back to the previous order when the request rejects;
    - `setLinks` sends only `{id, linkedProjects}`.
  - `project-add.test.ts`: an empty path blocks submit; a backend error ("not a directory") renders in the form and keeps the input.
  - `linked-projects.test.ts`: the add picker excludes the project itself, hidden projects and already linked ones; editing a note sends the full updated array; removing sends the array without that link.
  - `app.test.ts`:
    - `X` opens a `Confirm` whose toggle is labelled `Keep project data` and starts on; confirming with the toggle on calls `hide`, and off calls `remove`;
    - `J` on the last project does nothing;
    - with `local: false`, all five commands send nothing.
  - `app.test.ts`: a project with `locationValid: false` renders the row marker `!`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Remove-confirm copy:
  - toggle on: `Hide "<name>"? Its tasks stay available and adding the same folder again restores it.`
  - toggle off: `Permanently remove "<name>" and delete all of its tasks? This cannot be undone.`

  The message updates when the toggle flips, which adds `ConfirmDeps.messageFor?(toggleValue: boolean): string` to `Confirm` in this task, with a `confirm.test.ts` case. The link-note input reuses the single-line input pattern from `owner-filter.ts`.
- [ ] **Step 4: Run.** `bun test packages/tui` → PASS. `bun run typecheck`.
- [ ] **Step 5: Commit.** `feat(tui): manage projects on this machine`

---

## Task 10: Archived tasks

**Files:**

- Create: `packages/tui/src/archive/store.ts`, `store.test.ts`
- Modify: `packages/tui/src/opentui/task-detail.ts`, `task-detail.test.ts`
- Modify: `packages/tui/src/opentui/app.ts`, `app.test.ts`, `keys.ts`, `keys.test.ts`, `help.ts`
- Modify: `packages/tui/src/state/store.ts`, `store.test.ts`

**Interfaces:**

- Consumes: the `Confirm` toggle, `localOnly`, `Store.applyTask` (existing task update reducer; extract it if it's inline in an event handler).
- Produces:
  - `class ArchiveStore` with:
    - `load(): Promise<Task[]>` (`task:list-archived`)
    - `tasks(): readonly Task[]`
    - `unarchive(id: string): Promise<Task>` (`task:unarchive`). Verified: the handler (`packages/backend/src/handlers/task.ts:165-182`) restores archived subtasks but **returns only the parent task**. After it resolves, `ArchiveStore` removes the parent and every archived task with `parentId === id` from its list, and the app calls the existing root `Store.load()` so the restored subtasks reach the active list.
    - `delete(id: string, deleteWorktree: boolean): Promise<void>` (`task:delete`, which returns `{success: true}`; `task.ts:184-235`). Worktree removal runs in the background after the response, so the local smoke must poll for the worktree directory to disappear.
    - `removeLocal(ids: string[]): void`
  - `TaskDetailDeps.task?: Task` and `readOnly?: boolean`. In read-only mode, edit, session, Git, pin and archive keys are ignored and absent from hints, and the header adds `Archived <date> · purged after 30 days`.
  - App state `sidebarMode: "active" | "archive"`.
  - Commands:
    - `archive-toggle`, key `A`, group `"Tasks"`, main screen;
    - `task-unarchive`, key `u`, archive mode with a task row selected;
    - `task-delete`, key `D`, archive mode with a task row selected, `localOnly: true`.

- [ ] **Step 1: Failing tests.**
  - `archive/store.test.ts`:
    - `load` groups nothing itself and returns the payload tasks;
    - `unarchive` removes the parent and its subtasks from `tasks()`;
    - `delete` sends `{id, deleteWorktree}` exactly.
  - `app.test.ts`:
    - `A` loads the archive once per entry and shows the header label `Archive`;
    - rows group by project and parent, and projects with no archived tasks are omitted; the archive sidebar has no Master Workspace row; a subtask row follows its parent; filtering by a subtask's title keeps its parent row;
    - the name filter applies in archive mode;
    - Enter opens read-only detail, where `p` (pin) and every edit key `task-detail.ts` binds today send nothing;
    - `u` restores and leaves archive mode with the restored task selected;
    - `D` on a top-level task with `worktree` shows the toggle `Also delete worktree and branch (<branch>)` starting off;
    - `D` on a subtask shows no toggle;
    - the confirm text includes `and its 2 subtasks` when two subtasks exist;
    - with `local: false`, `D` sends nothing;
    - a reconnect while in archive mode reloads the archive.
  - `task-detail.test.ts`: read-only hints omit edit, pin and archive.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Row building. `buildRows` (`app.ts:156-199`) always adds Master Workspace, includes every project, and emits a flat task list, so it can't produce the archive sidebar as-is. Extend it, rather than adding a second builder, with an optional fourth parameter `source?: RowSource`. The existing positional parameters `(store, collapsedProjectIds, filter)` stay, because `app.ts:491` and the tests at `app.test.ts:566,570` call it that way, and those tests must pass unchanged. Omitting `source` means today's behaviour:

```ts
interface RowSource {
    includeMaster: boolean;
    tasksFor(projectId: string): readonly Task[];
    omitEmptyProjects: boolean;
    nestSubtasks: boolean;
}
```

- The active sidebar passes `{includeMaster: true, tasksFor: (projectId) => store.tasksFor(projectId), omitEmptyProjects: false, nestSubtasks: false}`, which is today's behaviour, and existing `app.test.ts` row tests must stay green unchanged.
- Archive mode passes `{includeMaster: false, tasksFor: archivedTasksFor, omitEmptyProjects: true, nestSubtasks: true}`.
- With `nestSubtasks`, a task row with `parentId` is emitted directly after its parent, with label prefix `  └ `. An archived subtask whose parent isn't archived is emitted at top level.
- The name filter keeps a parent row when a subtask matches.
- `SidebarRow` is unchanged.
- `Store.tasksFor` is a class method that reads `this.taskList` (`store.ts:205-207`), so always pass an arrow like `(projectId) => store.tasksFor(projectId)`, never the bare method. Add an `app.test.ts` case that builds active rows through `RowSource` with a real `Store`.

Archive selection and detail. Today both paths only work for active tasks:
- `resolveOwner` accepts only tasks with `status === "active"` from `store.tasks` (`sessions/owner.ts:58-63`), and `refreshRows` calls it on every refresh (`app.ts:504`).
- `openTaskDetail` looks the task up with `store.taskById` (`app.ts:989-990`).

So in archive mode:
- `refreshRows` skips `resolveOwner`. It keeps the selected owner if a row with that owner key exists, otherwise it selects the first row.
- `openTaskDetail` looks the task up in `ArchiveStore.tasks()` and constructs `TaskDetail` with `task` and `readOnly: true`.
- Attribute resolution: `resolvedTaskAttributes(task, store)` looks up the parent task. Give it a lookup that checks `ArchiveStore.tasks()` first, then `store.taskById`, so an archived subtask of an archived parent still shows inherited attributes.
- Session listing for archived owners returns `[]`, and the session pane shows no sessions.

Leaving archive mode runs the normal `resolveOwner` path.

Tests (`app.test.ts`):
- In archive mode, a selected archived subtask stays selected after a store change triggers `refreshRows`.
- Enter on it opens read-only detail showing its title.
- An inherited attribute from its archived parent is listed.
- [ ] **Step 4: Run.** `bun test packages/tui` → PASS. `bun run typecheck`.
- [ ] **Step 5: Commit.** `feat(tui): browse, restore and delete archived tasks`

---

## Task 11: Help, README, validation, smoke and Level 1 review

**Files:**

- Modify: `README.md` (TUI section: machine picker, `taskflow-tui <machine>`, `--connect`, `m`, project and archive keys, this-machine-only rules, state directory)
- Create: `packages/tui/scripts/smoke-sshd.ts`: disposable sshd fixture for the remote smoke
- Modify: the Stage 4 handoff

**Interfaces:**

- `smoke-sshd.ts` exports nothing and runs as `bun packages/tui/scripts/smoke-sshd.ts <root>`. It:
  1. creates `<root>/{home,etc,ssh}`;
  2. generates an ed25519 host key and a client key with `ssh-keygen`;
  3. writes `authorized_keys` and an `sshd_config` with `Port 2222`, `ListenAddress 127.0.0.1`, `HostKey`, `AuthorizedKeysFile`, `PasswordAuthentication no`, `UsePAM no`, `StrictModes no`, and `PidFile` inside root;
  4. starts `/usr/sbin/sshd -D -f <config>` in the foreground;
  5. prints the client key path, and on exit kills sshd.

  The smoke backend must be reachable from that sshd session on the same host.

- [ ] **Step 1: Help and README.** Add a `help.test.ts` assertion that every `COMMAND_METADATA` entry appears in help exactly once, if the existing test doesn't already cover the new groups. Update the README.

- [ ] **Step 2: Automated validation.**

```bash
bun test packages/tui
bun test packages/shared
bun test electron/src
bun run lint
bun run typecheck
bun run build:backend:bin
bun run --filter @taskflow/tui build:bin
bun run build:electron
git diff --check <task-1-base>..HEAD
```

Run the full `bun test` once. Compare failures with the known baseline (the mock.module leak family: `wiki-backend-collision.repro.test.ts`, `MarkdownPaneImpl.anchors`, `.checkbox`, `.rerender`) before attributing any to Stage 4.

- [ ] **Step 3: Remote smoke.** Use a fresh absolute root `R` under the scratchpad.
  1. Start `smoke-sshd.ts R`.
  2. Start a sandboxed backend with `HOME=R/home`, `TASKFLOW_CONFIG_DIR=R/home/.config/taskflow`, `TASKFLOW_DEV_PORT=48931`, and the discoverable setting off. Create one project, one active task and one archived task with subtasks over its WS API.
  3. Run the TUI binary with `TASKFLOW_TUI_STATE_DIR=R/tui` and `HOME=R/client-home`. `HOME` must be set in the process environment before launch, because `KNOWN_HOSTS_FILE` is computed from `homedir()` at module load. OpenSSH does **not** honour a fake `HOME` for `~/.ssh/config` or identities: `HOME=<fake> ssh -G <host>` still lists the account's `~/.ssh/id_*` and `/Users/<user>/.ssh/known_hosts`. So the fixture puts a wrapper `R/bin/ssh` first on `PATH`, which runs `exec /usr/bin/ssh -F R/ssh_config -i <client key> -o IdentitiesOnly=yes "$@"`. The tunnel manager spawns `ssh` from `PATH`, as its own fake-ssh test relies on. Also wrap `ssh-keyscan` only if the host-key scan needs it; it takes no identity.
  4. Add a machine with host `127.0.0.1`, ssh port `2222`, the current user and backend port `48931`.

  Capture evidence for each of:
  - the unknown-host-key prompt shows a fingerprint; after trusting it connects, and `R/client-home/.taskflow/known_hosts` has a line starting with `taskflow-127.0.0.1-2222` (the `HostKeyAlias` from `tunnel-args.ts:31-33`), and the real `~/.taskflow/known_hosts` is unchanged;
  - `p`, `X`, `J`, `K`, `L` and `D` show `Only available on this machine.` and the backend project list is unchanged;
  - `A` shows the archived task; `u` restores it and the backend's `task:list` contains it;
  - `kill` the ssh child: the header shows offline, and the TUI reconnects within the backoff;
  - `m` → This machine → `m` → the smoke machine: a session started on the smoke backend before switching is still listed as running;
  - quit, then `pgrep -fl 'ssh -N -L'` shows no child from this run and the TUI-owned local backend pid is gone.

  Stop sshd and the backend. Move `R` to Trash.

- [ ] **Step 4: Local smoke.** Fresh root, TUI on This machine through `bun run dev:tui` with `TASKFLOW_CONFIG_DIR` pointing into the root. Capture evidence for each of:
  - add a project with Tab completion to a disposable folder;
  - reorder it with `J`/`K`;
  - link it to a second project with a note, and the linked project appears in the backend record;
  - hide it (toggle on), then add the same path again and it's restored;
  - remove the second project (toggle off), and the backend has no record of it;
  - in a disposable git repo project, create a task with a worktree, archive it, `D` with the worktree toggle on, and the worktree directory and branch are gone.

  Move the root to Trash.

- [ ] **Step 5: Level 1 review.** Review `<task-1-base>..HEAD`, including `packages/shared/src/remote` and the Electron rewiring. Fix only substantiated findings, each with a failing test first. Rerun the affected checks, then do a verification-only pass.

- [ ] **Step 6: Record in the handoff:**
  - all evidence;
  - the open human gates: Linux TUI → Mac through discovery and through Add machine; sleeping the Mac, then waking it; one real remote session attached and resized.

- [ ] **Step 7: Commit.** `docs(tui): record stage 4 validation and smoke evidence`

---

## Implementation order

1. **Task 1 first, as a gate.** Nothing else starts until the move passes.
2. **Tasks 2–3.** They're independent of each other and could run in parallel. Both are needed before 4–5.
3. **Tasks 4–7 in order.** Each builds on the previous connection behaviour.
4. **Task 8 before 9 and 10.** Both use its gating and toggle.
5. **Tasks 9 and 10.** They touch the same `app.ts`, `keys.ts` and `help.ts`, so run them sequentially.
6. **Task 11 last.**
