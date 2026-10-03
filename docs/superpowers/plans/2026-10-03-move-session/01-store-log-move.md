# Section 1: Shared types, owner helpers, and the store's move support

Read first: the plan index (`../2026-10-03-move-session.md`), `handoff.md`, and the spec sections "API", "`moveSession`" and "Amendments".

This section adds:

- the owner shape and move message shared by the backend, CLI and UI;
- pure owner helpers and a keyed promise queue, which Sections 2 and 3 build on;
- three `TaskStore` methods:
  - `moveSessionHistory`, which re-keys a log;
  - `withOwnerLocks`, which serializes a move against archive, delete or removal of its owners;
  - `repairMovedSessions`, which recovers at boot from a move the process didn't finish.

### Task 1: Shared types, owner helpers, keyed queue

**Files:**
- Modify: `packages/shared/src/types/ws.ts`. Add the types after `SessionHistoryPayload` (around line 223).
- Modify: `packages/shared/src/constants.ts`. Add `SESSION_MOVE` after `SESSION_RENAME` (around line 82).
- Create: `packages/backend/src/services/session-owner.ts`
- Create: `packages/backend/src/services/keyed-queue.ts`
- Test: `packages/backend/tests/services/session-owner.test.ts`

**Interfaces:**
- Produces (shared):
  - `interface SessionOwnerRef { taskId?: string; projectId?: string; master?: boolean }`
  - `interface SessionMovePayload extends SessionOwnerRef { sessionId: string }`
  - `MSG.SESSION_MOVE = "session:move"`
- Produces (backend `session-owner.ts`):
  - `normalizeOwner(owner: SessionOwnerRef): SessionOwnerRef`. Keeps exactly one field and throws `Exactly one of taskId, projectId, or master is required` otherwise.
  - `ownerIdOf(owner): string`. Returns `"master"`, the task id, or the project id. This is the session-log key.
  - `ownerKey(owner): string`. Returns `"master"`, `task:<id>` or `project:<id>`. This is the owner-lock key.
  - `sameOwner(a, b): boolean`
- Produces (backend `keyed-queue.ts`): `class KeyedQueue` with `run<T>(key: string, step: () => Promise<T>): Promise<T>` (steps for one key run one at a time, in call order, and a failed step does not stop the queue) and `drain(): Promise<void>` (resolves once every step queued so far has settled).

- [ ] **Step 1: Add the shared types and constant**

In `packages/shared/src/types/ws.ts`, after `SessionHistoryPayload`:

```ts
/**
 * Where a session lives. As a target, exactly one field is set. The owner
 * lookup (`GET /api/sessions/:id/owner`) also fills `projectId` for a task.
 */
export interface SessionOwnerRef {
    taskId?: string;
    projectId?: string;
    master?: boolean;
}

export interface SessionMovePayload extends SessionOwnerRef {
    sessionId: string;
}
```

In `packages/shared/src/constants.ts`, inside `MSG` after `SESSION_RENAME: "session:rename",`:

```ts
    SESSION_MOVE: "session:move",
```

- [ ] **Step 2: Write the failing tests**

