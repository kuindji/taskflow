# Section 6: Terminal replay and dropped-output recovery

Read `handoff.md`, the index and `design.md` first. Apply design §3 to both clients. Section 3 supplies automatic tunnel recovery, but the terminal changes below also work with the current manual reconnect path. All commands are instructions for the later implementer, run from the repository root.

## Sequence and snapshot facts

- Output numbering is contiguous **per session**, not global and not per client. `packages/backend/src/services/pty-manager.ts:149` initializes from `startSequence ?? 0`; `:260` increments exactly once per emitted `DataBatcher` batch and calls `options.onData(batchedData, sequence)` at `:274`.
- `packages/backend/src/services/session-lifecycle.ts:616` queues persistence and broadcasts that same `{ sessionId, data, sequence }` at `:637`. No intermediate output filter consumes numbers. Resumed sessions use the persisted `priorHistory.lastSequence` at `:612`. Thus `sequence > previous + 1` is a real gap once a snapshot/history watermark has established the baseline.
- A snapshot's `lastSequence` is the last batch **parsed by headless xterm**, not the last batch issued. `pty-manager.ts:405` returns `session.parsedSequence` at `:431`; it can trail output already received by a client. Keep recent received chunks across a replacement, as the TUI already does, so a replacement cannot erase the trailing batches.
- `SESSION_HISTORY` returns `{ data, lastSequence }`. The lifecycle's `readSessionHistory` at `session-lifecycle.ts:892` runs on the same per-session queue as output persistence, which makes it the fallback when a headless snapshot is too far behind to bridge from retained chunks.
- `SESSION_EXITED` has no output sequence. Its local display marker must not advance the sequence baseline or trigger a gap.

## Task 6.1: Tell each slow client which sessions need replacement

**Files:**

- Modify: `packages/shared/src/constants.ts:97`. Add `TERMINAL_RESYNC: "terminal:resync"` next to `TERMINAL_OUTPUT`.
- Modify: `packages/shared/src/types/ws.ts:210`. Add `TerminalResyncEvent` beside `TerminalOutputEvent`. The existing wildcard export at `packages/shared/src/index.ts:7` already exports the new type; no barrel edit is needed.
- Create: `packages/backend/src/ws/terminal-broadcaster.ts` and `packages/backend/src/ws/terminal-broadcaster.test.ts`. Extract the current broadcast loop into this dependency-injected helper so backpressure/drain can be tested without replacing Bun modules or requiring real network congestion.
- Modify: `packages/backend/src/ws/server.ts:9`, `:14`, `:31`, `:44`, `:101`, `:112`, `:168`. Delegate broadcast, wire `websocket.drain`, and release dirty records on close/stop. These anchors include the current agent-browser CDP gateway wiring. Preserve that wiring and the auth gate from Section 1 (Sections 1 and 2 have run when this section starts).
- Modify (snapshot parser wait, see Planner decisions): `packages/backend/src/services/pty-manager.ts:405`, `packages/backend/src/handlers/session.ts:137`, `packages/backend/src/api/routes/session-routes.ts:306`; tests `packages/backend/tests/services/pty-manager-snapshot.test.ts`, `packages/backend/tests/handlers/session.test.ts:97`, `packages/backend/tests/api/routes.test.ts:12`.
- Existing integration coverage: `packages/backend/src/ws/server.test.ts:16`, `:40`, `:100` uses real port-zero Bun servers, connection counts and disconnect cleanup. Keep those tests passing.

**Interfaces:**

```ts
// shared types/ws.ts. This is the event payload, matching TerminalOutputEvent style.
export interface TerminalResyncEvent {
    sessionIds: string[];
}

// backend ws/terminal-broadcaster.ts
export interface BroadcastOptions {
    dropOnBackpressure?: boolean;
}
export function createTerminalBroadcaster<T extends {
    getBufferedAmount(): number;
    send(data: string): number;
}>(clients: Iterable<T>): {
    broadcast(event: WsEvent, opts?: BroadcastOptions): void;
    drain(client: T): void;
    forget(client: T): void;
    clear(): void;
};
```

