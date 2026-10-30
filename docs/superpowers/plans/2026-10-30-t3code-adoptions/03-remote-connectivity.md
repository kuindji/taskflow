# Section 3: Remote connectivity

Read `handoff.md`, the index and `design.md` first. This section applies design §2. Section 4 consumes its reconnect lifecycle for token refresh. Commands below are for the later implementer, run from the repository root. This draft makes no repository changes.

## Task 3.1: Keep SSH connections owned by Taskflow

**Files:**

- Modify: `packages/shared/src/remote/tunnel-args.ts:83`, `:113`. Add the shared connection options beside `hostKeyOptions`; use them in `buildTunnelArgs`.
- Modify: `packages/shared/src/remote/tunnel-manager.ts:122`, `:147`, `:183`. Replace the inline remote-read argv with the builder below; tunnel spawning already calls `buildTunnelArgs`.
- Modify: `packages/shared/src/remote/tunnel-args.test.ts:27`, `:84`. Retain the exact-array tests and the optional real `ssh -G` parser test style.
- Modify: `packages/shared/src/remote/tunnel-manager.test.ts:8`, `:65`. Extend its temporary executable fake SSH to handle a remote `cat` invocation and record argv as well as tunnel startup.

**Interfaces:**

```ts
// tunnel-args.ts. Both exports have production callers in tunnel-manager.ts.
export function buildRemoteReadArgs(record: BackendRecord, fileName: string): string[];
// Keep this helper private: both builders are in this module.
function connectionOptions(record: BackendRecord): string[];
```

- Consumes: `BackendRecord` from `packages/shared/src/types/backend.ts:29`, existing `hostKeyOptions(record): string[]`, and the existing safe remote-path construction in `tunnel-manager.ts:125`.
- Produces: unchanged `buildTunnelArgs(record, localPort, backendPort): string[]` and the remote-read builder Section 4 will reuse for its token read. Import the builder directly within shared; no additional remote-barrel export is needed.

### Behavior

- The SSH inventory is complete at the inspected baseline: `buildTunnelArgs` builds the tunnel command; `readRemotePort` builds the remote-file command inline. `runSsh` at `tunnel-manager.ts:97` executes supplied arguments. Electron builds no SSH argv: `electron/src/main.ts:126` constructs the shared tunnel manager and passes `tunnels.readRemotePort` into the registry at `:133`.
- `connectionOptions` returns the existing `BatchMode=yes` and `hostKeyOptions(record)`, followed by exactly `['-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ControlPersist=no']`. Both builders spread this one helper before the destination. Keep port selection, `-l user -- host`, explicit loopback forwarding, `ExitOnForwardFailure=yes` and keepalives unchanged.
- `buildRemoteReadArgs` returns `['-p', String(record.sshPort), ...connectionOptions(record), '-l', record.user, '--', record.host, \`cat ~/.config/taskflow/'${fileName}'\`]`. It builds the quoted path itself, so `readRemotePort` passes `\`${record.instanceId}.port\`` and Section 4's token read passes `\`api-token-${record.instanceId}\``. `fileName` is built from a validated instance id, never from UI input: keep `isSafeLabel(record.instanceId)` in the manager before calling the builder.
- Keep the exact existing port-read errors and classification, including `"<instanceId>" is not a valid instance name.` and `Could not read Taskflow's port on <host>. Check it is running there as <user>, or enter its port in the connect dialog.`
- `buildKeyscanArgs` at `tunnel-args.ts:135` builds `ssh-keyscan` arguments, and `tunnel-manager.ts:533` runs `ssh-keygen`. These programs do not accept SSH connection-multiplexing options. Leave both alone.
- Retain the user's `ProxyJump`, identity and login configuration. Do not add `-F /dev/null` to production calls. Application-owned connections must close with their child and perform their own host-key check. Reference: t3code `packages/ssh/src/tunnel.ts`.
- Put this exact attribution above the copied option block: `// Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): packages/ssh/src/tunnel.ts`.

### Steps

