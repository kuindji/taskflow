# Section 2: Owner registry and per-session queue in the lifecycle

Read first: the plan index, `handoff.md`, and the spec sections "Current owner registry" and "Amendments". Section 1 has to be done. It provides `session-owner.ts`, `keyed-queue.ts` and `SessionOwnerRef`.

**Why a queue and not just a map.** `appendSessionOutput` computes the log path when it is *called* and then waits its turn. If moves only updated a map, output the agent printed just before a move would be queued on the old path, run after the rename, and recreate the old file. So the lifecycle runs every owner-dependent step for a session through one per-session queue, and the owner is read when the step *runs*. The steps are:

- output appends;
- history reads;
- moves (Section 3);
- exit cleanup;
- native-id discovery;
- the owner removal a client's `SESSION_CLOSE` does before it kills the PTY.

History reads have to join the queue too. Otherwise a read issued right after output would overtake the append that output is waiting on: `tests/handlers/session.test.ts` "returns session history while session is active" emits output and reads it immediately.

### Task 4: Wire the registry into `createSessionLifecycle`

**Files:**
- Modify: `packages/backend/src/services/session-lifecycle.ts`:
  - `SessionOwner` (lines 32-36);
  - setup after `resumingSessionIds` (around line 196);
  - the spawn block and `onData` / `onExit` (lines 529-598);
  - registration after the `SessionRef` write (around line 668);
  - the native discovery `.then` (lines 688-715);
  - the returned object (line 820).
- Modify: `packages/backend/src/handlers/session.ts`. `SESSION_HISTORY` (lines 120-127) reads through the lifecycle, and `SESSION_CLOSE` (lines 73-78) closes through it.
- Modify: `packages/backend/src/index.ts`. `shutdown` (line 556) drains session output after closing the PTYs.
- Test: `packages/backend/tests/handlers/session.test.ts`

**Interfaces:**
- Consumes (Section 1): `KeyedQueue`, `ownerIdOf`, `normalizeOwner`, `SessionOwnerRef`.
- Produces inside `createSessionLifecycle` (Section 3 uses these):
  - `const owners = new Map<string, SessionOwner>()`, the current owner of each registered live session;
  - `const sessionQueue = new KeyedQueue()`, keyed by session id;
  - `currentOwnerOf(sessionId: string): SessionOwner | undefined`
  - `async function broadcastOwner(owner: SessionOwner): Promise<void>`
  - `async function patchOwnedSessionRef(owner: SessionOwner, sessionId: string, patch: Partial<SessionRef>): Promise<void>`
- Produces on the lifecycle object:
  - `readSessionHistory(sessionId: string, fallbackOwnerId: string): Promise<{ data: string; lastSequence: number }>`. Uses the live owner if registered, and `fallbackOwnerId` otherwise.
  - `drainSessionOutput(): Promise<void>`
  - `closeClientSession(sessionId: string): Promise<void>`. Removes the session from its current owner on the session's queue, then kills the PTY.
- Unchanged behaviour:
  - internal sessions are never registered and use the owner captured at spawn;
  - a session is registered only after its `SessionRef` is persisted, so a move can't copy the ref of a session still being created or resumed;
  - shutdown still preserves interrupted sessions.

- [ ] **Step 1: Write the failing tests**

Add a module-level helper below `FakePtyManager` in `tests/handlers/session.test.ts`. Section 3 reuses it.

```ts
async function waitFor(check: () => Promise<boolean>, timeoutMs = 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await check())) {
        if (Date.now() > deadline) throw new Error("waitFor timed out");
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}
```

Add inside `describe("session handlers")`:

```ts
    it("deletes output that was still being written when the session exited", async () => {
        const task = await store.createTask({ projectId, title: "Task", description: "" });
        const sessionId = await sessionLifecycle.createSession({
            owner: { taskId: task.id },
            type: "codex",
        });

        ptyManager.emit(sessionId, "last words\r\n");
        ptyManager.close(sessionId);

        await waitFor(async () => (await store.getTask(task.id))?.sessions.length === 0);
        await sessionLifecycle.drainSessionOutput();
        expect((await store.getSessionHistory(task.id, sessionId)).data).toBe("");
    });

    it("drains output still queued when asked", async () => {
        const task = await store.createTask({ projectId, title: "Task", description: "" });
        const sessionId = await sessionLifecycle.createSession({
            owner: { taskId: task.id },
            type: "codex",
        });

        for (let i = 0; i < 50; i += 1) ptyManager.emit(sessionId, `line ${i}\n`);
        await sessionLifecycle.drainSessionOutput();

        expect((await store.getSessionHistory(task.id, sessionId)).lastSequence).toBe(50);
    });
```

The existing test "returns session history while session is active and cleans up after exit" is the regression guard for history reads. It has to keep passing unchanged.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/backend && bun test tests/handlers/session.test.ts -t "still being written|drains output"`
Expected: FAIL. `sessionLifecycle.drainSessionOutput is not a function`.

- [ ] **Step 3: Implement in `session-lifecycle.ts`**

1. Make `SessionOwner` an alias. Replace the `interface SessionOwner { … }` block with `type SessionOwner = SessionOwnerRef;`. Add `SessionOwnerRef` to the `@taskflow/shared` type import. Then add:

```ts
import { KeyedQueue } from "./keyed-queue";
import { normalizeOwner, ownerIdOf } from "./session-owner";
```

2. After `const resumingSessionIds = new Set<string>();`:

```ts
    // The current owner of every registered live session, and one queue per
    // session that output, history reads, moves, exit cleanup and native-id
    // discovery all go through, reading the owner when they run.
    const owners = new Map<string, SessionOwner>();
    const sessionQueue = new KeyedQueue();

    function currentOwnerOf(sessionId: string): SessionOwner | undefined {
        return owners.get(sessionId);
    }

    async function broadcastOwner(owner: SessionOwner): Promise<void> {
        if (owner.master) {
            broadcast({
                type: MSG.MASTER_SESSIONS_LIST,
                payload: { sessions: taskStore.getMasterSessions() },
            });
        } else if (owner.taskId) {
            await broadcastTaskUpdate(owner.taskId);
        } else if (owner.projectId) {
            await broadcastProjectUpdate(owner.projectId);
        }
    }

    async function patchOwnedSessionRef(
        owner: SessionOwner,
        sessionId: string,
        patch: Partial<SessionRef>,
    ): Promise<void> {
        const apply = (sessions: SessionRef[]) =>
            sessions.map((session) => (session.id === sessionId ? { ...session, ...patch } : session));
        if (owner.master) {
            await taskStore.updateMasterSession(sessionId, patch);
        } else if (owner.taskId) {
            await taskStore.updateTask(owner.taskId, (task) => ({ sessions: apply(task.sessions) }));
        } else if (owner.projectId) {
            await taskStore.updateProject(owner.projectId, (project) => ({
                sessions: apply(project.sessions),
            }));
        }
        await broadcastOwner(owner);
    }