- Consumes: the live client set from `createServer`, existing `WsEvent` and `TerminalOutputEvent`, and the unchanged `dropOnBackpressure` caller in `session-lifecycle.ts:637`.
- Produces: a server-to-client event with no correlation id: `{ type: MSG.TERMINAL_RESYNC, payload: { sessionIds } }`. The exact wire string is `terminal:resync`. No router handler or client request type is added.
- Move `BroadcastOptions` to the helper and import it into `server.ts`; it has a real production consumer. Keep the threshold private to the helper. `createServer`'s public methods remain unchanged.

### Behavior

- Preserve the current skip threshold exactly: skip droppable broadcasts when `getBufferedAmount() > 1_048_576`. Preserve the server's `2 * 1024 * 1024` backpressure limit.
- When the skipped event is `MSG.TERMINAL_OUTPUT`, add its `sessionId` to that socket's dirty set. Deduplicate session ids and keep dirty sets separate for different sockets. A skipped non-terminal event never invents a terminal session id.
- The server's Bun `websocket.drain(ws)` calls the helper's `drain(ws)` only for an app socket, following the existing `ws.data.kind` dispatch. Preserve CDP socket handling. If that app socket has dirty sessions, send exactly one event listing them in first-dirtied order, then clear that batch. Send only to that socket, not through global broadcast. An empty set sends nothing.
- Bun's numeric `send` result matters: a nonzero result means sent or queued and permits clearing; `0` means not accepted, so retain the batch until another drain or socket close. A new skip after an accepted resync creates a new dirty batch.
- `close(ws)` forgets its dirty state before the existing disconnect callback. Server stop clears all dirty records. Keep non-droppable broadcasts and request responses unchanged.
- Do not attempt output retransmission on the backend. The client gets an authoritative replacement using its existing attach request. This repairs terminal state after overflow. Reference: t3code `apps/server/src/terminal/OutputProtocol.ts`.
- No code needs copying from t3code for this helper. If an implementation copies a block, attach the exact attribution format from `design.md` with the repo-relative source path.

### Steps

- [ ] **Step 1:** Write helper tests with structural fake sockets whose buffered amounts and send results are controlled through constructor/deps state:
  - `dropping terminal output marks only that client and session dirty`
  - `drain sends one terminal resync event with deduplicated session ids`
  - `draining a clean client sends nothing`
  - `a failed resync send retains the dirty sessions`
  - `output dropped after a resync causes another resync on drain`
  - `forget and clear release dirty client state`
  - `non-droppable broadcasts still reach a backpressured client`
  - `the backpressure threshold is strictly greater than one mebibyte`
  Assert the full serialized event, including `"type":"terminal:resync"`, and assert that healthy clients receive output but no resync. Use session ids `s1` and `s2` and a second client to catch accidental global signaling.
- [ ] **Step 2:** Run `bun test packages/backend/src/ws/terminal-broadcaster.test.ts`. Expected: FAIL because the helper and message constant are missing.
- [ ] **Step 3:** Add the shared constant/type, implement the helper, and delegate the server's broadcast/drain/close/stop callbacks to it. Reuse existing auth checks for accepted clients. Do not register unauthorized sockets with this helper.
- [ ] **Step 4:** Run `bun test packages/backend/src/ws/terminal-broadcaster.test.ts packages/backend/src/ws/server.test.ts`. Expected: PASS.
- [ ] **Step 5:** Run `bun run typecheck`, `bun test packages/shared`, and `bun test packages/backend`. Expected: PASS. Check Prettier and scoped ESLint on the changed constants/types, broadcaster/test and server. Run `git diff --check`.
- [ ] **Step 6:** Commit with `fix(backend): request terminal resync after dropped output`.

## Task 6.2: Hold web replay suppression through xterm parsing

**Files:**