- [ ] **Step 1:** Add these named tests to `tunnel-args.test.ts`:
  - `tunnel and remote file reads disable SSH multiplexing with the same options`
  - `remote file reads preserve the SSH user port host-key policy and quoted path`
  - `SSH options override multiplexing enabled by the user configuration`
  Update the existing exact tunnel-array expectation. For the last test, write a temporary config containing `Host *`, `ControlMaster auto`, `ControlPath /tmp/taskflow-test-master-%h-%p`, `ControlPersist yes`, and `ProxyJump jump.example`. Run `ssh -F <temp-config> -G <builder-args>` for both builders, with no network connection. Assert effective `controlmaster false`, `controlpersist no` and `proxyjump jump.example`, and that no `controlpath` line other than `controlpath none` appears (OpenSSH 10.5p1 prints no `controlpath` line for `ControlPath=none`; older versions may print `controlpath none`). The exact-argv tests separately pin `ControlPath=none`. Skip only if `Bun.which("ssh")` is absent; remove the temporary directory in cleanup.
- [ ] **Step 2:** Extend the executable fake in `tunnel-manager.test.ts` and write `remote port reads pass the shared connection options to ssh`. For a command without `-L`, record argv and print `54892\n`; call the real manager's `readRemotePort(record)` and assert `{ port: 54892 }` plus the three exact overrides in the recorded argv. Retain the existing tunnel-child readiness tests. No `mock.module`.
- [ ] **Step 3:** Run `bun test packages/shared/src/remote/tunnel-args.test.ts packages/shared/src/remote/tunnel-manager.test.ts`. Expected: FAIL on the missing overrides and builder.
- [ ] **Step 4:** Implement the shared options and remote-read builder. Route both SSH connections through them; keep validation and error mapping in the manager.
- [ ] **Step 5:** Run the Step 3 command. Expected: PASS.
- [ ] **Step 6:** Run `bun run typecheck`, then `bun test packages/shared`. Expected: PASS. Run `bunx prettier --check packages/shared/src/remote/tunnel-args.ts packages/shared/src/remote/tunnel-args.test.ts packages/shared/src/remote/tunnel-manager.ts packages/shared/src/remote/tunnel-manager.test.ts` and scoped ESLint on the same files. Fix only changed files; never run the root formatter.
- [ ] **Step 7:** Commit the four changed files with `fix(remote): disable SSH multiplexing for app connections`.

## Task 3.2: Extract the TUI retry policy into shared code

**Files:**

- Create: `packages/shared/src/remote/reconnect-policy.ts` and `packages/shared/src/remote/reconnect-policy.test.ts`.
- Modify: `packages/shared/package.json:8`. Add `"./remote/reconnect-policy": "./src/remote/reconnect-policy.ts"`. The browser must import this pure subpath, since `packages/shared/src/remote/index.ts:1` also exports Node-dependent registry code.
- Modify: `packages/tui/src/opentui/machine-session.ts:51`, `:89`, `:109`, `:148`, `:374`, `:399`, `:463`. Move timer/backoff ownership into the shared policy. Keep machine selection, attaching, retargeting and orphan cleanup in the TUI adapter.
- Modify: `packages/tui/src/opentui/machine-session.test.ts:85`, `:147`, `:263`, `:331`. Reuse `FakeClient`, fake timer scheduling, `harness`, `fireTimers`, and deferred registry results.

**Interfaces:**

```ts
// reconnect-policy.ts. Export the factory; infer its return type at call sites.
export function createReconnectPolicy(deps: {
    attempt(): Promise<boolean>;
    schedule?: (run: () => void, delayMs: number) => () => void;
    random?: () => number;
}): {
    start(): void;
    retryNow(): void;
    setConnected(connected: boolean): void;
    stop(): void;
};
```

- Consumes: one injected asynchronous reattach operation, the TUI's existing cancel-returning scheduler, and socket connectivity notifications. Defaults are `setTimeout`/`clearTimeout` and `Math.random`.
- Produces: the shared retry lifecycle used here and by Task 3.3. `attempt` resolves `true` once the tunnel/client handoff succeeds, `false` for a failed attempt. A rejected promise counts as `false`; the adapter retains the concrete failure for display.
- Keep the current `MachineSessionDeps.schedule` test seam. Add optional `random?: () => number` to that same deps object and pass it to the policy. No exported delay constants or new public error types.

### Behavior