```

`broadcastTaskUpdate` and `broadcastProjectUpdate` are declared above (lines 210-228). Declare these helpers after them.

3. Spawn owner. Right after `const nativeDiscoveryStartedAt = Date.now();` (before `try { ptyManager.spawn(`):

```ts
        const spawnOwner: SessionOwner = normalizeOwner(
            master ? { master: true } : task ? { taskId: task.id } : { projectId: resolvedProjectId },
        );
        const ownerNow = (): SessionOwner => owners.get(sessionId) ?? spawnOwner;
```

4. Replace `onData`'s append and the whole `onExit`:

```ts
                onData: (data, sequence) => {
                    void sessionQueue
                        .run(sessionId, () =>
                            taskStore.appendSessionOutput(
                                ownerIdOf(ownerNow()),
                                sessionId,
                                sequence,
                                data,
                            ),
                        )
                        .catch((err: unknown) => {
                            if (!appendErrorLogged) {
                                appendErrorLogged = true;
                                console.error(
                                    `[session] Failed to persist output for session ${sessionId}:`,
                                    err,
                                );
                            }
                        });
                    trayStateTracker.markSessionActivity(sessionId);
                    opts.onSessionData?.(sessionId);
                    broadcast(
                        {
                            type: MSG.TERMINAL_OUTPUT,
                            payload: { sessionId, data, sequence },
                        },
                        { dropOnBackpressure: true },
                    );
                },
                onExit: (exitCode) => {
                    if (preservingSessionsForShutdown) {
                        // The PTY flushed its last output just before this
                        // callback, and those appends are still queued. They
                        // must read the current owner, so deregister behind them.
                        void sessionQueue.run(sessionId, async () => {
                            owners.delete(sessionId);
                        });
                        return;
                    }
                    // The owner may already have dropped this session (archive
                    // clears the list before closing PTYs; internal sessions are
                    // never registered), so removeSessionFromOwner alone would
                    // leave the log behind. Delete it by the owner id we know.
                    void sessionQueue
                        .run(sessionId, async () => {
                            const owner = ownerNow();
                            owners.delete(sessionId);
                            if (!opts.internal) await removeSessionFromOwner(sessionId, owner);
                            await taskStore.deleteSessionHistory(ownerIdOf(owner), sessionId);
                        })
                        .catch((err: unknown) => {
                            console.error(
                                `[session] Failed to clean up exited session ${sessionId}:`,
                                err,
                            );
                        });
                    if (!opts.internal) {
                        trayStateTracker.clearSession(sessionId);
                        broadcast({
                            type: MSG.SESSION_EXITED,
                            payload: { sessionId, exitCode },
                        });
                    }
                    onSessionExited?.(sessionId, exitCode);
                },
```

The local `ownerId` is still used for `priorHistory` (resume). Keep it there only.

5. Register **after** the ref is persisted. At the end of the `if (!opts.internal) { … }` block that writes `sessionRef` (after the `SESSION_STATUS` broadcast, around line 668), add:

```ts
            // Registered only once the ref is persisted: a move must never copy
            // the ref of a session that is still being created or resumed.
            if (ptyManager.has(sessionId)) owners.set(sessionId, spawnOwner);
```

The `ptyManager.has` guard stops a session that already exited (its cleanup ran on the queue with `spawnOwner`) from being registered after it died.

6. Native discovery (lines 678-722). The launch lock only has to cover identifying the native id. Release it as soon as `discover` returns, **before** waiting on the session's queue. Otherwise there is a lock cycle: a move holds this session's queue while it waits for an owner lock; an archive holds that owner lock while `failFlowByIds` waits for FlowRunner's owner lock; FlowRunner holds that while its launch waits for this native launch lock (`acquireNativeSessionLaunchLock` is per agent type, not per session). The lock's release removes a directory, so it must run only once, or it could remove a lock the next launch has taken.

Wrap the release right after it is acquired (around line 511), and use the wrapper everywhere below, including the existing `catch` around `capture`:

```ts
        const acquiredNativeLaunchLock = needsNativeDiscovery
            ? await nativeSessionDiscovery.acquire(type, accountHomeDir)
            : null;
        let nativeLaunchLockReleased = false;
        const releaseNativeLaunchLock = acquiredNativeLaunchLock
            ? async () => {
                  if (nativeLaunchLockReleased) return;
                  nativeLaunchLockReleased = true;
                  await acquiredNativeLaunchLock();
              }
            : null;
```

Then replace the discovery chain:

```ts
            void nativeSessionDiscovery
                .discover(
                    type,
                    cwd,
                    nativeSessionBaseline,
                    nativeDiscoveryStartedAt,
                    accountHomeDir,
                )
                .then(async (nativeSessionId) => {
                    // Identified: free the launch lock before queueing behind a move.
                    await releaseNativeLaunchLock();
                    if (!nativeSessionId) return;
                    await sessionQueue.run(sessionId, async () => {
                        if (!ptyManager.has(sessionId)) return;
                        await patchOwnedSessionRef(ownerNow(), sessionId, { nativeSessionId });
                    });
                })
```

The `.catch` and `.finally(() => { void releaseNativeLaunchLock(); })` that follow stay as they are; the `finally` is now a no-op unless `discover` threw. Section 3's test "records a late native session id on the new owner" pins the early release with a barrier.

7. Add these to the lifecycle object:

```ts
    function readSessionHistory(
        sessionId: string,
        fallbackOwnerId: string,
    ): Promise<{ data: string; lastSequence: number }> {
        return sessionQueue.run(sessionId, () => {
            const owner = currentOwnerOf(sessionId);
            return taskStore.getSessionHistory(owner ? ownerIdOf(owner) : fallbackOwnerId, sessionId);
        });
    }

    function drainSessionOutput(): Promise<void> {
        return sessionQueue.drain();
    }

    /**
     * A client closing a session: drop its ref from the owner it has now, on
     * its queue so a move can't interleave, then kill the process. The exit
     * cleanup that follows finds nothing left to remove but the log.
     */
    async function closeClientSession(sessionId: string): Promise<void> {
        await sessionQueue.run(sessionId, () =>
            removeSessionFromOwner(sessionId, currentOwnerOf(sessionId)),
        );
        ptyManager.close(sessionId);
    }
```

Return all three from `createSessionLifecycle`. `removeSessionFromOwner` falls back to scanning every owner when the owner is unknown (an interrupted ref, which is never registered), as today.

`handlers/session.ts`:
- `SESSION_HISTORY`: replace `return taskStore.getSessionHistory(ownerId, sessionId);` with `return sessionLifecycle.readSessionHistory(sessionId, ownerId);`.
- `SESSION_CLOSE`: replace the `removeSessionFromOwner` call and `ptyManager.close(sessionId)` with `await sessionLifecycle.closeClientSession(sessionId);`. The existing close tests (`tests/handlers/session.test.ts`, the two `SESSION_CLOSE` calls) must keep passing unchanged.

`index.ts` `shutdown`: right after `ptyManager.closeAll();`, add:

```ts
            await sessionLifecycle.drainSessionOutput();
```

The drain waits for every chunk already queued, which may be a backlog under heavy output, to reach disk before `process.exit`. `PtyManager.close` only kills the process (`pty-manager.ts:388-397`). The killed process's last batch is flushed later from its exit callback, so it may still be lost at exit, exactly as it is today. Don't try to wait for it.

- [ ] **Step 4: Run the session tests**

Run: `cd packages/backend && bun test tests/handlers/session.test.ts`
Expected: PASS, including both new tests and the existing history test. Run it three times; it must pass every time.

- [ ] **Step 5: Full backend suite, typecheck, lint, format, commit**

```bash
cd packages/backend && bun test && cd ../..
bun run typecheck
bunx eslint packages/backend/src/services/session-lifecycle.ts packages/backend/src/handlers/session.ts packages/backend/src/index.ts packages/backend/tests/handlers/session.test.ts
bunx prettier --check packages/backend/src/services/session-lifecycle.ts packages/backend/src/handlers/session.ts packages/backend/src/index.ts packages/backend/tests/handlers/session.test.ts
git add packages/backend/src/services/session-lifecycle.ts packages/backend/src/handlers/session.ts packages/backend/src/index.ts packages/backend/tests/handlers/session.test.ts
git commit -m "feat(backend): serialize session output, history and cleanup per session"
```

Update `handoff.md`: Section 2 is done, with the commit hash. Note the names `owners`, `sessionQueue`, `currentOwnerOf`, `broadcastOwner` and `patchOwnedSessionRef`.