- Modify: `packages/ui/src/lib/time-budgeted-writer.ts:20`, `:59`, `:86`, `:128`. Track writes submitted to xterm but not yet acknowledged by their sentinel callbacks.
- Modify: `packages/ui/src/lib/time-budgeted-writer.test.ts:4`, `:28`. Reuse `FakeTerminal`, held callbacks and the manually driven animation-frame callback.
- Create: `packages/ui/src/components/panes/terminal/terminal-attachment.ts` and `packages/ui/src/components/panes/terminal/terminal-attachment.test.ts`. Extract the request/replay state out of the lifecycle closure, with injected terminal and request operations. This is UI-only async writer logic, not a new terminal framework.
- Modify: `packages/ui/src/components/panes/terminal/terminal-lifecycle.ts:34`, `:131`, `:235`, `:265`, `:291`, `:314`, `:343`. Replace the closure's replay bookkeeping with the attachment helper and expose it on each cached terminal.
- Modify: `packages/ui/src/components/panes/TerminalPane.tsx:168`, `:193`, `:225`, `:442`. Route mounted `onData` and direct Shift+Enter/drop sends through the same replay gate.
- Existing test conventions: `packages/ui/src/components/panes/terminal/terminal-links.test.ts:34` uses Bun assertions and real stores; `packages/ui/tests/preload.ts:59` supplies the DOM without replacing Bun networking/timers. The new helper tests need no xterm renderer, GPU or module mocks.

**Interfaces:**

```ts
// terminal-attachment.ts. Factory and inferred return type have lifecycle consumers.
export function createTerminalAttachment(deps: {
    sessionId: string;
    requestSnapshot(): Promise<SessionSnapshotResponse>;
    requestHistory(): Promise<SessionHistoryResponse>;
    writer: { write(data: string): void; flush(): Promise<void> };
    reset(): void;
    scrollToBottom(): void;
}): {
    ensureLoaded(): Promise<void>;
    resync(): Promise<void>;
    receiveOutput(event: TerminalOutputEvent): void;
    receiveExit(exitCode: number): void;
    forwardInput(data: string, send: (data: string) => void): void;
    dispose(): void;
};
```

- Consumes: existing `SessionSnapshotResponse`, `SessionHistoryResponse`, `assertCompatibleSnapshot`, `supplementalSnapshotSequence`, `TimeBudgetedWriter`, and lifecycle's `requestFromSessionMachine<T>(type, payload)` at `terminal-lifecycle.ts:259`.
- Reuse `sessionWorkspace(sessionId, taskId, projectId, master)` from `packages/ui/src/components/panes/terminal/terminal-links.ts:51` when constructing history-owner fields. It follows the tab's current owner after a session move; keep the snapshot request scoped by session id and backend.
- Produces: `CachedTerminal.attachment: ReturnType<typeof createTerminalAttachment>` and the existing `ensureHistoryLoaded(): Promise<void>` method, implemented as `attachment.ensureLoaded()`. Keep existing mount callers working.
- `TimeBudgetedWriter.write(data): void` and `flush(): Promise<void>` retain their signatures. `forwardInput` is used by `TerminalPane` and exercised with an injected send callback in helper tests; it is not a test-only export.
- Implementation detail: extract the existing snapshot/history request logic into this plain factory; inject narrow operations rather than mocking imported xterm classes.

### Behavior

- The writer's current `flush()` returns immediately if its string buffer is empty, even when `term.write` has not called its sentinel. Fix that condition. Track pending sentinel callbacks and resolve flush waiters only when the string buffer is empty **and** every submitted frame's sentinel has fired. The empty-frame path at `:88` must use the same condition. An earlier frame's callback must not resolve a flush for a later unparsed frame.
- Preserve write budgets, chunk boundaries, renderer callbacks and `visible`. Disposal still releases waiters; the attachment's disposed/generation check prevents those resolutions from re-enabling or writing to a destroyed terminal.
- Before the first snapshot/history write, set replay suppression. Keep it set through the snapshot, `supplementalSnapshotSequence`, buffered replay catch-up and the final `await writer.flush()`. Clear it only after xterm has parsed the last replay chunk. Empty snapshots/history must also wait for any queued writes.
- `forwardInput` drops every value while replay suppression is active, including generated terminal responses and user keys. It forwards once outside that interval and never queues input for later. This is the accepted loss window in design §3. Reference: t3code `apps/web/src/terminal/ghostty/core.ts`, `resetAndWrite`.
- `TerminalPane`'s `term.onData` calls `cached.attachment.forwardInput(data, send)` after the existing interrupted-session check. Do not use a React state value captured at mount; callbacks read the attachment's current gate. Apply the same gate to direct Shift+Enter and drag/drop sends so those paths cannot bypass the accepted input-loss window.
- Ordinary live terminal queries still generate one response to the current PTY. Preserve the exact exit marker `\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`.
- Initial attach and every resync fall back from a null/unavailable snapshot to `SESSION_HISTORY` (a stalled parser answers `null`; see Planner decisions). For a repeat attachment, fetch before resetting the displayed terminal: a failed fetch must not erase a previously good screen. Reset only once a valid replacement is ready, after draining older writes. Apply snapshot supplemental mouse, cursor and Kitty state exactly as today.
- Keep one attachment operation in flight. `ensureLoaded()` is idempotent after success; `resync()` requests a fresh operation rather than reusing a resolved promise forever. If another explicit resync arrives while one is pending, retain a dirty flag for one follow-up instead of starting overlapping snapshot requests.
- Attach errors and destruction must release replay suppression. An invalid non-null snapshot remains a compatibility error; never bypass `assertCompatibleSnapshot` by treating it as a valid replacement. The prior screen survives a failed repeat attach.