- Extract the policy from `scheduleReattach`/`reattachOnce`, not the TUI's workspace logic. One policy owns one desired remote connection. `start()` requests reattachment and arms the first delay, idempotently. A failed attempt arms the next delay after the attempt settles. A successful attempt disarms retries but retains the failure counter until stable connectivity resets it.
- Nominal delays are 1000, 2000, 4000, 8000, 16000, 30000 ms, then 30000 ms. Implementation detail: calculate `base = min(1000 * 2 ** min(attempt, 5), 30000)` and `delay = min(30000, round(base * (0.8 + 0.4 * random())))`. This makes 30 s a hard upper bound; jitter is clipped at the cap. With `random() === 0.5`, the nominal sequence is exact.
- `setConnected(true)` arms one 60000 ms stability timer on a false-to-true transition. Only its completion resets the failure counter. Repeated true notifications do not restart that timer. `setConnected(false)` cancels it. A flapping connection keeps its previous backoff.
- `retryNow()` replaces a pending retry timer with an immediate attempt without resetting the counter. It does nothing when no reattachment is needed. If an attempt is running, coalesce signals into at most one immediate follow-up after a failure; never run two attempts concurrently. A successful in-flight attempt consumes those signals.
- `stop()` permanently cancels retry and stability timers and invalidates the in-flight attempt. It prevents all later scheduling. The adapter still checks its own generation after each await, because stopping a timer cannot cancel a registry promise or dispose a late tunnel.
- In `MachineSession.reconcile`, feed actual socket connectivity into `setConnected`. A dead tunnel calls `start()`. A socket drop over a live tunnel keeps the socket client's existing retry path. Do not redial SSH for every WebSocket close.
- Keep `reattachOnce` as a single-attempt adapter: call `registry.attachBackend`, validate `parseOrigin`, and call `machine.net.retarget(port, host)` only if the current machine and generation still match. A failure returns false. A late successful result uses existing `dropOrphanTunnel`; switching or shutdown uses existing `cancelReattach` to stop the policy.
- Remove the current `no-backend` terminal branch at `machine-session.ts:429`. It currently sets `stopped` and gives up; design §2 explicitly requires retrying until the user leaves or disconnects. Keep its reason visible while continuing the retry loop. Never automatically trust an unknown or changed key.
- Keep the existing TUI reconnect snapshot route: `packages/tui/src/opentui/workspace.ts:280` calls `controller.reattach()`, which calls every bridge's `attach()` in `packages/tui/src/sessions/controller.ts:209`. Never queue or replay failed `SESSION_INPUT` requests. Wake-triggered retries and jitter avoid waiting through an old delay after network recovery. Reference: t3code `packages/client-runtime/src/connection/supervisor.ts`.

### Steps

- [ ] **Step 1:** Write `reconnect-policy.test.ts` with injected random values, a manual scheduler, and deferred attempts:
  - `retries at one two four eight sixteen and thirty seconds`
  - `applies twenty percent jitter without exceeding thirty seconds`
  - `resets backoff only after sixty seconds of continuous connectivity`
  - `keeps backoff when the connection drops before sixty seconds`
  - `retryNow cancels the old timer and attempts immediately`
  - `coalesces wake signals while an attempt is running`
  - `stop prevents timers and a late attempt from scheduling more work`
  - `rejected attempts retry without an unhandled rejection`
- [ ] **Step 2:** Run `bun test packages/shared/src/remote/reconnect-policy.test.ts`. Expected: FAIL because the module is missing.
- [ ] **Step 3:** Implement the pure policy and package subpath. Run the Step 2 command. Expected: PASS.
- [ ] **Step 4:** Add TUI regressions with `random: () => 0.5` in the existing harness. Preserve existing cancellation tests. Replace `stops retrying when the machine has no backend` with `keeps retrying when the remote backend is stopped`. Add `a short lived reconnect keeps the previous backoff`, `a stable socket resets the next reattach delay`, and `a successful attach after switching machines closes its orphan tunnel`.
- [ ] **Step 5:** Run `bun test packages/tui/src/opentui/machine-session.test.ts`. Expected: FAIL for the new behavior.
- [ ] **Step 6:** Replace the TUI timer implementation with the shared policy and retain its adapter checks. Update fake timer assertions to distinguish retry timers from the new 60000 ms stability timer. Run the Step 5 command. Expected: PASS.
- [ ] **Step 7:** Run `bun run typecheck`, `bun test packages/shared`, and `bun test packages/tui`. Expected: PASS. Check Prettier and scoped ESLint for the new policy, its tests, `machine-session.ts` and its tests, plus Prettier for the changed package manifest.
- [ ] **Step 8:** Commit with `refactor(remote): share tunnel reconnect policy with the TUI`.

