# Section 1: Shared types and `TaskStore.moveSessionHistory`

Read first: the plan index (`../2026-10-03-move-session.md`), `handoff.md`, and the spec sections "API" and "`moveSession`" step 2.

### Task 1: Owner type, move payload, message constant, and log rename

**Files:**
- Modify: `packages/shared/src/types/ws.ts`. Add the types after `SessionHistoryPayload` (around line 223).
- Modify: `packages/shared/src/constants.ts`. Add `SESSION_MOVE` after `SESSION_RENAME` (around line 82).
- Modify: `packages/backend/src/services/task-store.ts`:
  - add `rename` to the `fs/promises` import (line 17);
  - add `moveSessionHistory` after `deleteSessionHistory` (around line 793).
- Test: `packages/backend/tests/services/task-store.test.ts`. Add a new `describe("session history move")` inside `describe("TaskStore")`.

**Interfaces:**
- Produces (shared):
  - `interface SessionOwnerRef { taskId?: string; projectId?: string; master?: boolean }`
  - `interface SessionMovePayload extends SessionOwnerRef { sessionId: string }`
  - `MSG.SESSION_MOVE = "session:move"`
- Produces (backend): `TaskStore.moveSessionHistory(fromOwnerId: string, toOwnerId: string, sessionId: string): Promise<void>`

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

Add to `packages/backend/tests/services/task-store.test.ts`, inside `describe("TaskStore", ...)`. Add `stat` to the existing `fs/promises` import at the top.

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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/task-store.test.ts -t "session history move"`
Expected: FAIL. `store.moveSessionHistory is not a function`.

- [ ] **Step 4: Implement `moveSessionHistory`**

In `task-store.ts`, change the import on line 17 to include `rename`:

```ts
import { appendFile, open, readFile, readdir, mkdir, realpath, rename, rm, stat } from "fs/promises";
```

Add after `deleteSessionHistory`:

```ts
    /**
     * Re-key a session's log to a new owner. Holds both paths' mutation
     * queues (in a fixed order, so two opposite moves cannot deadlock), so
     * an append already queued on the old path lands before the rename.
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/task-store.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Typecheck, lint, format, commit**

```bash
bun run typecheck
bunx eslint packages/shared/src/types/ws.ts packages/shared/src/constants.ts packages/backend/src/services/task-store.ts packages/backend/tests/services/task-store.test.ts
bunx prettier --check packages/shared/src/types/ws.ts packages/shared/src/constants.ts packages/backend/src/services/task-store.ts packages/backend/tests/services/task-store.test.ts
git add packages/shared/src/types/ws.ts packages/shared/src/constants.ts packages/backend/src/services/task-store.ts packages/backend/tests/services/task-store.test.ts
git commit -m "feat(backend): re-key a session's output log to a new owner"
```

Update `handoff.md`: Section 1 is done, with the commit hash.