### Steps

- [ ] **Step 1:** Extend writer tests:
  - `flush waits for xterm when the JavaScript buffer is already empty`
  - `an earlier sentinel cannot resolve flush while a later frame is unparsed`
  - `an empty animation frame cannot resolve flush before pending sentinels`
  Hold the sentinel callbacks explicitly and assert that promises remain unsettled before invoking them. Keep the existing hook-order test.
- [ ] **Step 2:** Run `bun test packages/ui/src/lib/time-budgeted-writer.test.ts`. Expected: FAIL. Implement pending-sentinel accounting. Run again. Expected: PASS.
- [ ] **Step 3:** Write attachment tests with deferred snapshot/history responses, a fake writer with independently held flush completion, and a recording input sink:
  - `snapshot replay drops terminal replies and user keys until parsing completes`
  - `history replay drops terminal replies until its final flush completes`
  - `supplemental snapshot state remains inside the replay suppression window`
  - `live terminal replies are sent once after replay completes`
  - `a failed replacement preserves the last good screen and releases suppression`
  - `disposing during a pending snapshot never writes to the terminal`
  - `ensureLoaded is idempotent but resync fetches a fresh snapshot`
  Emit exact query strings `\x1b[5n` and `\x1b[6n` through the fake write operation, simulate replies `\x1b[0n` and `\x1b[1;1R` through `forwardInput`, and assert no input requests during replay. Also try a literal user key `x`. After the final callback/flush, assert a live reply forwards once.
- [ ] **Step 4:** Run `bun test packages/ui/src/components/panes/terminal/terminal-attachment.test.ts`. Expected: FAIL. Implement the factory and wire it into lifecycle/Pane. Preserve current initialization, sizing and renderer setup. Run again with the writer tests. Expected: PASS.
- [ ] **Step 5:** Run `bun run typecheck` and `bun test packages/ui`. Expected: PASS. Check Prettier and scoped ESLint for the writer/tests, attachment/tests, lifecycle and Pane. Run `git diff --check`.
- [ ] **Step 6:** Commit with `fix(ui): suppress terminal input through replay completion`.

## Task 6.3: Resync web terminals on events, gaps and reconnects

**Files:**