## Task 3.3: Automatically reattach desktop remotes

**Files:**

- Create: `packages/ui/src/lib/backend-reconnect.ts` and `packages/ui/src/lib/backend-reconnect.test.ts`. A small per-backend policy owner with injected adapter operations; no second backoff calculation.
- Modify: `packages/ui/src/stores/backend-store.ts:34`, `:116`, `:169`, `:209`, `:307`, `:321`, `:435`, `:456`, `:578`, `:588`.
- Modify: `packages/ui/src/stores/backend-store.test.ts:20`, `:68`, `:75`, `:279`, `:351`; `packages/ui/src/stores/fake-desktop-bridge.ts:28`, `:62`, `:95`.
- Modify: `packages/ui/src/components/sidebar/MachinesMenu.tsx:69`, `:267` and `packages/ui/src/components/sidebar/MachinesMenu.test.tsx:33`, `:54`. Add the explicit reconnecting label and spinner case.

**Interfaces:**

```ts
// backend-reconnect.ts, imported by backend-store.ts.
export function createBackendReconnects(deps: {
    isWanted(id: string): boolean;
    attempt(id: string): Promise<string | null>; // canonical connected id, or failure
    schedule?: (run: () => void, delayMs: number) => () => void;
    random?: () => number;
}): {
    lost(id: string): void;
    setConnected(id: string, connected: boolean): void;
    retryNow(id?: string): void; // omitted id wakes all pending remotes
    rekey(fromId: string, toId: string): void;
    remove(id: string): void;
    dispose(): void;
};
```

- Consumes: Task 3.2's `createReconnectPolicy`, `attach(id): Promise<string | null>`, `attempts`/`nextAttempt`, `keepAttached`, `confirmBackend`, `rekeyConnection`, `followSocket` and `bootstrapBackend`.
- Produces: `MachineState.state` gains the exact member `"reconnecting"`. Existing `"attaching"`, `"attached"`, `"offline"`, `"incompatible"` retain their meanings. The menu string is exactly `reconnecting`.
- Implementation detail: keep one map of controllers in this UI adapter and let the existing store implement attach/handshake; do not move Zustand state into shared code.

### Behavior

- A tunnel-drop event at `backend-store.ts:578` invalidates the old attach generation, closes the dead socket and marks only that remote `reconnecting`, preserving `keepAttached`, its slices and the selected workspace. Start its controller even without discovery. Ignore unknown, local and explicitly detached ids.
- The automatic attempt reuses `attach` and all its protocol/identity checks. Keep the row `reconnecting` through automatic attempts and ordinary transport failures; set `attached` only after handshake and required bootstrap succeed. Keep the latest failure internally for existing error display. An incompatible backend stays `incompatible`; retries may continue, but it is never accepted or shown attached.
- `attach` currently patches `attaching` and `offline` directly. Keep its public signature and use a private per-id automatic-attempt flag to choose reconnecting for that invocation. Clean the flag in `finally`. The attempt succeeds only when the returned canonical row is actually `attached`, not merely when `attach` returns an id. Catch rejected bridge operations and retry.
- Do not invoke existing `retry` blindly from a timer: `backend-store.ts:435` detaches a live tunnel and temporarily clears persisted attachment intent. After a reported tunnel exit, automatic retry can call `attach` directly. Keep manual Retry behavior, but route it through the same controller when recovery is already pending so it cannot race an automatic attach.
- Make `detach` remove the controller before its first await and before invalidating the generation. Removal already calls `store.detach` before main's `removeBackend` in `packages/ui/src/components/sidebar/ManageBackendsDialog.tsx:70`. Also remove controllers for rows removed by `refresh` or whose saved attachment intent becomes false. During an automatic attach, `refresh` must preserve local `keepAttached` just as it does for `attaching` at `backend-store.ts:348`.
- If an attach finishes after detach/removal, do not reconnect its socket or restore the row. Close its newly acquired tunnel through the existing bridge detach path, guarded so it cannot detach a newer attach of the same id. Retain the current generation checks after every await.
- A provisional-id rename transfers controller ownership and stability state alongside `rekeyConnection`/`renameRow`. A merge disposes the surplus controller and keeps the canonical controller. Do not start a new loop under the old id.
- `followSocket` feeds connectivity changes to the controller. A socket-only outage leaves the existing socket retry loop responsible. Successful `rehandshake` and bootstrap mark connectivity healthy. A tunnel exit starts SSH recovery; these two loops must not replace each other concurrently.
- `onBackendSeen` calls `retryNow(id)` for a wanted recovering backend. Retain its async persisted-intent/generation checks. It must neither create a second loop nor reconnect a detached row.
- Keep input handling unchanged: pending input fails on disconnect and is never retried by this policy.

