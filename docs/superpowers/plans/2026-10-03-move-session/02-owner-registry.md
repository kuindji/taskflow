# Section 2: Owner registry and per-session queue

Read first: the plan index, `handoff.md`, and the spec section "Current owner registry".

**Why a queue and not just a map.** `appendSessionOutput` computes the log path when it is *called* and then waits its turn. An append the agent printed just before a move would therefore be queued on the old path. It would run after the rename and recreate the old file. So the lifecycle runs every owner-dependent step for a session through one per-session queue: appends, moves, exit cleanup and native-id discovery. The owner is read when the step *runs*.

### Task 2: `SessionOwnerRegistry`

**Files:**
- Create: `packages/backend/src/services/session-owner-registry.ts`
- Test: `packages/backend/tests/services/session-owner-registry.test.ts`

**Interfaces:**
- Consumes: `SessionOwnerRef` from `@taskflow/shared` (Section 1).
- Produces:
  - `class SessionOwnerRegistry`:
    - `set(sessionId, owner: SessionOwnerRef): void`
    - `get(sessionId): SessionOwnerRef | undefined`
    - `delete(sessionId): void`
    - `run<T>(sessionId, step: () => Promise<T>): Promise<T>`
  - `normalizeOwner(owner: SessionOwnerRef): SessionOwnerRef`. Keeps exactly one field and throws `Exactly one of taskId, projectId, or master is required` otherwise.
  - `ownerIdOf(owner: SessionOwnerRef): string`. Returns `"master"`, the task id, or the project id.
  - `sameOwner(a, b): boolean`

- [ ] **Step 1: Write the failing tests**

`packages/backend/tests/services/session-owner-registry.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
    SessionOwnerRegistry,
    normalizeOwner,
    ownerIdOf,
    sameOwner,
} from "../../src/services/session-owner-registry";

describe("session owner registry", () => {
    it("normalizes an owner to exactly one field", () => {
        expect(normalizeOwner({ taskId: "t1" })).toEqual({ taskId: "t1" });
        expect(normalizeOwner({ projectId: "p1" })).toEqual({ projectId: "p1" });
        expect(normalizeOwner({ master: true })).toEqual({ master: true });
        expect(() => normalizeOwner({})).toThrow(
            "Exactly one of taskId, projectId, or master is required",
        );
        expect(() => normalizeOwner({ taskId: "t1", projectId: "p1" })).toThrow(
            "Exactly one of taskId, projectId, or master is required",
        );
    });

    it("derives the session-log owner id", () => {
        expect(ownerIdOf({ taskId: "t1" })).toBe("t1");
        expect(ownerIdOf({ projectId: "p1" })).toBe("p1");
        expect(ownerIdOf({ master: true })).toBe("master");
    });

    it("compares owners by kind and id", () => {
        expect(sameOwner({ taskId: "t1" }, { taskId: "t1" })).toBe(true);
        expect(sameOwner({ taskId: "t1" }, { projectId: "t1" })).toBe(false);
        expect(sameOwner({ master: true }, { master: true })).toBe(true);
    });

    it("runs a session's steps in order and reads state when each step runs", async () => {
        const registry = new SessionOwnerRegistry();
        registry.set("s1", { taskId: "a" });
        const seen: string[] = [];

        const first = registry.run("s1", async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            seen.push(ownerIdOf(registry.get("s1") ?? { master: true }));
            registry.set("s1", { taskId: "b" });
        });
        const second = registry.run("s1", async () => {
            seen.push(ownerIdOf(registry.get("s1") ?? { master: true }));
        });
        await Promise.all([first, second]);

        expect(seen).toEqual(["a", "b"]);
    });

    it("keeps the queue going after a failed step", async () => {
        const registry = new SessionOwnerRegistry();
        const failed = registry.run("s1", async () => {
            throw new Error("boom");
        });
        await expect(failed).rejects.toThrow("boom");

        expect(await registry.run("s1", async () => "next")).toBe("next");
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/session-owner-registry.test.ts`
Expected: FAIL. The module cannot be found.

- [ ] **Step 3: Implement**

`packages/backend/src/services/session-owner-registry.ts`:

```ts
import type { SessionOwnerRef } from "@taskflow/shared";

function normalizeOwner(owner: SessionOwnerRef): SessionOwnerRef {
    const count = (owner.taskId ? 1 : 0) + (owner.projectId ? 1 : 0) + (owner.master ? 1 : 0);
    if (count !== 1) throw new Error("Exactly one of taskId, projectId, or master is required");
    if (owner.master) return { master: true };
    if (owner.taskId) return { taskId: owner.taskId };
    return { projectId: owner.projectId };
}

/** The key session logs are stored under: the task id, the project id, or "master". */
function ownerIdOf(owner: SessionOwnerRef): string {
    if (owner.master) return "master";
    const id = owner.taskId ?? owner.projectId;
    if (!id) throw new Error("Exactly one of taskId, projectId, or master is required");
    return id;
}

function ownerKey(owner: SessionOwnerRef): string {
    if (owner.master) return "master";
    return owner.taskId ? `task:${owner.taskId}` : `project:${owner.projectId ?? ""}`;
}

function sameOwner(a: SessionOwnerRef, b: SessionOwnerRef): boolean {
    return ownerKey(a) === ownerKey(b);
}

/**
 * The current owner of every registered live session, plus one queue per
 * session. Output appends, moves, exit cleanup and native-id discovery all
 * run through the session's queue and read the owner when they run. That way
 * an append the agent printed just before a move lands in the old log before
 * it is renamed, and exit cleanup sees the owner the session ended in.
 */
class SessionOwnerRegistry {
    private readonly owners = new Map<string, SessionOwnerRef>();
    private readonly queues = new Map<string, Promise<void>>();

    set(sessionId: string, owner: SessionOwnerRef): void {
        this.owners.set(sessionId, normalizeOwner(owner));
    }

    get(sessionId: string): SessionOwnerRef | undefined {
        return this.owners.get(sessionId);
    }

    delete(sessionId: string): void {
        this.owners.delete(sessionId);
    }

    run<T>(sessionId: string, step: () => Promise<T>): Promise<T> {
        const previous = this.queues.get(sessionId) ?? Promise.resolve();
        const result = previous.then(step);
        const tail = result.then(
            () => undefined,
            () => undefined,
        );
        this.queues.set(sessionId, tail);
        void tail.then(() => {
            if (this.queues.get(sessionId) === tail) this.queues.delete(sessionId);
        });
        return result;
    }
}

export { SessionOwnerRegistry, normalizeOwner, ownerIdOf, sameOwner };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/session-owner-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/session-owner-registry.ts packages/backend/tests/services/session-owner-registry.test.ts
git commit -m "feat(backend): track each live session's current owner"
```

### Task 3: Route the lifecycle's owner-dependent steps through the registry

**Files:**
- Modify: `packages/backend/src/services/session-lifecycle.ts`:
  - `SessionOwner` (lines 32-36);
  - `createSessionLifecycle` setup (around line 196);
  - registration before `ptyManager.spawn` (around line 532);
  - `onData` / `onExit` (lines 543-598);
  - native discovery `.then` (lines 688-715).
- Test: `packages/backend/tests/handlers/session.test.ts`

**Interfaces:**
- Consumes: everything Task 2 produces.
- Produces, inside `createSessionLifecycle` (Section 3 uses these):
  - `const owners = new SessionOwnerRegistry()`
  - `async function broadcastOwner(owner: SessionOwnerRef): Promise<void>`
  - `async function patchOwnedSessionRef(owner: SessionOwnerRef, sessionId: string, patch: Partial<SessionRef>): Promise<void>`. Writes the patch to the ref in that owner's list, then broadcasts the owner.
- Existing behaviour that must not change: internal sessions (`opts.internal`) are never registered and keep using the owner captured at spawn.

- [ ] **Step 1: Write the failing test**

Moves don't exist until Section 3, which holds the end-to-end move tests. This task pins the ordering that the shared queue makes observable now: output appended just before exit is deleted along with the log, and is not recreated afterwards. Add to `describe("session handlers")`:

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
        await waitFor(
            async () =>
                (await store.getSessionHistory(task.id, sessionId)).data === "",
        );
    });