- Modify: the attachment/helper and tests created in Task 6.2.
- Modify: `packages/ui/src/components/panes/terminal/terminal-lifecycle.ts:240`, `:251`, `:314`, `:348`. Subscribe cached terminals to `MSG.TERMINAL_RESYNC` and dispose all subscriptions with their cached terminal.
- Create: `packages/ui/src/lib/backend-ready.ts`. A small in-process notification shared by the backend store and lifecycle, to trigger reattachment only after backend identity checks succeed.
- Modify: `packages/ui/src/stores/backend-store.ts:301`, `:391`, `:419`, `:431`. Publish readiness after successful handshake and required bootstrap, using the current canonical id and current attempt generation.
- Modify: `packages/ui/src/stores/backend-store.test.ts:20`, `:104`, `:125`, `:163`. Reuse its fake main bridge and real WebSocket backend for readiness ordering tests.
- Modify: `packages/ui/src/providers/WebSocketProvider.tsx` (`connectDevRenderer`). The plain-browser dev renderer opens its socket directly and never runs `attach`/`rehandshake`, so it publishes readiness itself: subscribe `onStatusChange(LOCAL_BACKEND_ID, …)` and call `notifyBackendReady(LOCAL_BACKEND_ID)` on each transition to connected after the first one (the first connect is the initial mount, not a recovery). Create `packages/ui/src/providers/WebSocketProvider.test.tsx` with `the dev renderer publishes backend ready when its socket reconnects` (real port-zero backend, no `window.taskflow`, `VITE_BACKEND_PORT` and Section 2's `VITE_BACKEND_TOKEN` set through `process.env`, which Bun aliases as `import.meta.env`; render the provider the way existing `.test.tsx` files render components; stop and restart the server on the same port, record `onBackendReady` ids; assert none on the first connect and one `local` after the reconnect).
- Create: `packages/ui/src/components/panes/terminal/terminal-lifecycle.test.ts`. Exercise event routing/subscription disposal through injected operations, without constructing Canvas/WebGL addons.
- Reuse unchanged: `packages/ui/src/lib/connection-registry.ts:152` provides `onEvent(type, (payload, backendId) => void): () => void`. Use `sessionBackend(sessionId): string | null` from `packages/ui/src/stores/session-store.ts:97`, already called at `terminal-lifecycle.ts:260`, for routing.

**Interfaces:**

```ts
// backend-ready.ts. Both exports have production consumers.
export function notifyBackendReady(backendId: string): void;
export function onBackendReady(handler: (backendId: string) => void): () => void;
```

- Consumes: `TerminalResyncEvent` from Task 6.1, output sequence facts above, and the existing machine-specific request helper. `notifyBackendReady` is a local callback fan-out, not a new WS message.
- Produces: one fresh snapshot attach for each cached terminal affected by a resync event or validated reconnect. Uncached sessions load a fresh snapshot when later mounted; no terminal is created just to answer the event.
- For testable wiring, extract a used `subscribeTerminalRecovery` function within `terminal-attachment.ts` with these exact deps and return type:

```ts
export function subscribeTerminalRecovery(deps: {
    sessionId: string;
    backendId(): string | null;
    onResync(handler: (payload: TerminalResyncEvent, backendId: string) => void): () => void;
    onReady(handler: (backendId: string) => void): () => void;
    resync(): Promise<void>;
}): () => void;
```

Lifecycle passes the existing event registry and `onBackendReady`; tests pass recording subscription fakes. Swallow subscription-triggered promise rejections at the callback boundary after the attachment has retained its dirty state.

### Behavior

- A resync payload affects a cached terminal only when its `sessionId` occurs in `sessionIds` and the event's `backendId` matches `sessionBackend(sessionId)`. A ready notification affects only that backend's cached terminals. Never request a remote terminal's snapshot from primary or another backend.
- On a recovery trigger, enter buffering **before requesting** the snapshot. Keep the existing screen visible during the request. Capture recent live chunks as well as chunks arriving during the request, because headless parsing can lag already delivered output. Implementation detail: reuse the TUI's recent retention convention of `128 * 1024` string code units; it is a replay bridge, not a new scrollback store.
- After an authoritative replacement with watermark `S`, discard buffered numbered chunks `<= S`, apply newer contiguous chunks in order, and update the last accepted sequence. Never append the snapshot to the old screen. Drain old writer work before reset, then use Task 6.2's suppression through all replacement writes and flush completion.
- Once loaded, ignore duplicate/stale output `sequence <= lastAccepted`; append `lastAccepted + 1` and advance; a larger sequence buffers that chunk and requests resync before writing it. The initial baseline comes from the first successful snapshot/history response, never from an assumption that the first observed sequence is 1. Other sessions' counters do not affect it.
- If retained chunks cannot bridge from a lagging snapshot watermark to the highest received sequence, fall back to queued `SESSION_HISTORY` before committing that replacement. In particular, do not treat an unresolved gap as repaired just because the snapshot request succeeded. Recheck continuity after replay catch-up; a new drop while attaching keeps the dirty flag set for another attach. Do not create a tight retry loop for repeated incomplete responses.
- Keep exit markers separate from numbered chunks and retain them through a pending replacement. A marker is displayed once and never changes the sequence counter.
- A failed repeat attach retains the last good screen and dirty state; subsequent resync, fresh output or backend-ready notification retries it with a single operation. Do not revert to the old web fallback that writes potentially discontinuous pending chunks and permanently marks history loaded.
- Publish `notifyBackendReady` only after required bootstrap completed and the row remains attached for the current attempt. `attach` currently marks attached before bootstrapping and can return an id after bootstrap sets the row offline, so check the final row. `rehandshake` needs the same final check. A protocol mismatch or refused uid publishes nothing. This avoids snapshot requests against an unverified replacement backend.
- A ready notification also repairs a quiet terminal which lost its last output while the socket was disconnected. Gap detection alone cannot detect a missing tail with no later chunk. The resync event handles the corresponding still-connected backpressure case.

### Steps

- [ ] **Step 1:** Extend `terminal-attachment.test.ts` with:
  - `a sequence gap buffers output and requests a fresh snapshot`
  - `another session counter never creates a gap in this session`
  - `a snapshot watermark filters old chunks and flushes newer chunks once`
  - `a lagging snapshot retains recent chunks already displayed before resync`
  - `an unbridgeable snapshot falls back to queued session history`
  - `duplicate output does not write twice or trigger recovery`
  - `resync during an in flight attach coalesces into one follow up`
  - `an exit marker during resync is shown once without changing the output sequence`
  - `a failed resync keeps the good screen dirty for the next recovery trigger`
  Use snapshot watermark 4, stale chunk 4, fresh chunks 5 and 6, and a true gap from 6 to 8. Hold the response and flush separately; assert write order and the number of snapshot/history requests.
- [ ] **Step 2:** Write `terminal-lifecycle.test.ts` against `subscribeTerminalRecovery` with injected event/ready subscriptions:
  - `terminal resync requests attachment only for listed sessions on the emitting backend`
  - `backend ready requests a fresh attachment even when no new output arrives`
  - `disposing a cached terminal removes resync and ready subscriptions`
  Verify the session's current backend is read when the signal arrives, not captured before a canonical-id rename.
- [ ] **Step 3:** Run `bun test packages/ui/src/components/panes/terminal/terminal-attachment.test.ts packages/ui/src/components/panes/terminal/terminal-lifecycle.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement sequence tracking, retained chunks, replacement buffering, the local backend-ready fan-out and event subscriptions. Keep `CachedTerminal.ensureHistoryLoaded` for initial mount and call `attachment.resync` for recovery. Dispose subscriptions and invalidate pending work in `destroyTerminal`. Run Step 3 again. Expected: PASS.
- [ ] **Step 5:** Add store tests `backend ready is published after the canonical handshake and required bootstrap`, `failed bootstrap does not publish backend ready`, and `an incompatible or refused backend never publishes backend ready`. Subscribe through `onBackendReady` and record notification ids; hold a required task/project response to verify ordering. Run `bun test packages/ui/src/stores/backend-store.test.ts packages/ui/src/providers/WebSocketProvider.test.tsx`. Expected: FAIL.
- [ ] **Step 6:** Wire both store notification sites and the dev renderer's reconnect into the ready fan-out. Run Step 5 again. Expected: PASS. Preserve Section 3's reconnect states/controller if already implemented; this task owns terminal readiness, not its SSH retry loop.
- [ ] **Step 7:** Run `bun run typecheck` and `bun test packages/ui`. Expected: PASS. Check Prettier and scoped ESLint on the changed attachment/tests, lifecycle/tests, backend-ready helper and backend store/tests. Run `git diff --check`.
- [ ] **Step 8:** Commit with `fix(ui): resync terminal state after output loss and reconnect`.

## Task 6.4: Resync TUI terminals through the same snapshot contract

**Files:**

- Modify: `packages/tui/src/opentui/session-bridge.ts:3`, `:31`, `:43`, `:78`, `:97`, `:140`, `:146`, `:178`, `:187`, `:251`.
- Modify: `packages/tui/src/opentui/session-bridge.test.ts:10`, `:43`, `:91`, `:134`, `:150`, `:173`, `:288`. Extend `FakeNet` with an optional deferred request handler; retain its existing `responses`, `requests`, `emit` and unsubscribe helpers.
- Reuse unchanged: `packages/tui/src/opentui/workspace.ts:280` and `packages/tui/src/sessions/controller.ts:209` already reattach bridges on reconnect. Their calls must share the same coalesced attach operation as the new event/gap triggers.
- Read-only sequence verification reference: existing `packages/backend/tests/services/pty-manager-snapshot.test.ts:48` covers restored history and baseline 7. No backend sequence format or persistence change is required.

**Interfaces:**

- Consumes: `TerminalResyncEvent`, existing `NetLike.on(type, handler): () => void`, and the same `SessionSnapshotResponse`/`SessionHistoryResponse` contract as web.
- Produces: unchanged public `SessionBridge.attach(): Promise<void>`. Both event and gap triggers invoke it and catch errors at their fire-and-forget boundary. Keep `SessionOwner`, `setInputEnabled`, resizing, clipboard and renderer APIs unchanged.
- Implementation detail: keep the synchronous OpenTUI replay adapter in this class; reuse its `writeReplay`, `beginReplacement`, `finishReplacement`, `recent` and existing parser filters rather than importing the web writer/controller.

### Behavior

- Subscribe once to `MSG.TERMINAL_RESYNC` in the constructor beside output/exit events. If the payload lists this bridge's session, request `attach()`. The bridge's net belongs to one machine already, so no desktop-style backend lookup is needed. Store the unsubscribe in `disposers`.
- Change `attach` from an unbounded promise chain of replacement operations to one active operation plus one dirty follow-up. At the start, before the first `net.request`, buffer arriving live chunks. The current `beginReplacement` at `:178` runs only after the request and is too late for this invariant. Preserve its existing screen while fetching; separate begin-buffering from reset/apply.
- Seed recovery buffering from `takeRecent()` and retain sequence continuity through the same rules as web. Apply a replacement once, preserve snapshot supplemental state, then replay only newer numbered chunks and sequence-null exit markers. If recent retention cannot cover a lagging snapshot, use `SESSION_HISTORY`. Do not erase a good screen when both requests fail.
- Detect gaps only after a snapshot/history baseline exists. Ignore stale/duplicate numbered chunks; a forward gap starts attach and holds the gapped chunk. Never count null-sequence exit markers. Retain dirty status when attach cannot establish continuity, with the same next-trigger retry rule as web.
- Keep `writeReplay`'s response suppression at `session-bridge.ts:108`: OpenTUI writes synchronously, so its try/finally already covers parsing. Replacement catch-up goes through `writeReplay`, not `writeLive`. Live replies still pass to `sendInput` after attach. Preserve OSC 52 suppression during replay and forwarding only from ordinary live output.
- `destroy()` unsubscribes resync and invalidates active attach work before destroying the renderable. After every request await, check destroyed/generation before resetting, writing or completing. There must be no writes or resize/input requests from a late response after destruction.
- Keep the existing `keeps the last good screen after a failed reconnect` and compatibility tests. A non-null incompatible snapshot still rejects with the existing message containing `Upgrade the remote backend`.
- Reconnection never retries `SESSION_INPUT`. This section changes terminal output recovery only; neither CLI implementation changes.

### Steps

- [ ] **Step 1:** Add these tests using `createTestRenderer`, the real `SessionBridge` and injected `FakeNet`:
  - `terminal resync reattaches only the listed bridge session`
  - `a live output gap reattaches without waiting for terminal resync`
  - `output received during resync is buffered until the replacement is applied`
  - `a lagging replacement snapshot replays recent newer chunks once`
  - `unbridgeable snapshot history falls back to session history`
  - `repeated resync signals coalesce while attach is pending`
  - `an exit marker during resync is displayed once and does not create a gap`
  - `resync replay suppresses terminal replies and clipboard writes`
  - `destroying during resync ignores the late snapshot and removes subscriptions`
  Keep the existing live-response and OSC 52 tests as regression coverage. Use `s1`/`s2`, watermark 4, chunks 5/6 and gap 8, matching the web fixtures. Assert rendered screen content and recorded `SESSION_SNAPSHOT`, `SESSION_HISTORY` and `SESSION_INPUT` requests.
- [ ] **Step 2:** Run `bun test packages/tui/src/opentui/session-bridge.test.ts`. Expected: FAIL for event/gap recovery and early buffering.
- [ ] **Step 3:** Implement the subscription, coalesced attachment and sequence rules while preserving the synchronous replay helper and existing native renderer. Run Step 2 again. Expected: PASS.
- [ ] **Step 4:** Run `bun run typecheck`, `bun test packages/shared`, `bun test packages/backend`, `bun test packages/ui`, and `bun test packages/tui`. Expected: PASS. Check Prettier and scoped ESLint on the changed bridge and tests. Run `git diff --check`.
- [ ] **Step 5:** Commit with `fix(tui): resync terminal state after dropped output`.
- [ ] **Step 6:** Record the exact event/type, per-session sequence proof, readiness hook, and passing commands in `handoff.md`. Section 13 items 10–11 already list the acceptance cases: replay `CSI 5n`/`CSI 6n` without PTY replies in web, ordinary live queries still reply, a dropped tail repairs on drain without a later chunk, output loss repairs without remount in both clients, and a recovered remote restores a quiet terminal without input replay. Check running apps/simulators before any later manual verification. Commit the handoff with `docs(plan): record terminal recovery handoff`. Never push.

## Planner decisions (2026-10-30)

- **Snapshots wait for the parser.** `SESSION_SNAPSHOT` captures the session's issued output sequence when the request arrives, then waits until the headless parser has consumed up to it. The payload is unchanged. The wait is bounded at 2000 ms; on timeout it answers `snapshot: null` (the same response shape as a restore-pending session, `pty-manager.ts:405-416`, with `lastSequence: 0`) and logs `snapshot returned before parser caught up` with the session id. A timed-out snapshot must never look complete: with the parser stuck at 9 and the issued tail 10 never delivered, returning the parsed state would report 9 to a client that also knows only 9, and nothing would ever repair 10. The `null` answer sends both clients to `SESSION_HISTORY`, which runs on the persistence queue after sequence 10 was queued. **Interface and callers** (all part of Task 6.1's files): `PtyManager.getSnapshot(id)` (`pty-manager.ts:405`) becomes `async getSnapshot(id): Promise<SessionSnapshotResponse>`. Every caller awaits it: the WS handler (`handlers/session.ts:137`, `return await ptyManager.getSnapshot(sessionId)`) and the HTTP route `GET /api/sessions/:sessionId/snapshot` (`api/routes/session-routes.ts:306`, `jsonResponse(await ptyManager.getSnapshot(...))`). The route matters: `jsonResponse` takes `unknown`, so a missed `await` compiles and answers `200 {}` to both CLIs. Update the fakes: `tests/handlers/session.test.ts:97` returns a promise; `tests/api/routes.test.ts`'s `FakePtyManager` (`:12`) gains a scripted `getSnapshot`. Existing `pty-manager-snapshot.test.ts` calls gain `await`, except `does not claim a live batch the headless terminal has not parsed` (`:170-195`): it calls `getSnapshot` inside `onData` and asserts `reported < sequence`, which the wait turns into its opposite. Replace it with `a snapshot requested during a live batch waits for that batch to be parsed`: with parsing held, the request stays pending; once released, it answers the sequence captured at request time and the batch's content. Don't bend the implementation to keep the old assertion. Add this to Task 6.1: tests `a snapshot requested right after output includes that output`, `a snapshot whose parser is stalled answers snapshot null after 2000 ms`, and in `tests/api/routes.test.ts` `the snapshot route returns the awaited snapshot` and `the snapshot route returns snapshot null when the parser times out` (assert the JSON body fields, not just status 200). Add to Task 6.3's and Task 6.4's tests: `a null snapshot on a resync falls back to session history and repairs a missing tail with no later output`. Use an injected clock and parser hook, not real time. The dropped-tail acceptance case is then in scope.
- **Ordering:** this section runs before Section 3 (index order 1, 2, 6, 3, …). Task 6.3's reconnect resync is the one web reconnect path; Section 3 adds none.
- Section 13 gets the acceptance cases from Step 6 (done by the planner).