### Steps

- [ ] **Step 1:** Write the injected adapter tests in `backend-reconnect.test.ts`:
  - `a dropped wanted backend retries without a discovery beacon`
  - `two remote backends recover independently`
  - `a detached or removed backend never starts another attempt`
  - `a canonical id rename keeps one reconnect controller`
  - `merging an alias keeps only the canonical reconnect controller`
  - `manual retry and a beacon share the pending attempt`
  - `a failed bootstrap does not count as a successful reconnect`
- [ ] **Step 2:** Run `bun test packages/ui/src/lib/backend-reconnect.test.ts`. Expected: FAIL. Implement the per-id owner over the shared policy. Run again. Expected: PASS.
- [ ] **Step 3:** Add store regressions using `installFakeBridge`, `emitBackendDropped`, real port-zero `startBackend`, and deferred fake bridge calls:
  - `a tunnel exit keeps the desired machine reconnecting and preserves its data`
  - `a remote reconnects automatically without receiving a beacon`
  - `detaching during an automatic attach wins over its late result`
  - `refresh preserves attachment intent while a reconnect is in flight`
  - `an automatic reconnect still refuses a different backend uid`
  - `a protocol mismatch remains incompatible during automatic recovery`
  Update existing tunnel-drop expectations from offline to reconnecting where appropriate. Add `the machines menu labels a reconnecting backend and keeps it checked` to the existing menu tests. Use the existing short real-socket waits for the store wiring test; delay mathematics belongs in injected adapter/policy tests.
- [ ] **Step 4:** Run `bun test packages/ui/src/stores/backend-store.test.ts packages/ui/src/components/sidebar/MachinesMenu.test.tsx`. Expected: FAIL.
- [ ] **Step 5:** Wire the adapter into the store and update the menu label/spinner. Extend fake-bridge cleanup to stop pending recovery via normal detach before resetting the store; real timers must not leak into later tests. Run Step 4 again. Expected: PASS.
- [ ] **Step 6:** Run `bun run typecheck` and `bun test packages/ui`. Expected: PASS. Check Prettier and scoped ESLint for the new adapter, both new/changed tests, store, fake bridge and menu.
- [ ] **Step 7:** Commit with `fix(ui): automatically reconnect dropped remote backends`.

## Task 3.4: Wake pending recovery on resume and network change

**Files:**

- Create: `electron/src/remote-wakeup.ts` and `electron/src/remote-wakeup.test.ts`. Keep this helper Electron-free by accepting an event-source dependency.
- Modify: `electron/src/main.ts:1`, `:194`, `:232`. Register the resume listener after `app.whenReady()` and remove it on the actual quit path.
- Modify: `electron/src/preload.ts:303` and `packages/ui/src/env.d.ts:111`. Expose the resume notification beside the existing backend events.
- Modify: `packages/ui/src/stores/backend-store.ts:576` and `packages/ui/src/stores/fake-desktop-bridge.ts:28`. Subscribe to resume and DOM `online` and wake pending controllers.
- Modify: `packages/ui/src/stores/backend-store.test.ts:351`. Test the event-to-retry wiring with the existing fake bridge.

**Interfaces:**

```ts
// remote-wakeup.ts
export function installRemoteWakeup(deps: {
    source: {
        on(event: "resume", listener: () => void): unknown;
        removeListener(event: "resume", listener: () => void): unknown;
    };
    notify(): void;
}): () => void;

// preload bridge and env.d.ts
onRemoteResume(callback: () => void): () => void;
```

