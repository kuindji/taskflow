# Section 3: `moveSession`, `getSessionOwner`, WS and REST

Read first: the plan index, `handoff.md`, and the spec sections "`moveSession`", "Owner lookup" and "API". Section 2 has to be done: it provides `owners`, `broadcastOwner` and `patchOwnedSessionRef` inside `createSessionLifecycle`.

### Task 4: `moveSession` and `getSessionOwner` in the lifecycle

**Files:**
- Modify: `packages/backend/src/services/session-lifecycle.ts`. Add the two functions before `return {` (around line 820) and export them from the returned object.
- Test: `packages/backend/tests/handlers/session.test.ts`. Add a new `describe("session move")` inside `describe("session handlers")`.

**Interfaces:**
- Consumes:
  - `owners: SessionOwnerRegistry`, `broadcastOwner`, `patchOwnedSessionRef` (Section 2);
  - `normalizeOwner`, `ownerIdOf`, `sameOwner` from `./session-owner-registry`;
  - `TaskStore.moveSessionHistory` (Section 1).
- Produces (on the lifecycle object):
  - `moveSession(sessionId: string, target: SessionOwnerRef): Promise<void>`
  - `getSessionOwner(sessionId: string): Promise<SessionOwnerRef | null>`. For a task, the result also includes `projectId`.

- [ ] **Step 1: Write the failing tests**

Add inside `describe("session handlers")`. It uses `waitFor` from Section 2, plus `store`, `ptyManager`, `events`, `sessionLifecycle` and `projectId` from the fixture.

```ts
    describe("session move", () => {
        async function twoTasks() {
            const a = await store.createTask({ projectId, title: "A", description: "" });
            const b = await store.createTask({ projectId, title: "B", description: "" });
            return { a, b };
        }

        it("moves a task session to another task with its log and cwd", async () => {
            const { a, b } = await twoTasks();
            const sessionId = await sessionLifecycle.createSession({
                owner: { taskId: a.id },
                type: "codex",
            });
            const before = (await store.getTask(a.id))?.sessions[0];
            ptyManager.emit(sessionId, "before\r\n");

            await sessionLifecycle.moveSession(sessionId, { taskId: b.id });
            ptyManager.emit(sessionId, "after\r\n");

            expect((await store.getTask(a.id))?.sessions).toEqual([]);
            expect((await store.getTask(b.id))?.sessions).toEqual([before]);
            await waitFor(
                async () =>
                    (await store.getSessionHistory(b.id, sessionId)).data === "before\r\nafter\r\n",
            );
            expect((await store.getSessionHistory(a.id, sessionId)).data).toBe("");
            expect(ptyManager.spawns).toHaveLength(1);
        });

        it("broadcasts both owners", async () => {
            const { a, b } = await twoTasks();
            const sessionId = await sessionLifecycle.createSession({
                owner: { taskId: a.id },
                type: "codex",
            });
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
            const sessionId = await sessionLifecycle.createSession({
                owner: { taskId: a.id },
                type: "codex",
            });
            ptyManager.emit(sessionId, "output\r\n");
            await sessionLifecycle.moveSession(sessionId, { taskId: b.id });

            ptyManager.close(sessionId);

            await waitFor(async () => (await store.getTask(b.id))?.sessions.length === 0);
            await waitFor(
                async () => (await store.getSessionHistory(b.id, sessionId)).data === "",
            );
            expect(await sessionLifecycle.getSessionOwner(sessionId)).toBeNull();
        });

        it("records a late native session id on the new owner", async () => {
            let resolveDiscovery!: (id: string) => void;
            const discovered = new Promise<string>((resolve) => {
                resolveDiscovery = resolve;
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
                    acquire: async () => async () => {},
                    capture: async () => new Set<string>(),
                    discover: () => discovered,
                },
            });
            const { a, b } = await twoTasks();
            const sessionId = await lifecycle.createSession({
                owner: { taskId: a.id },
                type: "codex",
            });

            await lifecycle.moveSession(sessionId, { taskId: b.id });
            resolveDiscovery("native-1");

            await waitFor(
                async () =>
                    (await store.getTask(b.id))?.sessions[0]?.nativeSessionId === "native-1",
            );
        });

        it("refuses sessions and targets it cannot move", async () => {
            const { a, b } = await twoTasks();
            const shell = await sessionLifecycle.createSession({
                owner: { taskId: a.id },
                type: "shell",
                shell: "/bin/sh",
            });
            const agent = await sessionLifecycle.createSession({
                owner: { taskId: a.id },
                type: "codex",
            });

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
            const agent = await sessionLifecycle.createSession({
                owner: { taskId: a.id },
                type: "codex",
            });
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
            const sessionId = await sessionLifecycle.createSession({
                owner: { taskId: a.id },
                type: "codex",
            });

            await sessionLifecycle.moveSession(sessionId, { taskId: b.id });

            expect((await store.getTask(a.id))?.sessions.map((s) => s.id)).toEqual(["foreign"]);
            expect((await store.getTask(b.id))?.sessions.map((s) => s.id)).toEqual([
                "foreign-b",
                sessionId,
            ]);
        });
    });
```

