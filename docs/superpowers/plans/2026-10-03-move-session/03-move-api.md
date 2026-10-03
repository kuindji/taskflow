# Section 3: `moveSession`, owner lookup, entry-point locks, WS and REST

Read first: the plan index, `handoff.md`, and the spec sections "`moveSession`", "Owner lookup", "API" and "Amendments". Sections 1 and 2 have to be done.

**Lock order.** Every lock in this feature is taken in this order, never the reverse:

1. the session's queue (`sessionQueue`, Section 2);
2. the owner locks (`taskStore.withOwnerLocks`, Section 1);
3. FlowRunner's per-owner lock (archive and delete call `failFlowByIds` under the owner locks);
4. the native launch lock (a flow launch takes it under FlowRunner's lock);
5. the store's own file locks.

Archive, delete and project removal take owner locks and never wait on a session queue. Closing a PTY only *queues* that session's exit cleanup. Native discovery releases the launch lock before it queues on the session (Section 2), so nothing holds lock 4 while waiting on lock 1.

### Task 5: `moveSession` and `getSessionOwner`

**Files:**
- Modify: `packages/backend/src/services/session-lifecycle.ts`:
  - shutdown gate fields next to `preservingSessionsForShutdown` (line 201);
  - `prepareForShutdown` (line 800);
  - new functions before `return {`, which are also exported from it.
- Test: `packages/backend/tests/handlers/session.test.ts`. Add a new `describe("session move")` inside `describe("session handlers")`.

**Interfaces:**
- Consumes:
  - Section 2: `owners`, `sessionQueue`, `currentOwnerOf`, `broadcastOwner`;
  - Section 1: `normalizeOwner`, `ownerIdOf`, `ownerKey` and `sameOwner` from `./session-owner`, plus `taskStore.moveSessionHistory` and `taskStore.withOwnerLocks`.
- Produces on the lifecycle object:
  - `moveSession(sessionId: string, target: SessionOwnerRef): Promise<void>`
  - `getSessionOwner(sessionId: string): Promise<SessionOwnerRef | null>`. For a task, the result also includes `projectId`.
- Move order (the spec "Amendments" section explains why): **rename the log → add the ref to the target → remove it from the source → update the registry**. Each step undoes the earlier ones if it fails. Section 1's boot repair covers a process that dies in between.

- [ ] **Step 1: Write the failing tests**

Add `spyOn` and `mock` to the `bun:test` import, `stat` from `fs/promises`, `join` from `path`, and `import type { SessionRef } from "@taskflow/shared";`, each if missing. `tempDir` is the file's data dir, and the store's `sessionLogsDir` is `join(tempDir, "session-logs")`. Inside `describe("session handlers")`:

```ts
    describe("session move", () => {
        async function twoTasks() {
            const a = await store.createTask({ projectId, title: "A", description: "" });
            const b = await store.createTask({ projectId, title: "B", description: "" });
            return { a, b };
        }

        async function codexIn(taskId: string): Promise<string> {
            return sessionLifecycle.createSession({ owner: { taskId }, type: "codex" });
        }

        const logPath = (ownerId: string, sessionId: string) =>
            join(tempDir, "session-logs", `${ownerId}--${sessionId}.jsonl`);
        const exists = (path: string) =>
            stat(path).then(
                () => true,
                () => false,
            );

        /**
         * Resolves once a withOwnerLocks call covering every key in `keys` has
         * been made. withOwnerLocks reserves its keys synchronously (Section 1),
         * so by then that caller is ahead of any later one on those keys.
         */
        function lockRequested(keys: string[]): Promise<void> {
            const realLocks = store.withOwnerLocks.bind(store);
            return new Promise((resolve) => {
                spyOn(store, "withOwnerLocks").mockImplementation((requested, work) => {
                    const result = realLocks(requested, work);
                    if (keys.every((key) => requested.includes(key))) resolve();
                    return result;
                });
            });
        }

        it("moves a task session to another task with its log and cwd", async () => {
            const { a, b } = await twoTasks();
            const sessionId = await codexIn(a.id);
            const before = (await store.getTask(a.id))?.sessions[0];
            ptyManager.emit(sessionId, "before\r\n");

            await sessionLifecycle.moveSession(sessionId, { taskId: b.id });
            ptyManager.emit(sessionId, "after\r\n");
            await sessionLifecycle.drainSessionOutput();

            expect((await store.getTask(a.id))?.sessions).toEqual([]);
            expect((await store.getTask(b.id))?.sessions).toEqual([before]);
            expect((await store.getSessionHistory(b.id, sessionId)).data).toBe(
                "before\r\nafter\r\n",
            );
            expect((await store.getSessionHistory(a.id, sessionId)).data).toBe("");
            expect(ptyManager.spawns).toHaveLength(1);
        });

        it("broadcasts both owners", async () => {
            const { a, b } = await twoTasks();
            const sessionId = await codexIn(a.id);
            events.length = 0;

            await sessionLifecycle.moveSession(sessionId, { taskId: b.id });

            const updatedIds = events
                .filter((event) => event.type === MSG.TASK_UPDATED)
                .map((event) => (event.payload as { id: string }).id);
            expect(updatedIds).toEqual([a.id, b.id]);
        });

        it("moves between project level, a task and master", async () => {
            const task = await store.createTask({ projectId, title: "T", description: "" });
            const sessionId = await sessionLifecycle.createSession({
                owner: { projectId },
                type: "claude",
            });

            await sessionLifecycle.moveSession(sessionId, { taskId: task.id });
            expect(await sessionLifecycle.getSessionOwner(sessionId)).toEqual({
                taskId: task.id,
                projectId,
            });

            await sessionLifecycle.moveSession(sessionId, { master: true });
            expect(store.getMasterSessions().map((s) => s.id)).toEqual([sessionId]);
            expect((await store.getTask(task.id))?.sessions).toEqual([]);
            expect(await sessionLifecycle.getSessionOwner(sessionId)).toEqual({ master: true });

            await sessionLifecycle.moveSession(sessionId, { projectId });
            expect(store.getMasterSessions()).toEqual([]);
            expect((await store.getProject(projectId))?.sessions.map((s) => s.id)).toEqual([
                sessionId,
            ]);
        });

        it("removes the session from its new owner when it exits after a move", async () => {
            const { a, b } = await twoTasks();
            const sessionId = await codexIn(a.id);
            ptyManager.emit(sessionId, "output\r\n");
            await sessionLifecycle.moveSession(sessionId, { taskId: b.id });

            ptyManager.close(sessionId);
            await sessionLifecycle.drainSessionOutput();

            expect((await store.getTask(b.id))?.sessions).toEqual([]);
            expect((await store.getSessionHistory(b.id, sessionId)).data).toBe("");
            expect(await sessionLifecycle.getSessionOwner(sessionId)).toBeNull();
        });

        it("serves history from the new owner even when the client names the old one", async () => {
            const { a, b } = await twoTasks();
            const sessionId = await codexIn(a.id);
            ptyManager.emit(sessionId, "hello\r\n");
            await sessionLifecycle.moveSession(sessionId, { taskId: b.id });

            expect(
                await router.handle(MSG.SESSION_HISTORY, { taskId: a.id, sessionId }),
            ).toEqual({ data: "hello\r\n", lastSequence: 1 });
        });

        it("frees the launch lock behind a blocked move and records the native id on the new owner", async () => {
            let resolveDiscovery!: (id: string) => void;
            const discovered = new Promise<string>((resolve) => {
                resolveDiscovery = resolve;
            });
            let markReleased!: () => void;
            const released = new Promise<void>((resolve) => {
                markReleased = resolve;
            });
            const lifecycle = createSessionLifecycle({
                ptyManager: ptyManager as never,
                taskStore: store,
                settingsStore,
                broadcast: () => {},
                getPort: () => 0,
                detectedEditors: [],
                trayStateTracker: new TrayStateTracker(),
                nativeSessionDiscovery: {
                    acquire: async () => async () => {
                        markReleased();
                    },
                    capture: async () => new Set<string>(),
                    discover: () => discovered,
                },
            });
            const { a, b } = await twoTasks();
            const sessionId = await lifecycle.createSession({
                owner: { taskId: a.id },
                type: "codex",
            });
            let openB!: () => void;
            const bHeld = store.withOwnerLocks(
                [`task:${b.id}`],
                () =>
                    new Promise<void>((resolve) => {
                        openB = resolve;
                    }),
            );
            // The move takes the session's queue, then blocks on B's owner lock.
            const move = lifecycle.moveSession(sessionId, { taskId: b.id });

            resolveDiscovery("native-1");
            // Hangs (test timeout) if the launch lock waits for the session's queue.
            await released;
            openB();
            await Promise.all([bHeld, move]);

            await waitFor(
                async () => (await store.getTask(b.id))?.sessions[0]?.nativeSessionId === "native-1",
            );
        });

        it("writes a moved session's last output to its new owner during shutdown", async () => {
            const { a, b } = await twoTasks();
            const sessionId = await codexIn(a.id);
            await sessionLifecycle.moveSession(sessionId, { taskId: b.id });
            await sessionLifecycle.prepareForShutdown();

            // The PTY flushes its last output, then exits, as closeAll does.
            ptyManager.emit(sessionId, "last words\r\n");
            ptyManager.close(sessionId);
            await sessionLifecycle.drainSessionOutput();

            expect((await store.getSessionHistory(b.id, sessionId)).data).toBe("last words\r\n");
            expect(await exists(logPath(a.id, sessionId))).toBe(false);
        });

        it("refuses sessions and targets it cannot move", async () => {
            const { a, b } = await twoTasks();
            const shell = await sessionLifecycle.createSession({
                owner: { taskId: a.id },
                type: "shell",
                shell: "/bin/sh",
            });
            const agent = await codexIn(a.id);

            await expect(sessionLifecycle.moveSession(shell, { taskId: b.id })).rejects.toThrow(
                "Only agent sessions can be moved",
            );
            await expect(sessionLifecycle.moveSession(agent, { taskId: a.id })).rejects.toThrow(
                "Session is already there",
            );
            await expect(
                sessionLifecycle.moveSession(agent, { taskId: "missing" }),
            ).rejects.toThrow("Task not found");
            await expect(
                sessionLifecycle.moveSession(agent, { projectId: "missing" }),
            ).rejects.toThrow("Project not found");
            await expect(
                sessionLifecycle.moveSession(agent, { taskId: b.id, master: true }),
            ).rejects.toThrow("Exactly one of taskId, projectId, or master is required");
            await expect(sessionLifecycle.moveSession("nope", { taskId: b.id })).rejects.toThrow(
                "Session is not running",
            );
        });

        it("refuses flow and remote agent sessions and archived targets", async () => {
            const { a, b } = await twoTasks();
            const flow = await sessionLifecycle.createSession({
                owner: { taskId: a.id },
                type: "codex",
                flow: { flowId: "f1", actionEntryId: "e1" },
            });
            const remote = await sessionLifecycle.createSession({
                owner: { master: true },
                type: "claude",
                remoteControl: true,
            });
            const agent = await codexIn(a.id);
            await router.handle(MSG.TASK_ARCHIVE, { id: b.id });

            await expect(sessionLifecycle.moveSession(flow, { projectId })).rejects.toThrow(
                "Flow sessions cannot be moved",
            );
            await expect(sessionLifecycle.moveSession(remote, { projectId })).rejects.toThrow(
                "The remote agent session cannot be moved",
            );
            await expect(sessionLifecycle.moveSession(agent, { taskId: b.id })).rejects.toThrow(
                "Task not found",
            );
        });

        it("keeps another instance's session refs on both owners", async () => {
            const { a, b } = await twoTasks();
            const foreign: SessionRef = {
                id: "foreign",
                type: "claude",
                label: "Claude",
                createdAt: new Date().toISOString(),
                instance: "dev-other",
                bootId: "other-boot",
                state: "live",
            };
            await store.updateTask(a.id, { sessions: [foreign] });
            await store.updateTask(b.id, { sessions: [{ ...foreign, id: "foreign-b" }] });
            const sessionId = await codexIn(a.id);

            await sessionLifecycle.moveSession(sessionId, { taskId: b.id });

            expect((await store.getTask(a.id))?.sessions.map((s) => s.id)).toEqual(["foreign"]);
            expect((await store.getTask(b.id))?.sessions.map((s) => s.id)).toEqual([
                "foreign-b",
                sessionId,
            ]);
        });

        it("leaves the session where it was when the target cannot be written", async () => {
            const { a, b } = await twoTasks();
            const sessionId = await codexIn(a.id);
            ptyManager.emit(sessionId, "kept\r\n");
            await sessionLifecycle.drainSessionOutput();
            spyOn(store, "updateTask").mockImplementationOnce(() =>
                Promise.reject(new Error("disk full")),
            );

            await expect(sessionLifecycle.moveSession(sessionId, { taskId: b.id })).rejects.toThrow(
                "disk full",
            );

            expect((await store.getTask(a.id))?.sessions.map((s) => s.id)).toEqual([sessionId]);
            expect((await store.getTask(b.id))?.sessions).toEqual([]);
            expect((await store.getSessionHistory(a.id, sessionId)).data).toBe("kept\r\n");
            expect(await sessionLifecycle.getSessionOwner(sessionId)).toEqual({
                taskId: a.id,
                projectId,
            });
        });

        it("undoes the target write when the source cannot be cleared", async () => {
            const { a, b } = await twoTasks();
            const sessionId = await codexIn(a.id);
            const realUpdate = store.updateTask.bind(store);
            spyOn(store, "updateTask")
                .mockImplementationOnce(realUpdate)
                .mockImplementationOnce(() => Promise.reject(new Error("disk full")));

            await expect(sessionLifecycle.moveSession(sessionId, { taskId: b.id })).rejects.toThrow(
                "disk full",
            );

            expect((await store.getTask(a.id))?.sessions.map((s) => s.id)).toEqual([sessionId]);
            expect((await store.getTask(b.id))?.sessions).toEqual([]);
        });

        it("rolls back a move into Master whose write fails", async () => {
            const { a } = await twoTasks();
            const sessionId = await codexIn(a.id);
            ptyManager.emit(sessionId, "kept\r\n");
            await sessionLifecycle.drainSessionOutput();
            spyOn(store, "addMasterSession").mockImplementationOnce(() =>
                Promise.reject(new Error("disk full")),
            );

            await expect(sessionLifecycle.moveSession(sessionId, { master: true })).rejects.toThrow(
                "disk full",
            );

            expect(store.getMasterSessions()).toEqual([]);
            expect((await store.getTask(a.id))?.sessions.map((s) => s.id)).toEqual([sessionId]);
            expect((await store.getSessionHistory(a.id, sessionId)).data).toBe("kept\r\n");
            expect(await sessionLifecycle.getSessionOwner(sessionId)).toEqual({
                taskId: a.id,
                projectId,
            });
        });

        it("rolls back a move out of Master whose source removal fails", async () => {
            const { a } = await twoTasks();
            const sessionId = await sessionLifecycle.createSession({
                owner: { master: true },
                type: "codex",
            });
            spyOn(store, "removeMasterSession").mockImplementationOnce(() =>
                Promise.reject(new Error("disk full")),
            );

            await expect(sessionLifecycle.moveSession(sessionId, { taskId: a.id })).rejects.toThrow(
                "disk full",
            );

            expect(store.getMasterSessions().map((s) => s.id)).toEqual([sessionId]);
            expect((await store.getTask(a.id))?.sessions).toEqual([]);
            expect(await sessionLifecycle.getSessionOwner(sessionId)).toEqual({ master: true });
        });

        it("finishes an in-flight move before shutdown marks sessions, then refuses moves", async () => {
            const { a, b } = await twoTasks();
            const sessionId = await codexIn(a.id);
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            const held = store.withOwnerLocks([`task:${b.id}`], () => gate);
            const move = sessionLifecycle.moveSession(sessionId, { taskId: b.id });
            let prepared = false;
            const prepare = sessionLifecycle.prepareForShutdown().then(() => {
                prepared = true;
            });

            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(prepared).toBe(false);
            release();
            await Promise.all([held, move, prepare]);

            expect((await store.getTask(b.id))?.sessions[0]?.state).toBe("interrupted");
            await expect(
                sessionLifecycle.moveSession(sessionId, { taskId: a.id }),
            ).rejects.toThrow("Taskflow is shutting down");
        });
    });
```

`spyOn` restores automatically between tests only if the test file calls `mock.restore()`. Add `afterEach(() => mock.restore())` to this `describe` (import `mock` from `bun:test`) so a spy can't leak into the next test.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/backend && bun test tests/handlers/session.test.ts -t "session move"`
Expected: FAIL. `sessionLifecycle.moveSession is not a function`.

- [ ] **Step 3: Implement**

Extend the imports:

```ts
import { normalizeOwner, ownerIdOf, ownerKey, sameOwner } from "./session-owner";
```

Next to `let preservingSessionsForShutdown = false;`:

```ts
    let acceptingMoves = true;
    const movesInFlight = new Set<Promise<SessionOwner>>();
```

Replace `prepareForShutdown`:

```ts
    async function prepareForShutdown(): Promise<void> {
        // A move still writing refs would otherwise land a "live" ref in an
        // owner the interrupted-marking pass has already visited.
        acceptingMoves = false;
        await Promise.allSettled([...movesInFlight]);
        preservingSessionsForShutdown = true;
        await taskStore.markBootSessionsInterrupted(config.instanceId, config.bootId);
    }
```

Add before `return {`:

```ts
    async function findOwnedSessionRef(
        owner: SessionOwner,
        sessionId: string,
    ): Promise<SessionRef | undefined> {
        const match = (session: SessionRef) => session.id === sessionId;
        if (owner.master) return taskStore.getMasterSessions().find(match);
        if (owner.taskId) return (await taskStore.getTask(owner.taskId))?.sessions.find(match);
        if (owner.projectId) {
            return (await taskStore.getProject(owner.projectId))?.sessions.find(match);
        }
        return undefined;
    }

    async function addOwnedSessionRef(owner: SessionOwner, ref: SessionRef): Promise<void> {
        const append = (sessions: SessionRef[]) => [
            ...sessions.filter((session) => session.id !== ref.id),
            ref,
        ];
        if (owner.master) {
            // Master is never the source here (sameOwner was checked), so it can't list the ref.
            await taskStore.addMasterSession(ref);
        } else if (owner.taskId) {
            await taskStore.updateTask(owner.taskId, (task) => ({ sessions: append(task.sessions) }));
        } else if (owner.projectId) {
            await taskStore.updateProject(owner.projectId, (project) => ({
                sessions: append(project.sessions),
            }));
        }
    }

    async function removeOwnedSessionRef(owner: SessionOwner, sessionId: string): Promise<void> {
        const without = (sessions: SessionRef[]) =>
            sessions.filter((session) => session.id !== sessionId);
        if (owner.master) {
            await taskStore.removeMasterSession(sessionId);
        } else if (owner.taskId) {
            await taskStore.updateTask(owner.taskId, (task) => ({ sessions: without(task.sessions) }));
        } else if (owner.projectId) {
            await taskStore.updateProject(owner.projectId, (project) => ({
                sessions: without(project.sessions),
            }));
        }
    }

    async function assertOwnerExists(owner: SessionOwner): Promise<void> {
        if (owner.taskId && !(await taskStore.getTask(owner.taskId))) {
            throw new Error("Task not found");
        }
        if (owner.projectId && !(await taskStore.getProject(owner.projectId))) {
            throw new Error("Project not found");
        }
    }

    /** Best-effort undo of a step a failed move already made. */
    async function undoMoveStep(step: () => Promise<void>): Promise<void> {
        await step().catch((error: unknown) => {
            console.error("[session] Failed to roll back a session move:", error);
        });
    }

    /** Runs on the session's queue: no output, history read, exit or discovery interleaves. */
    async function moveQueued(sessionId: string, destination: SessionOwner): Promise<SessionOwner> {
        const source = currentOwnerOf(sessionId);
        if (!source || !ptyManager.has(sessionId)) throw new Error("Session is not running");
        return taskStore.withOwnerLocks([ownerKey(source), ownerKey(destination)], async () => {
            const ref = await findOwnedSessionRef(source, sessionId);
            if (!ref) throw new Error("Session is not running");
            if (!isAgentType(ref.type)) throw new Error("Only agent sessions can be moved");
            if (ref.flow) throw new Error("Flow sessions cannot be moved");
            if (ref.remoteControl) throw new Error("The remote agent session cannot be moved");
            if (ref.instance !== config.instanceId) {
                throw new Error("Session belongs to another instance");
            }
            await assertOwnerExists(destination);
            if (sameOwner(source, destination)) throw new Error("Session is already there");

            // Order matters for boot repair (TaskStore.repairMovedSessions):
            // log first, then target, then source.
            const fromId = ownerIdOf(source);
            const toId = ownerIdOf(destination);
            await taskStore.moveSessionHistory(fromId, toId, sessionId);
            try {
                await addOwnedSessionRef(destination, ref);
                try {
                    await removeOwnedSessionRef(source, sessionId);
                } catch (error) {
                    await undoMoveStep(() => removeOwnedSessionRef(destination, sessionId));
                    throw error;
                }
            } catch (error) {
                await undoMoveStep(() => taskStore.moveSessionHistory(toId, fromId, sessionId));
                throw error;
            }
            owners.set(sessionId, destination);
            return source;
        });
    }

    /**
     * Re-home a live agent session: its ref, its output log and the owner the
     * lifecycle reads. The process and its cwd are untouched.
     */
    async function moveSession(sessionId: string, target: SessionOwner): Promise<void> {
        if (!acceptingMoves) throw new Error("Taskflow is shutting down");
        const destination = normalizeOwner(target);
        const move = sessionQueue.run(sessionId, () => moveQueued(sessionId, destination));
        movesInFlight.add(move);
        try {
            const source = await move;
            await broadcastOwner(source);
            await broadcastOwner(destination);
        } finally {
            movesInFlight.delete(move);
        }
    }

    async function getSessionOwner(sessionId: string): Promise<SessionOwner | null> {
        const owner = currentOwnerOf(sessionId);
        if (!owner) return null;
        if (!owner.taskId) return { ...owner };
        const task = await taskStore.getTask(owner.taskId);
        return task ? { taskId: task.id, projectId: task.projectId } : { taskId: owner.taskId };
    }
```

Add `moveSession` and `getSessionOwner` to the returned object.

The mutation calls in `moveQueued` must use `taskStore.updateTask`, `taskStore.addMasterSession` and `taskStore.removeMasterSession` (not cached references), so the spies in the rollback tests take effect. For a Master target, `addOwnedSessionRef` must call `addMasterSession` before anything else can fail; the "into Master" test rejects that call.

**When an undo fails.** `undoMoveStep` logs and carries on, and the move rethrows the original error. That needs two write failures in a row. The worst outcome is a ref listed by both owners, or the pre-move transcript left under the target's log name. Boot repair (Section 1) fixes the first. The second loses that transcript from history replay. The process and the ref are unaffected. This is accepted; don't add more recovery.

- [ ] **Step 4: Run the tests**

Run: `cd packages/backend && bun test tests/handlers/session.test.ts`
Expected: PASS. Run it three times.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/session-lifecycle.ts packages/backend/tests/handlers/session.test.ts
git commit -m "feat(backend): move a live agent session to another owner"
```

### Task 6: Take owner locks where sessions are stopped with their owner

Archive, delete and project removal read an owner's sessions, then close them and mutate the owner. Without a lock, a move landing in between can either be killed by an archive of the task it just left, or be archived with its process still running by an archive of the task it just joined (spec "Amendments").

**Files:**
- Modify: `packages/backend/src/services/task-store.ts`. Add two helpers after `withOwnerLocks`.
- Modify: `packages/backend/src/handlers/task.ts` (`TASK_ARCHIVE` lines 138-156, `TASK_DELETE` lines 183-230).
- Modify: `packages/backend/src/handlers/project.ts` (`PROJECT_REMOVE` lines 54-68).
- Modify: `packages/backend/src/api/routes/task-routes.ts` (archive lines 342-380, delete lines 413-470).
- Modify: `packages/backend/src/api/routes/project-routes.ts` (`DELETE /api/projects/:id` lines 92-115).
- Test: `packages/backend/tests/handlers/session.test.ts`

**Interfaces:**
- Produces:
  - `TaskStore.withTaskCascadeLock<T>(taskId: string, work: () => Promise<T>): Promise<T>`. Locks the task and its active and archived subtasks.
  - `TaskStore.withProjectRemovalLock<T>(projectId: string, work: () => Promise<T>): Promise<T>`. Locks the project and its tasks.

- [ ] **Step 1: Write the failing tests**

Inside `describe("session move")`:

```ts
        it("archiving the target after a move stops the moved session", async () => {
            const { a, b } = await twoTasks();
            const sessionId = await codexIn(a.id);
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            const held = store.withOwnerLocks([`task:${b.id}`], () => gate);
            const moveQueued = lockRequested([`task:${a.id}`, `task:${b.id}`]);
            const move = sessionLifecycle.moveSession(sessionId, { taskId: b.id });
            // The move holds its place on B's lock before the archive asks for it.
            await moveQueued;
            const archive = router.handle(MSG.TASK_ARCHIVE, { id: b.id });

            release();
            await Promise.all([held, move, archive]);

            expect(ptyManager.closed).toContain(sessionId);
            expect((await store.getArchived(b.id))?.sessions).toEqual([]);
        });

        it("deleting the source during a move keeps the moved transcript", async () => {
            const { a, b } = await twoTasks();
            const sessionId = await codexIn(a.id);
            ptyManager.emit(sessionId, "keep me\r\n");
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            const held = store.withOwnerLocks([`task:${a.id}`], () => gate);
            const moveQueued = lockRequested([`task:${a.id}`, `task:${b.id}`]);
            const move = sessionLifecycle.moveSession(sessionId, { taskId: b.id });
            await moveQueued;
            const remove = router.handle(MSG.TASK_DELETE, { id: a.id });

            release();
            await Promise.all([held, move, remove]);
            await sessionLifecycle.drainSessionOutput();

            expect(ptyManager.closed).not.toContain(sessionId);
            expect((await store.getSessionHistory(b.id, sessionId)).data).toBe("keep me\r\n");
        });
```

The first test passes only when the archive waits for the move (lock queued second), then reads B fresh and finds the moved session. The second passes only when the delete waits until the session has left A. `lockRequested` replaces sleeps: it resolves when the move's `withOwnerLocks` call has reserved both keys, so the archive or delete is queued behind it. If TypeScript can't type the `mockImplementation` arrow against the generic `withOwnerLocks`, give it explicit generics (`<T,>(requested: string[], work: () => Promise<T>): Promise<T> => …`). Don't cast.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/backend && bun test tests/handlers/session.test.ts -t "archiving the target|deleting the source"`
Expected: FAIL. The archive reads B before the move lands, and the delete closes the session.

- [ ] **Step 3: Implement**

`task-store.ts`. Import `ownerKey` from `./session-owner` and add after `withOwnerLocks`:

```ts
    /** Lock a task and its subtasks (active and archived) for an archive or delete cascade. */
    async withTaskCascadeLock<T>(taskId: string, work: () => Promise<T>): Promise<T> {
        const [subtasks, archived] = await Promise.all([
            this.getSubtasks(taskId),
            this.getArchivedSubtasks(taskId),
        ]);
        const keys = [taskId, ...subtasks.map((t) => t.id), ...archived.map((t) => t.id)].map(
            (id) => ownerKey({ taskId: id }),
        );
        return this.withOwnerLocks(keys, work);
    }

    /** Lock a project and its tasks for removal. */
    async withProjectRemovalLock<T>(projectId: string, work: () => Promise<T>): Promise<T> {
        const tasks = await this.listTasks(projectId);
        const keys = [
            ownerKey({ projectId }),
            ...tasks.map((task) => ownerKey({ taskId: task.id })),
        ];
        return this.withOwnerLocks(keys, work);
    }
```

A subtask or task created between the key read and the lock isn't locked. That would take a create racing a removal and a move at the same moment, and it is accepted.

Wrap each entry point's whole existing body (from its first store read to its last mutation) without changing what is inside:

- `handlers/task.ts` `TASK_ARCHIVE`: `return store.withTaskCascadeLock(id, async () => { …existing body… });`, with `id` destructured from the payload before the call.
- `handlers/task.ts` `TASK_DELETE`: the same with `withTaskCascadeLock(id, …)`. The background worktree cleanup at the end can stay inside; it is not awaited.
- `handlers/project.ts` `PROJECT_REMOVE`: `return store.withProjectRemovalLock(id, async () => { …existing body… });`
- `task-routes.ts` archive and delete: inside each `try`, `return await taskStore.withTaskCascadeLock(params.taskId, async () => { …existing try body… });`. The `catch` stays outside, and the early `return errorResponse(…)` lines stay inside (they return from the inner function, which is then returned).
- `project-routes.ts` delete: the same with `withProjectRemovalLock(params.id, …)`.

Every body already reads its task or project at the top, so wrapping makes those reads happen under the lock.

- [ ] **Step 4: Run the tests**

Run: `cd packages/backend && bun test tests/handlers tests/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/task-store.ts packages/backend/src/handlers/task.ts packages/backend/src/handlers/project.ts packages/backend/src/api/routes/task-routes.ts packages/backend/src/api/routes/project-routes.ts packages/backend/tests/handlers/session.test.ts
git commit -m "fix(backend): serialize archive, delete and project removal with session moves"
```

### Task 7: WS handler and REST routes

**Files:**
- Modify: `packages/backend/src/handlers/session.ts`. Register `MSG.SESSION_MOVE` after `MSG.SESSION_RENAME`.
- Modify: `packages/backend/src/api/routes/session-routes.ts`. Deps type (lines 17-32) and routes after the resume route (around line 208).
- Modify: `packages/backend/src/api/routes.ts`. The `sessionLifecycle` dep type (lines 45-52) reuses the session-routes type.
- Modify: `packages/backend/tests/api/routes.test.ts`. Extend the stub at lines 36-40 and add route tests.
- Check: `packages/backend/tests/api/flow-artifact-raw.test.ts` and `packages/backend/tests/services/remote-agent-service.test.ts`. If either builds a `sessionLifecycle` for `registerApiRoutes`, extend it the same way so typecheck passes.

**Interfaces:**
- Consumes: `moveSession` and `getSessionOwner` (Task 5); `SessionMovePayload` and `SessionOwnerRef`.
- Produces:
  - WS `MSG.SESSION_MOVE`, which returns `{ success: true }`;
  - `POST /api/sessions/:sessionId/move` with body `SessionOwnerRef`. Returns 200 `{ success: true }`, or 400 `{ error }`.
  - `GET /api/sessions/:sessionId/owner`. Returns 200 `SessionOwnerRef`, or 404 `{ error: "Session not found" }`.
  - `type SessionRouteLifecycle`, exported from `session-routes.ts` and used by `routes.ts`.

- [ ] **Step 1: Write the failing tests**

In `tests/api/routes.test.ts`, add `type SessionOwnerRef` to the `@taskflow/shared` import, then replace the `sessionLifecycle` stub in `sharedTestDeps`:

```ts
const moveCalls: Array<{ sessionId: string; target: SessionOwnerRef }> = [];

const sharedTestDeps = {
    sessionLifecycle: {
        createSession: async () => "",
        resumeSession: async (sessionId: string) => sessionId,
        removeSessionFromOwner: async () => {},
        moveSession: async (sessionId: string, target: SessionOwnerRef) => {
            if (target.taskId === "archived") throw new Error("Task not found");
            moveCalls.push({ sessionId, target });
        },
        getSessionOwner: async (sessionId: string): Promise<SessionOwnerRef | null> =>
            sessionId === "session-1" ? { taskId: "t1", projectId: "p1" } : null,
    },
```

The rest of `sharedTestDeps` stays unchanged. Add `moveCalls.length = 0;` at the top of `beforeEach`. Then add these tests to `describe("api routes")`:

```ts
    it("moves a session to the requested owner", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/sessions/session-1/move", {
                method: "POST",
                body: JSON.stringify({ taskId: "t2" }),
                headers: { "Content-Type": "application/json" },
            }),
        );

        expect(response?.status).toBe(200);
        expect(moveCalls).toEqual([{ sessionId: "session-1", target: { taskId: "t2" } }]);
    });

    it("returns the move refusal as a 400 with its message", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/sessions/session-1/move", {
                method: "POST",
                body: JSON.stringify({ taskId: "archived" }),
                headers: { "Content-Type": "application/json" },
            }),
        );

        expect(response?.status).toBe(400);
        expect(await response?.json()).toEqual({ error: "Task not found" });
    });

    it("reports a session's current owner, or 404", async () => {
        const found = await apiRouter.handle(
            new Request("http://localhost/api/sessions/session-1/owner", { method: "GET" }),
        );
        const missing = await apiRouter.handle(
            new Request("http://localhost/api/sessions/other/owner", { method: "GET" }),
        );

        expect(await found?.json()).toEqual({ taskId: "t1", projectId: "p1" });
        expect(missing?.status).toBe(404);
    });
```

In `tests/handlers/session.test.ts`, inside `describe("session move")`:

```ts
        it("moves through the SESSION_MOVE message", async () => {
            const { a, b } = await twoTasks();
            const sessionId = await codexIn(a.id);

            expect(
                await router.handle(MSG.SESSION_MOVE, { sessionId, taskId: b.id }),
            ).toEqual({ success: true });
            expect((await store.getTask(b.id))?.sessions.map((s) => s.id)).toEqual([sessionId]);
        });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/backend && bun test tests/api/routes.test.ts tests/handlers/session.test.ts -t "move|owner"`
Expected: FAIL. There is no route and no WS handler.

- [ ] **Step 3: Implement**

`handlers/session.ts`: add `SessionMovePayload` to the type import, then after `SESSION_RENAME` add:

```ts
    router.register(MSG.SESSION_MOVE, async (payload) => {
        const { sessionId, taskId, projectId, master } = payload as SessionMovePayload;
        await sessionLifecycle.moveSession(sessionId, { taskId, projectId, master });
        return { success: true };
    });
```

`api/routes/session-routes.ts`: replace the inline `sessionLifecycle` type with an exported structural type, extending today's fields:

```ts
interface SessionRouteLifecycle {
    createSession: (opts: CreateSessionOpts) => Promise<string>;
    resumeSession: (sessionId: string) => Promise<string>;
    removeSessionFromOwner: (
        sessionId: string,
        owner?: { taskId?: string; projectId?: string },
    ) => Promise<void>;
    moveSession: (sessionId: string, target: SessionOwnerRef) => Promise<void>;
    getSessionOwner: (sessionId: string) => Promise<SessionOwnerRef | null>;
}
```

Use it as `sessionLifecycle: SessionRouteLifecycle;` in `SessionRouteDeps`, and add `export type { SessionRouteLifecycle };`. In `api/routes.ts`, replace its inline `sessionLifecycle: { … }` with `sessionLifecycle: SessionRouteLifecycle;`, imported from `./routes/session-routes`, so the shape is written once. Add `SessionOwnerRef` to session-routes' `@taskflow/shared` type import.

Routes, after the resume route:

```ts
    // ── Session move / owner ───────────────────────────────────────

    apiRouter.register("POST", "/api/sessions/:sessionId/move", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }
        const target: SessionOwnerRef = {
            ...(typeof body.taskId === "string" && { taskId: body.taskId }),
            ...(typeof body.projectId === "string" && { projectId: body.projectId }),
            ...(body.master === true && { master: true }),
        };
        try {
            await sessionLifecycle.moveSession(params.sessionId, target);
            return jsonResponse({ success: true });
        } catch (err) {
            return errorResponse(err instanceof Error ? err.message : "Unknown error", 400);
        }
    });

    apiRouter.register("GET", "/api/sessions/:sessionId/owner", async (_req, params) => {
        const owner = await sessionLifecycle.getSessionOwner(params.sessionId);
        return owner ? jsonResponse(owner) : errorResponse("Session not found", 404);
    });
```

- [ ] **Step 4: Full suite, typecheck, lint, format, commit**

```bash
cd packages/backend && bun test && cd ../..
bun run typecheck
bunx eslint packages/backend/src packages/backend/tests/api packages/backend/tests/handlers
bunx prettier --check packages/backend/src/handlers/session.ts packages/backend/src/api/routes/session-routes.ts packages/backend/src/api/routes.ts packages/backend/tests/api/routes.test.ts packages/backend/tests/handlers/session.test.ts
git add packages/backend/src/handlers/session.ts packages/backend/src/api packages/backend/tests/api packages/backend/tests/handlers/session.test.ts
git commit -m "feat(backend): expose session move and owner lookup over WS and REST"
```

Update `handoff.md`: Section 3 is done, with the commit hashes and the exact route shapes.