`packages/backend/tests/services/session-owner.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { KeyedQueue } from "../../src/services/keyed-queue";
import { normalizeOwner, ownerIdOf, ownerKey, sameOwner } from "../../src/services/session-owner";

describe("session owner helpers", () => {
    it("normalizes an owner to exactly one field", () => {
        expect(normalizeOwner({ taskId: "t1" })).toEqual({ taskId: "t1" });
        expect(normalizeOwner({ projectId: "p1" })).toEqual({ projectId: "p1" });
        expect(normalizeOwner({ master: true })).toEqual({ master: true });
        for (const bad of [{}, { taskId: "t1", projectId: "p1" }, { taskId: "", master: false }]) {
            expect(() => normalizeOwner(bad)).toThrow(
                "Exactly one of taskId, projectId, or master is required",
            );
        }
    });

    it("derives log ids and lock keys", () => {
        expect(ownerIdOf({ taskId: "t1" })).toBe("t1");
        expect(ownerIdOf({ projectId: "p1" })).toBe("p1");
        expect(ownerIdOf({ master: true })).toBe("master");
        expect(ownerKey({ taskId: "t1" })).toBe("task:t1");
        expect(ownerKey({ projectId: "p1" })).toBe("project:p1");
        expect(ownerKey({ master: true })).toBe("master");
    });

    it("compares owners by kind and id", () => {
        expect(sameOwner({ taskId: "x" }, { taskId: "x" })).toBe(true);
        expect(sameOwner({ taskId: "x" }, { projectId: "x" })).toBe(false);
        expect(sameOwner({ master: true }, { master: true })).toBe(true);
    });
});

describe("KeyedQueue", () => {
    it("runs one key's steps in call order", async () => {
        const queue = new KeyedQueue();
        const seen: string[] = [];
        await Promise.all([
            queue.run("k", async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                seen.push("first");
            }),
            queue.run("k", async () => {
                seen.push("second");
            }),
        ]);
        expect(seen).toEqual(["first", "second"]);
    });

    it("keeps going after a failed step and lets other keys run", async () => {
        const queue = new KeyedQueue();
        const failed = queue.run("k", async () => {
            throw new Error("boom");
        });
        await expect(failed).rejects.toThrow("boom");
        expect(await queue.run("k", async () => "next")).toBe("next");
        expect(await queue.run("other", async () => "other")).toBe("other");
    });

    it("drains everything queued so far", async () => {
        const queue = new KeyedQueue();
        let done = false;
        void queue.run("k", async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            done = true;
        });
        await queue.drain();
        expect(done).toBe(true);
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/session-owner.test.ts`
Expected: FAIL. The modules cannot be found.

- [ ] **Step 4: Implement**

`packages/backend/src/services/session-owner.ts`:

```ts
import type { SessionOwnerRef } from "@taskflow/shared";

const OWNER_REQUIRED = "Exactly one of taskId, projectId, or master is required";

function normalizeOwner(owner: SessionOwnerRef): SessionOwnerRef {
    const count = (owner.taskId ? 1 : 0) + (owner.projectId ? 1 : 0) + (owner.master ? 1 : 0);
    if (count !== 1) throw new Error(OWNER_REQUIRED);
    if (owner.master) return { master: true };
    if (owner.taskId) return { taskId: owner.taskId };
    return { projectId: owner.projectId };
}

/** The key session logs are filed under: the task id, the project id, or "master". */
function ownerIdOf(owner: SessionOwnerRef): string {
    if (owner.master) return "master";
    const id = owner.taskId ?? owner.projectId;
    if (!id) throw new Error(OWNER_REQUIRED);
    return id;
}

/** The owner-lock key; unlike the log id it says which kind of owner it is. */
function ownerKey(owner: SessionOwnerRef): string {
    if (owner.master) return "master";
    return owner.taskId ? `task:${owner.taskId}` : `project:${owner.projectId ?? ""}`;
}

function sameOwner(a: SessionOwnerRef, b: SessionOwnerRef): boolean {
    return ownerKey(a) === ownerKey(b);
}

export { normalizeOwner, ownerIdOf, ownerKey, sameOwner };
```

`packages/backend/src/services/keyed-queue.ts`:

```ts
/**
 * One promise chain per key: steps for a key run one at a time in call
 * order, and a failed step does not stop the ones queued behind it.
 */
class KeyedQueue {
    private readonly tails = new Map<string, Promise<void>>();

    run<T>(key: string, step: () => Promise<T>): Promise<T> {
        const previous = this.tails.get(key) ?? Promise.resolve();
        const result = previous.then(step);
        const tail = result.then(
            () => undefined,
            () => undefined,
        );
        this.tails.set(key, tail);
        void tail.then(() => {
            if (this.tails.get(key) === tail) this.tails.delete(key);
        });
        return result;
    }

    /** Resolves once every step queued so far has settled. */
    async drain(): Promise<void> {
        await Promise.all(this.tails.values());
    }
}

export { KeyedQueue };
```