```

Add this helper at module level (below `FakePtyManager`). Section 3 reuses it:

```ts
async function waitFor(check: () => Promise<boolean>, timeoutMs = 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await check())) {
        if (Date.now() > deadline) throw new Error("waitFor timed out");
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}
```

- [ ] **Step 2: Run it to see the current behaviour**

Run: `cd packages/backend && bun test tests/handlers/session.test.ts -t "still being written"`
Expected: it may FAIL intermittently today. The append and the delete race on the same path, so the append can recreate the log after the delete. Either result is fine for this step. The test must pass reliably after Step 3.

- [ ] **Step 3: Implement**

1. Make `SessionOwner` an alias of the shared type. In `session-lifecycle.ts`, replace the `interface SessionOwner { … }` block (lines 32-36) with:

```ts
type SessionOwner = SessionOwnerRef;
```

Then add `SessionOwnerRef` to the `@taskflow/shared` type import at the top. Add:

```ts
import { SessionOwnerRegistry, ownerIdOf } from "./session-owner-registry";
```

2. In `createSessionLifecycle`, after `const resumingSessionIds = new Set<string>();` add:

```ts
    const owners = new SessionOwnerRegistry();

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

`broadcastTaskUpdate` and `broadcastProjectUpdate` already exist above (lines 210-228). `broadcastOwner` must be declared after them.

3. Register before spawning. Just before the `try { ptyManager.spawn({` block (around line 532), after `const nativeDiscoveryStartedAt = Date.now();`:

```ts
        const spawnOwner: SessionOwner = master
            ? { master: true }
            : task
              ? { taskId: task.id }
              : { projectId: resolvedProjectId };
        if (!opts.internal) owners.set(sessionId, spawnOwner);
        // Owner-dependent work reads the owner when it runs; see SessionOwnerRegistry.
        const currentOwner = (): SessionOwner => owners.get(sessionId) ?? spawnOwner;
```

In the existing `catch (error)` right after the spawn `try`, add `owners.delete(sessionId);` before `await releaseNativeLaunchLock?.();`.

4. Replace the `onData` append and the `onExit` body:

```ts
                onData: (data, sequence) => {
                    void owners
                        .run(sessionId, () =>
                            taskStore.appendSessionOutput(
                                ownerIdOf(currentOwner()),
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
                    if (preservingSessionsForShutdown) return;
                    // The owner may already have dropped this session (archive
                    // clears the list before closing PTYs; internal sessions are
                    // never registered), so removeSessionFromOwner alone would
                    // leave the log behind. Delete it by the owner id we know.
                    void owners
                        .run(sessionId, async () => {
                            const owner = currentOwner();
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

The old local `ownerId` is still used for `priorHistory` (resume). Keep it there and nowhere else.

5. Replace the body of the native discovery `.then` (lines 688-715) with:

```ts
                .then(async (nativeSessionId) => {
                    if (!nativeSessionId) return;
                    await owners.run(sessionId, async () => {
                        if (!ptyManager.has(sessionId)) return;
                        await patchOwnedSessionRef(currentOwner(), sessionId, { nativeSessionId });
                    });
                })
```

The `.catch` and `.finally` that follow stay unchanged.

- [ ] **Step 4: Run the session tests**

Run: `cd packages/backend && bun test tests/handlers/session.test.ts tests/services/session-owner-registry.test.ts`
Expected: PASS, including "deletes output that was still being written when the session exited". Run the file three times; it must pass every time.

- [ ] **Step 5: Run the whole backend suite**

Run: `cd packages/backend && bun test`
Expected: PASS. Rerun once if a single unrelated test flakes.

- [ ] **Step 6: Typecheck, lint, format, commit**

```bash
bun run typecheck
bunx eslint packages/backend/src/services/session-lifecycle.ts packages/backend/tests/handlers/session.test.ts
bunx prettier --check packages/backend/src/services/session-lifecycle.ts packages/backend/tests/handlers/session.test.ts
git add packages/backend/src/services/session-lifecycle.ts packages/backend/tests/handlers/session.test.ts
git commit -m "feat(backend): run session output, exit cleanup and discovery against the current owner"
```

Update `handoff.md`: Section 2 is done, with the commit hashes. Note that `owners`, `broadcastOwner` and `patchOwnedSessionRef` exist inside `createSessionLifecycle`.