Add `SessionRef` to the test file's imports (`import type { SessionRef } from "@taskflow/shared";`) if it isn't there yet.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/backend && bun test tests/handlers/session.test.ts -t "session move"`
Expected: FAIL. `sessionLifecycle.moveSession is not a function`.

- [ ] **Step 3: Implement**

In `session-lifecycle.ts`, extend the registry import:

```ts
import {
    SessionOwnerRegistry,
    normalizeOwner,
    ownerIdOf,
    sameOwner,
} from "./session-owner-registry";
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
            await taskStore.removeMasterSession(ref.id);
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

    /**
     * Re-home a live agent session: its ref, its output log and the owner the
     * lifecycle reads. The process and its cwd are untouched. Runs on the
     * session's queue, so output, exit and discovery see either the old owner
     * or the new one, never a half-moved session. The target is written
     * before the source is cleared, so a crash leaves a duplicate (which boot
     * reconcile tolerates) rather than a lost session.
     */
    async function moveSession(sessionId: string, target: SessionOwner): Promise<void> {
        const destination = normalizeOwner(target);
        const source = await owners.run(sessionId, async () => {
            const current = owners.get(sessionId);
            if (!current || !ptyManager.has(sessionId)) throw new Error("Session is not running");
            const ref = await findOwnedSessionRef(current, sessionId);
            if (!ref) throw new Error("Session is not running");
            if (!isAgentType(ref.type)) throw new Error("Only agent sessions can be moved");
            if (ref.flow) throw new Error("Flow sessions cannot be moved");
            if (ref.remoteControl) throw new Error("The remote agent session cannot be moved");
            if (ref.instance !== config.instanceId) {
                throw new Error("Session belongs to another instance");
            }
            await assertOwnerExists(destination);
            if (sameOwner(current, destination)) throw new Error("Session is already there");

            await addOwnedSessionRef(destination, ref);
            await removeOwnedSessionRef(current, sessionId);
            await taskStore.moveSessionHistory(
                ownerIdOf(current),
                ownerIdOf(destination),
                sessionId,
            );
            owners.set(sessionId, destination);
            return current;
        });
        await broadcastOwner(source);
        await broadcastOwner(destination);
    }

    async function getSessionOwner(sessionId: string): Promise<SessionOwner | null> {
        const owner = owners.get(sessionId);
        if (!owner) return null;
        if (!owner.taskId) return { ...owner };
        const task = await taskStore.getTask(owner.taskId);
        return task ? { taskId: task.id, projectId: task.projectId } : { taskId: owner.taskId };
    }
```

Add `moveSession` and `getSessionOwner` to the returned object.

Note: `normalizeOwner` throws the "Exactly one…" error before anything is queued, so a malformed target never touches the session.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && bun test tests/handlers/session.test.ts`
Expected: PASS. Run it three times; the `waitFor`-based tests must not flake.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/session-lifecycle.ts packages/backend/tests/handlers/session.test.ts
git commit -m "feat(backend): move a live agent session to another owner"
```

### Task 5: WS handler and REST routes

**Files:**
- Modify: `packages/backend/src/handlers/session.ts`. Register `MSG.SESSION_MOVE` after `MSG.SESSION_RENAME`.
- Modify: `packages/backend/src/api/routes/session-routes.ts`:
  - deps type (lines 17-32);
  - routes after the resume route (around line 208).
- Modify: `packages/backend/src/api/routes.ts`. The `sessionLifecycle` dep type (lines 45-52) reuses the session-routes type.
- Modify: `packages/backend/tests/api/routes.test.ts`. Extend the stub at lines 36-40 and add route tests.
- Check: `packages/backend/tests/api/flow-artifact-raw.test.ts`. If it builds a `sessionLifecycle` stub for `registerApiRoutes`, extend it the same way so typecheck passes.

**Interfaces:**
- Consumes: `moveSession` and `getSessionOwner` (Task 4); `SessionMovePayload` and `SessionOwnerRef` (Section 1).
- Produces:
  - WS `MSG.SESSION_MOVE`, which returns `{ success: true }`;
  - `POST /api/sessions/:sessionId/move` with body `SessionOwnerRef`. Returns 200 `{ success: true }`, or 400 `{ error }`.
  - `GET /api/sessions/:sessionId/owner`. Returns 200 `SessionOwnerRef`, or 404 `{ error: "Session not found" }`.
  - `type SessionRouteLifecycle`, exported from `session-routes.ts` and used by `routes.ts`.

- [ ] **Step 1: Write the failing route tests**

In `tests/api/routes.test.ts`, replace the `sessionLifecycle` stub in `sharedTestDeps` with one that records moves and answers owner lookups:

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
        getSessionOwner: async (sessionId: string) =>
            sessionId === "session-1" ? { taskId: "t1", projectId: "p1" } : null,
    },
```