- [ ] **Step 5: Run the tests to verify they pass, then commit**

Run: `cd packages/backend && bun test tests/services/session-owner.test.ts`
Expected: PASS.

```bash
git add packages/shared/src/types/ws.ts packages/shared/src/constants.ts packages/backend/src/services/session-owner.ts packages/backend/src/services/keyed-queue.ts packages/backend/tests/services/session-owner.test.ts
git commit -m "feat(backend): owner helpers and keyed queue for session moves"
```

### Task 2: `moveSessionHistory` and `withOwnerLocks` on `TaskStore`

**Files:**
- Modify: `packages/backend/src/services/task-store.ts`:
  - add `rename` to the `fs/promises` import (line 17);
  - add a private `ownerLockTails` field next to `sessionLogSizes` (around line 709);
  - add `moveSessionHistory` and `withOwnerLocks` after `deleteSessionHistory` (around line 793);
  - make the three Master mutations (`addMasterSession`, `removeMasterSession`, `updateMasterSession`, lines 238-263) and the Master branch of `reconcileAllSessionLists` (around line 336) replace the cache only after the write succeeds;
  - take an optional second constructor argument, `masterFileOperations?: FileOperations`, used only for the Master list's write. It is the test seam for a failing write.
- Test: `packages/backend/tests/services/task-store.test.ts`. Add `rename`, `stat` and `unlink` to its `fs/promises` import, and `import type { FileOperations } from "../../src/services/write-file-atomic";`.

**Interfaces:**
- Produces:
  - `TaskStore.moveSessionHistory(fromOwnerId: string, toOwnerId: string, sessionId: string): Promise<void>`
  - `TaskStore.withOwnerLocks<T>(keys: string[], work: () => Promise<T>): Promise<T>`. `keys` come from `ownerKey()`. It reserves every key synchronously, at call time, so calls are served in call order on each key. The method is not reentrant, and `work` must never wait on a session's queue (Section 2).
  - `new TaskStore(config, masterFileOperations?)`. Existing callers pass one argument and don't change.

- [ ] **Step 1: Write the failing tests**

Inside `describe("TaskStore", ...)`:

```ts
    describe("session history move", () => {
        const logPath = (ownerId: string, sessionId: string) =>
            join(tempDir, "session-logs", `${ownerId}--${sessionId}.jsonl`);
        const exists = (path: string) =>
            stat(path).then(
                () => true,
                () => false,
            );

        it("renames the log so history and later appends follow the session", async () => {
            await store.appendSessionOutput("task-a", "s1", 1, "before\r\n");

            await store.moveSessionHistory("task-a", "task-b", "s1");
            await store.appendSessionOutput("task-b", "s1", 2, "after\r\n");

            expect(await exists(logPath("task-a", "s1"))).toBe(false);
            const history = await store.getSessionHistory("task-b", "s1");
            expect(history.data).toBe("before\r\nafter\r\n");
            expect(history.lastSequence).toBe(2);
        });

        it("treats a missing source log as nothing to move", async () => {
            await store.moveSessionHistory("task-a", "task-b", "missing");

            expect(await exists(logPath("task-b", "missing"))).toBe(false);
        });

        it("waits for an append already queued on the source log", async () => {
            const pending = store.appendSessionOutput("task-a", "s1", 1, "queued\r\n");
            const moved = store.moveSessionHistory("task-a", "task-b", "s1");
            await Promise.all([pending, moved]);

            expect(await exists(logPath("task-a", "s1"))).toBe(false);
            expect((await store.getSessionHistory("task-b", "s1")).data).toBe("queued\r\n");
        });
    });

    describe("owner locks", () => {
        it("serializes work on a shared key and not on disjoint keys", async () => {
            const seen: string[] = [];
            let releaseFirst!: () => void;
            const gate = new Promise<void>((resolve) => {
                releaseFirst = resolve;
            });
            const first = store.withOwnerLocks(["task:a", "task:b"], async () => {
                await gate;
                seen.push("move");
            });
            const second = store.withOwnerLocks(["task:b"], async () => {
                seen.push("archive b");
            });
            const third = store.withOwnerLocks(["task:c"], async () => {
                seen.push("archive c");
            });
            await third;
            expect(seen).toEqual(["archive c"]);
            releaseFirst();
            await Promise.all([first, second]);
            expect(seen).toEqual(["archive c", "move", "archive b"]);
        });

        it("does not deadlock on opposite key orders", async () => {
            await Promise.all([
                store.withOwnerLocks(["task:a", "task:b"], async () => {}),
                store.withOwnerLocks(["task:b", "task:a"], async () => {}),
            ]);
        });
    });

    describe("master session writes", () => {
        let failWrites = false;
        const operations: FileOperations = {
            writeFile: (path, data) => writeFile(path, data),
            // EIO, not EACCES: a permission error would take the in-place fallback.
            rename: (from, to) =>
                failWrites
                    ? Promise.reject(Object.assign(new Error("disk full"), { code: "EIO" }))
                    : rename(from, to),
            unlink: (path) => unlink(path),
        };
        const masterRef = (id: string, bootId = "boot-1") => ({
            id,
            type: "claude" as const,
            label: "Claude",
            createdAt: "2026-10-03T00:00:00.000Z",
            instance: "main",
            bootId,
            state: "live" as const,
            nativeSessionId: `${id}-native`,
        });
        let masterFile: string;
        let master: TaskStore;

        beforeEach(async () => {
            failWrites = false;
            masterFile = join(tempDir, "sessions", "main", "master.json");
            master = new TaskStore(
                {
                    projectsFile: join(tempDir, "projects.json"),
                    tasksDir: join(tempDir, "tasks"),
                    archiveDir: join(tempDir, "archive"),
                    sessionLogsDir: join(tempDir, "session-logs"),
                    taskLogsDir: join(tempDir, "task-logs"),
                    masterSessionsFile: masterFile,
                },
                operations,
            );
            await master.init();
        });

        const onDisk = async () => JSON.parse(await readFile(masterFile, "utf-8")) as unknown;

        it("leaves the cache as on disk when a write fails", async () => {
            await master.addMasterSession(masterRef("kept"));
            failWrites = true;

            await expect(master.addMasterSession(masterRef("added"))).rejects.toThrow("disk full");
            expect(master.getMasterSessions()).toEqual([masterRef("kept")]);
            await expect(master.removeMasterSession("kept")).rejects.toThrow("disk full");
            expect(master.getMasterSessions()).toEqual([masterRef("kept")]);
            await expect(master.updateMasterSession("kept", { label: "Renamed" })).rejects.toThrow(
                "disk full",
            );
            expect(master.getMasterSessions()).toEqual([masterRef("kept")]);
            expect(await onDisk()).toEqual([masterRef("kept")]);
        });

        it("leaves the cache as on disk when a reconcile write fails", async () => {
            await master.addMasterSession(masterRef("stale", "old-boot"));
            failWrites = true;

            await expect(master.reconcileInterruptedSessions("main", "new-boot")).rejects.toThrow(
                "disk full",
            );
            expect(master.getMasterSessions()).toEqual([masterRef("stale", "old-boot")]);
            expect(await onDisk()).toEqual([masterRef("stale", "old-boot")]);
        });
    });
```

Each assertion follows the failed call directly, because the next mutation reloads the cache from disk and would hide a stale one. Both tests fail on today's code (it assigns the cache before it writes); that is the regression they pin.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/backend && bun test tests/services/task-store.test.ts -t "session history move|owner locks|master session writes"`
Expected: FAIL. The methods don't exist, the constructor ignores the second argument, and the Master mutations assign the cache before they write.

- [ ] **Step 3: Implement**

Change line 17 to:

```ts
import { appendFile, open, readFile, readdir, mkdir, realpath, rename, rm, stat } from "fs/promises";
```

Add `type FileOperations` to the `./write-file-atomic` import (line 24), and give the constructor the seam:

```ts
    constructor(
        config: TaskStoreConfig,
        /** Only the Master list's write uses these; tests inject a failing write. */
        private readonly masterFileOperations?: FileOperations,
    ) {
        this.config = config;
    }
```

Next to `sessionLogSizes`, add:

```ts
    // Owner lock tails: the promise each owner key's last holder resolves on release.
    private readonly ownerLockTails = new Map<string, Promise<void>>();
```

After `deleteSessionHistory`:

```ts
    /**
     * Re-key a session's log to a new owner. Holds both paths' mutation
     * queues (in a fixed order, so two opposite moves cannot deadlock), so an
     * append already queued on the old path lands before the rename.
     */
    async moveSessionHistory(
        fromOwnerId: string,
        toOwnerId: string,
        sessionId: string,
    ): Promise<void> {
        const from = this.sessionLogPath(fromOwnerId, sessionId);
        const to = this.sessionLogPath(toOwnerId, sessionId);
        if (from === to) return;
        const [first, second] = from < to ? [from, to] : [to, from];
        await this.withSessionLogMutation(first, () =>
            this.withSessionLogMutation(second, async () => {
                try {
                    await rename(from, to);
                } catch (error) {
                    if (!isMissingFileError(error)) throw error;
                }
                const size = this.sessionLogSizes.get(from);
                this.sessionLogSizes.delete(from);
                if (size === undefined) this.sessionLogSizes.delete(to);
                else this.sessionLogSizes.set(to, size);
            }),
        );
    }

    /**
     * Serialize work that changes which sessions an owner holds: a session
     * move, and archiving, deleting or removing its source or target. Keys
     * come from ownerKey(). Every key is reserved synchronously when this is
     * called, so each key serves its callers in call order and two calls can
     * never hold each other's keys (no deadlock). Not reentrant, and nothing
     * run under it may wait on a session's queue.
     */
    async withOwnerLocks<T>(keys: string[], work: () => Promise<T>): Promise<T> {
        const unique = [...new Set(keys)];
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const previous = unique.map((key) => {
            const tail = this.ownerLockTails.get(key) ?? Promise.resolve();
            this.ownerLockTails.set(key, held);
            return tail;
        });
        try {
            await Promise.all(previous);
            return await work();
        } finally {
            release();
            for (const key of unique) {
                if (this.ownerLockTails.get(key) === held) this.ownerLockTails.delete(key);
            }
        }
    }
```

Why not nest `KeyedQueue.run` per key: a nested acquisition reserves its second key only after it holds the first, so a later caller on the second key can overtake it. The order then depends on timing, and the "serializes work on a shared key" test fails.

Master mutations. `withMasterSessionsMutation` reloads `this.masterSessions` from disk, but the three mutations change the cache before they write it. If the write fails, the cache keeps a ref that isn't on disk (or loses one that is), and `getMasterSessions()` serves it to broadcasts and to the move's checks until the next mutation reloads. Build the next list, write it, then assign:

```ts
    async addMasterSession(session: SessionRef): Promise<void> {
        await this.withMasterSessionsMutation(() =>
            this.commitMasterSessions([...this.masterSessions, session]),
        );
    }

    async removeMasterSession(sessionId: string): Promise<void> {
        await this.withMasterSessionsMutation(() =>
            this.commitMasterSessions(this.masterSessions.filter((s) => s.id !== sessionId)),
        );
    }

    async updateMasterSession(sessionId: string, updates: Partial<SessionRef>): Promise<void> {
        await this.withMasterSessionsMutation(() =>
            this.commitMasterSessions(
                this.masterSessions.map((s) => (s.id === sessionId ? { ...s, ...updates } : s)),
            ),
        );
    }
```

and replace `persistMasterSessions` with:

```ts
    /** Write the list, then make it the cache, so a failed write leaves the cache as on disk. */
    private async commitMasterSessions(next: SessionRef[]): Promise<void> {
        await writeJsonAtomic(this.masterSessionsFile, next, this.masterFileOperations);
        this.masterSessions = next;
    }
```

The reconcile pass (`reconcileAllSessionLists`, around line 337) also calls `persistMasterSessions`. Convert it the same way:

```ts
            await this.withMasterSessionsMutation(async () => {
                const latest = reconcile(this.masterSessions);
                dropped = latest.dropped;
                if (latest.changed) await this.commitMasterSessions(latest.sessions);
            });
```

The "master session writes" tests guard this ordering. Section 3's Master rollback tests check the move's rollback, not the cache order: their spies reject before the store's body runs.
```

- [ ] **Step 4: Run the tests, then commit**

Run: `cd packages/backend && bun test tests/services/task-store.test.ts`
Expected: PASS.

```bash
git add packages/backend/src/services/task-store.ts packages/backend/tests/services/task-store.test.ts
git commit -m "feat(backend): re-key a session log and lock owners during a move"
```

### Task 3: Boot repair for an unfinished move

A move runs: rename the log, add the ref to the target, remove the ref from the source (Section 3). If the process dies between those steps, one of two things is left behind:

- **After the rename only:** the ref is still in the source, but the log is filed under the target. The boot sweep would delete that log as an orphan.
- **After the add:** both owners list the session, and the log is under the target.

`repairMovedSessions` fixes both before reconcile and sweep run.

**Files:**
- Modify: `packages/backend/src/services/task-store.ts`. Add `repairMovedSessions` above `sweepOrphanSessionLogs` (around line 168).
- Modify: `packages/backend/src/index.ts`. Call it at boot, before `reconcileInterruptedSessions` (line 90).
- Test: `packages/backend/tests/services/task-store.test.ts`

**Interfaces:**
- Produces: `TaskStore.repairMovedSessions(instanceId: string): Promise<void>`. It only touches refs whose `instance === instanceId`, plus this instance's log directory.

- [ ] **Step 1: Write the failing tests**

```ts
    describe("repairing an unfinished move", () => {
        const ref = (id: string) => ({
            id,
            type: "claude" as const,
            label: "Claude",
            createdAt: new Date().toISOString(),
            instance: "main",
            bootId: "old-boot",
            state: "live" as const,
            nativeSessionId: id,
        });

        async function twoTasks() {
            const projectDir = await createProjectDir("repair");
            const project = await store.addProject({ name: "repair", path: projectDir });
            const a = await store.createTask({ projectId: project.id, title: "A", description: "" });
            const b = await store.createTask({ projectId: project.id, title: "B", description: "" });
            return { a, b };
        }

        it("keeps the copy whose log exists when two owners list a session", async () => {
            const { a, b } = await twoTasks();
            await store.updateTask(a.id, { sessions: [ref("s1")] });
            await store.updateTask(b.id, { sessions: [ref("s1")] });
            await store.appendSessionOutput(b.id, "s1", 1, "moved\r\n");

            await store.repairMovedSessions("main");

            expect((await store.getTask(a.id))?.sessions).toEqual([]);
            expect((await store.getTask(b.id))?.sessions.map((s) => s.id)).toEqual(["s1"]);
        });

        it("re-files a log under the one owner that lists its session", async () => {
            const { a, b } = await twoTasks();
            await store.updateTask(a.id, { sessions: [ref("s1")] });
            await store.appendSessionOutput(b.id, "s1", 1, "renamed early\r\n");

            await store.repairMovedSessions("main");

            expect((await store.getSessionHistory(a.id, "s1")).data).toBe("renamed early\r\n");
            expect(await store.sweepOrphanSessionLogs()).toBe(0);
        });

        it("leaves other instances' refs alone", async () => {
            const { a, b } = await twoTasks();
            await store.updateTask(a.id, { sessions: [{ ...ref("s1"), instance: "dev-x" }] });
            await store.updateTask(b.id, { sessions: [{ ...ref("s1"), instance: "dev-x" }] });

            await store.repairMovedSessions("main");

            expect((await store.getTask(a.id))?.sessions).toHaveLength(1);
            expect((await store.getTask(b.id))?.sessions).toHaveLength(1);
        });
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/backend && bun test tests/services/task-store.test.ts -t "unfinished move"`
Expected: FAIL. The method doesn't exist.

- [ ] **Step 3: Implement**

Above `sweepOrphanSessionLogs`:

```ts
    /**
     * Finish what an interrupted session move left behind. A move renames the
     * log, then adds the ref to its target, then removes it from its source,
     * so a session listed by two owners keeps the copy whose log exists, and a
     * log filed under an owner that does not list its session is re-filed
     * under the one owner that does. Runs at boot, before reconcile and the
     * orphan sweep.
     */
    async repairMovedSessions(instanceId: string): Promise<void> {
        let files: string[];
        try {
            files = await readdir(this.config.sessionLogsDir);
        } catch (error) {
            if (isMissingFileError(error)) return;
            throw error;
        }
        const logs = new Set(
            files.filter((file) => file.endsWith(".jsonl")).map((file) => file.slice(0, -6)),
        );
        const [tasks, projects] = await Promise.all([this.listTasks(), this.listProjects()]);
        type Holder = { kind: "task" | "project" | "master"; id: string };
        const holders = new Map<string, Holder[]>();
        const note = (holder: Holder, sessions: SessionRef[]) => {
            for (const session of sessions) {
                if (session.instance !== instanceId) continue;
                holders.set(session.id, [...(holders.get(session.id) ?? []), holder]);
            }
        };
        for (const task of tasks) note({ kind: "task", id: task.id }, task.sessions);
        for (const project of projects) note({ kind: "project", id: project.id }, project.sessions);
        note({ kind: "master", id: "master" }, this.masterSessions);

        for (const [sessionId, owners] of holders) {
            if (owners.length < 2) continue;
            const keep = owners.find((owner) => logs.has(`${owner.id}--${sessionId}`)) ?? owners[0];
            for (const owner of owners) {
                if (owner === keep) continue;
                const without = (sessions: SessionRef[]) =>
                    sessions.filter((session) => session.id !== sessionId);
                if (owner.kind === "task") {
                    await this.updateTask(owner.id, (task) => ({ sessions: without(task.sessions) }));
                } else if (owner.kind === "project") {
                    await this.updateProject(owner.id, (project) => ({
                        sessions: without(project.sessions),
                    }));
                } else {
                    await this.removeMasterSession(sessionId);
                }
            }
            holders.set(sessionId, [keep]);
        }

        for (const name of logs) {
            const separator = name.indexOf("--");
            if (separator < 0) continue;
            const ownerId = name.slice(0, separator);
            const sessionId = name.slice(separator + 2);
            const owners = holders.get(sessionId);
            if (owners?.length !== 1 || owners[0].id === ownerId) continue;
            if (logs.has(`${owners[0].id}--${sessionId}`)) continue;
            await this.moveSessionHistory(ownerId, owners[0].id, sessionId);
        }
    }
```

If `SessionRef` isn't already imported as a type in `task-store.ts`, add it to the existing `@taskflow/shared` type import.

In `index.ts`, before `await store.reconcileInterruptedSessions(config.instanceId, config.bootId);`, add:

```ts
        await store.repairMovedSessions(config.instanceId);
```

- [ ] **Step 4: Run the tests, then commit**

```bash
cd packages/backend && bun test tests/services/task-store.test.ts && cd ../..
bun run typecheck
bunx eslint packages/backend/src/services/task-store.ts packages/backend/src/index.ts packages/backend/tests/services/task-store.test.ts packages/backend/src/services/session-owner.ts packages/backend/src/services/keyed-queue.ts
bunx prettier --check packages/backend/src/services/task-store.ts packages/backend/src/index.ts packages/backend/tests/services/task-store.test.ts packages/backend/src/services/session-owner.ts packages/backend/src/services/keyed-queue.ts packages/shared/src/types/ws.ts packages/shared/src/constants.ts
git add packages/backend/src/services/task-store.ts packages/backend/src/index.ts packages/backend/tests/services/task-store.test.ts
git commit -m "feat(backend): repair a session move the process did not finish"
```

Update `handoff.md`: Section 1 is done, with the commit hashes.