- Main passes Electron `powerMonitor` as `source` and sends the exact IPC channel `remote-resume` to the current main window from `notify`. The preload wrapper listens to `remote-resume` and removes precisely its own listener on unsubscribe.
- Renderer handles `window.addEventListener("online", ...)` and `window.taskflow?.onRemoteResume(...)` with `reconnects.retryNow()`. These are local platform signals, distinct from `useConnectivity`'s backend internet-status messages.

### Behavior

- Resume and online cancel the outstanding retry delay and attempt recovery now. A healthy connection is left intact. Simultaneous resume, online and discovery signals coalesce through the shared controller.
- Registration is once per main/renderer lifetime. Store initialization already registers desktop listeners at module scope; follow that ownership. Unsubscribe on renderer teardown or hot disposal, and stop the controller owner as well. The fake bridge captures the callback and resets it between tests.
- Reconnect success must restore terminal state through snapshots, never input replay. The TUI already wires that path. The missing web reconnect path is recorded below and is planned explicitly in Section 6; include it in final cross-section verification.
- Neither task changes CLI syntax, environment or commands; both CLI implementations stay untouched.

### Steps

- [ ] **Step 1:** Write `remote-wakeup.test.ts` with an injected event emitter and recording `notify`: `resume requests an immediate remote retry` and `disposing the wake listener stops resume notifications`. Follow the dependency-fake style of `electron/src/notification-poller.test.ts:28`, without importing Electron at runtime.
- [ ] **Step 2:** Add store tests `OS resume wakes a pending remote reconnect`, `online wakes a pending remote reconnect`, and `resume and online do not reconnect an explicitly detached backend`. Extend the existing fake bridge with an `emitRemoteResume` helper and removable subscriptions.
- [ ] **Step 3:** Run `bun test electron/src/remote-wakeup.test.ts packages/ui/src/stores/backend-store.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement the helper, main/preload/type wiring and renderer listeners. Run Step 3 again. Expected: PASS.
- [ ] **Step 5:** Run `bun run typecheck`, `bun test packages/shared`, `bun test packages/tui`, `bun test packages/ui`, and `bun test electron`. Expected: PASS. Check Prettier and scoped ESLint on this task's changed TS files. Run `git diff --check`.
- [ ] **Step 6:** Commit with `fix(desktop): retry remote connections on resume and online`.
- [ ] **Step 7:** Record the shared policy import, wake channel, canonical-id ownership and passing commands in `handoff.md`. Section 4 adds token refresh to the existing attempt lifecycle, not a competing reconnect timer. Section 6 (run before this one) already covers web terminal resync on reconnect. Commit the handoff with `docs(plan): record remote reconnect handoff`. Never push.

## Planner decisions (2026-10-30)

- **Web terminal resync on reconnect is Section 6's Task 6.3.** The chain runs Section 6 before Section 3 (index order: 1, 2, 6, 3, 4, 5, 7 …), so when this section runs, the web UI already resnapshots after a reconnect. Section 3 adds no replay path of its own. Its terminal acceptance item is in Section 13.
- **A stale cached port is refreshed over ssh.** Add Task 3.5 below. An explicitly entered port is a fallback, not a fixed override: it's kept, and retried, when the remote port file can't be read.

## Task 3.5: Refresh a stale cached port over SSH

**Files:** Modify `packages/shared/src/remote/backend-registry.ts` (~127 candidate order, ~320 final failure) and `packages/shared/src/remote/backend-registry.test.ts` (reuse the injected `registry(overrides)` helper at ~43).

**Behavior:** after every cached and discovered candidate has failed, read the remote port once over ssh (`readRemotePort`, the existing builder). If it names a port not yet tried in this attempt, try it, and remember it on success. If the read fails, return the last tunnel failure as today, and keep any explicitly entered port for later retries. A successful cached port causes no ssh read.

- [ ] **Step 1:** Tests: `a failed cached port is refreshed over SSH without a discovery beacon`, `a successful cached port does not issue an extra SSH read`, `an unavailable remote port file retains the explicit port for later retries`, `a refreshed port equal to one already tried is not tried twice`.
- [ ] **Step 2:** Run `bun test packages/shared/src/remote/backend-registry.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Run Step 2 again. Expected: PASS. Then `bun run typecheck` and `bun test packages/shared`. Expected: PASS.
- [ ] **Step 4:** Commit `fix(remote): refresh a stale cached port over ssh`.