Add `type SessionOwnerRef` to the file's `@taskflow/shared` import. The rest of `sharedTestDeps` stays as it is. Add `moveCalls.length = 0;` at the top of `beforeEach`. Then add these tests to `describe("api routes")`:

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

Add a WS handler test to `tests/handlers/session.test.ts` (inside `describe("session move")`):

```ts
        it("moves through the SESSION_MOVE message", async () => {
            const { a, b } = await twoTasks();
            const sessionId = await sessionLifecycle.createSession({
                owner: { taskId: a.id },
                type: "codex",
            });

            expect(
                await router.handle(MSG.SESSION_MOVE, { sessionId, taskId: b.id }),
            ).toEqual({ success: true });
            expect((await store.getTask(b.id))?.sessions.map((s) => s.id)).toEqual([sessionId]);
        });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/backend && bun test tests/api/routes.test.ts tests/handlers/session.test.ts -t "move|owner"`
Expected: FAIL. The routes return 404 (no route) and the WS handler is not registered.

- [ ] **Step 3: Implement**

`handlers/session.ts`: add `SessionMovePayload` to the type import, then after the `SESSION_RENAME` registration add:

```ts
    router.register(MSG.SESSION_MOVE, async (payload) => {
        const { sessionId, taskId, projectId, master } = payload as SessionMovePayload;
        await sessionLifecycle.moveSession(sessionId, { taskId, projectId, master });
        return { success: true };
    });
```

`api/routes/session-routes.ts`: replace the inline `sessionLifecycle` type in `SessionRouteDeps` with:

```ts
type SessionRouteLifecycle = Pick<
    ReturnType<typeof createSessionLifecycle>,
    "createSession" | "resumeSession" | "removeSessionFromOwner" | "moveSession" | "getSessionOwner"
>;

interface SessionRouteDeps {
    // ...existing fields unchanged...
    sessionLifecycle: SessionRouteLifecycle;
}
```

Use `import type { createSessionLifecycle, CreateSessionOpts } from "../../services/session-lifecycle";`, and export `SessionRouteLifecycle` next to the existing exports. Remove the now-unused `CreateSessionOpts` import if nothing else in the file uses it.

`resumeSession` in the lifecycle takes `(sessionId, cols?, rows?)`. The route only passes `sessionId`, so the `Pick` is compatible with the existing call. If the test stubs fail to type-check against `Pick`, keep the explicit structural type instead, extended with:

```ts
        moveSession: (sessionId: string, target: SessionOwnerRef) => Promise<void>;
        getSessionOwner: (sessionId: string) => Promise<SessionOwnerRef | null>;
```

Then export that type under the same name. Either way, `routes.ts` must import `SessionRouteLifecycle` instead of repeating the shape.

Add the routes after the resume route:

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

Add `SessionOwnerRef` to the file's `@taskflow/shared` type import.

`api/routes.ts`: replace the inline `sessionLifecycle: { … }` type with `sessionLifecycle: SessionRouteLifecycle;`, imported from `./routes/session-routes`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && bun test tests/api tests/handlers/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, lint, format, commit**

```bash
cd packages/backend && bun test && cd ../..
bun run typecheck
bunx eslint packages/backend/src/handlers/session.ts packages/backend/src/api/routes/session-routes.ts packages/backend/src/api/routes.ts packages/backend/tests/api/routes.test.ts packages/backend/tests/handlers/session.test.ts
bunx prettier --check packages/backend/src/handlers/session.ts packages/backend/src/api/routes/session-routes.ts packages/backend/src/api/routes.ts packages/backend/tests/api/routes.test.ts packages/backend/tests/handlers/session.test.ts
git add packages/backend/src/handlers/session.ts packages/backend/src/api packages/backend/tests/api packages/backend/tests/handlers/session.test.ts
git commit -m "feat(backend): expose session move and owner lookup over WS and REST"
```

Update `handoff.md`: Section 3 is done, with the commit hashes and the exact route shapes.
