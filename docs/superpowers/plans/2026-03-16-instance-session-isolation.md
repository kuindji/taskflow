# Instance-Aware Session Isolation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent cross-instance terminal session interference by filtering session data at the backend boundary so each instance only exposes its own sessions to the UI.

**Architecture:** Add a `filterSessionsByInstance` utility that strips foreign-instance sessions from Task/Project objects. Apply it at every point where data leaves the backend to the UI (handler returns, broadcast payloads). Simplify `clearAllSessions` to only remove own-instance sessions.

**Tech Stack:** TypeScript, Bun test runner

**Spec:** `docs/superpowers/specs/2026-03-16-instance-session-isolation-design.md`

---

## Chunk 1: Filter utility and TaskStore cleanup

### Task 1: Add `filterSessionsByInstance` utility

**Files:**
- Create: `packages/backend/src/services/instance-filter.ts`
- Test: `packages/backend/tests/services/instance-filter.test.ts`

This utility filters `sessions` arrays on Task and Project objects, keeping only sessions that match the given `instanceId`. Sessions with no `instance` field (legacy) are also removed.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/backend/tests/services/instance-filter.test.ts
import { describe, it, expect } from "bun:test";
import { filterTaskSessions, filterProjectSessions } from "../../src/services/instance-filter";
import type { Task } from "@taskflow/shared";
import type { Project } from "@taskflow/shared";

function makeSessionRef(id: string, instance?: string) {
    return {
        id,
        type: "claude" as const,
        label: "Test",
        createdAt: new Date().toISOString(),
        ...(instance !== undefined ? { instance } : {}),
    };
}

describe("filterTaskSessions", () => {
    const baseTask: Task = {
        id: "task-1",
        projectId: "proj-1",
        title: "Test",
        description: "",
        notes: "",
        worktree: { enabled: false, path: null, branch: null },
        sessions: [],
        createdAt: new Date().toISOString(),
        status: "active",
        archivedAt: null,
        pinned: false,
    };

    it("keeps sessions matching the instanceId", () => {
        const task: Task = {
            ...baseTask,
            sessions: [
                makeSessionRef("s1", "main"),
                makeSessionRef("s2", "dev-feature"),
                makeSessionRef("s3", "main"),
            ],
        };
        const filtered = filterTaskSessions(task, "main");
        expect(filtered.sessions).toHaveLength(2);
        expect(filtered.sessions.map((s) => s.id)).toEqual(["s1", "s3"]);
    });

    it("removes sessions with no instance field (legacy)", () => {
        const task: Task = {
            ...baseTask,
            sessions: [makeSessionRef("s1"), makeSessionRef("s2", "main")],
        };
        const filtered = filterTaskSessions(task, "main");
        expect(filtered.sessions).toHaveLength(1);
        expect(filtered.sessions[0].id).toBe("s2");
    });

    it("returns empty sessions when none match", () => {
        const task: Task = {
            ...baseTask,
            sessions: [makeSessionRef("s1", "dev-feature")],
        };
        const filtered = filterTaskSessions(task, "main");
        expect(filtered.sessions).toEqual([]);
    });

    it("does not mutate the original task", () => {
        const task: Task = {
            ...baseTask,
            sessions: [makeSessionRef("s1", "main"), makeSessionRef("s2", "dev-feature")],
        };
        const filtered = filterTaskSessions(task, "main");
        expect(task.sessions).toHaveLength(2);
        expect(filtered.sessions).toHaveLength(1);
    });
});

describe("filterProjectSessions", () => {
    const baseProject: Project = {
        id: "proj-1",
        name: "Test",
        path: "/tmp/test",
        sessions: [],
        createdAt: new Date().toISOString(),
    };

    it("keeps only sessions matching the instanceId", () => {
        const project: Project = {
            ...baseProject,
            sessions: [
                makeSessionRef("s1", "main"),
                makeSessionRef("s2", "dev-main"),
            ],
        };
        const filtered = filterProjectSessions(project, "main");
        expect(filtered.sessions).toHaveLength(1);
        expect(filtered.sessions[0].id).toBe("s1");
    });

    it("does not mutate the original project", () => {
        const project: Project = {
            ...baseProject,
            sessions: [makeSessionRef("s1", "main"), makeSessionRef("s2", "dev-main")],
        };
        const filtered = filterProjectSessions(project, "main");
        expect(project.sessions).toHaveLength(2);
        expect(filtered.sessions).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/instance-filter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// packages/backend/src/services/instance-filter.ts
import type { Task, Project, SessionRef } from "@taskflow/shared";

function filterSessions(sessions: SessionRef[], instanceId: string): SessionRef[] {
    return sessions.filter((s) => s.instance === instanceId);
}

function filterTaskSessions(task: Task, instanceId: string): Task {
    return { ...task, sessions: filterSessions(task.sessions, instanceId) };
}

function filterProjectSessions(project: Project, instanceId: string): Project {
    return { ...project, sessions: filterSessions(project.sessions, instanceId) };
}

export { filterTaskSessions, filterProjectSessions };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/instance-filter.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/instance-filter.ts packages/backend/tests/services/instance-filter.test.ts
git commit -m "feat: add instance-aware session filtering utility"
```

---

### Task 2: Simplify `clearAllSessions`

**Files:**
- Modify: `packages/backend/src/services/task-store.ts:74-104`
- Modify: `packages/backend/src/index.ts:47`
- Test: `packages/backend/tests/services/task-store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/backend/tests/services/task-store.test.ts`, inside the top-level `describe("TaskStore")`:

```ts
describe("clearAllSessions", () => {
    it("only clears sessions matching the given instanceId", async () => {
        const projectDir = await createProjectDir("test");
        const project = await store.addProject({ name: "test", path: projectDir });
        const task = await store.createTask({
            projectId: project.id,
            title: "Task",
            description: "test",
        });

        await store.updateTask(task.id, {
            sessions: [
                { id: "s1", type: "claude", label: "A", createdAt: new Date().toISOString(), instance: "main" },
                { id: "s2", type: "claude", label: "B", createdAt: new Date().toISOString(), instance: "dev-feature" },
                { id: "s3", type: "claude", label: "C", createdAt: new Date().toISOString() },
            ],
        });
        await store.updateProject(project.id, {
            sessions: [
                { id: "s4", type: "shell", label: "D", createdAt: new Date().toISOString(), instance: "main" },
                { id: "s5", type: "shell", label: "E", createdAt: new Date().toISOString(), instance: "dev-feature" },
            ],
        });

        await store.clearAllSessions("main");

        const updatedTask = await store.getTask(task.id);
        expect(updatedTask!.sessions).toHaveLength(1);
        expect(updatedTask!.sessions[0].id).toBe("s2");

        const projects = await store.listProjects();
        const updatedProject = projects.find((p) => p.id === project.id)!;
        expect(updatedProject.sessions).toHaveLength(1);
        expect(updatedProject.sessions[0].id).toBe("s5");
    });

    it("clears all sessions when no instanceId is provided", async () => {
        const projectDir = await createProjectDir("test");
        const project = await store.addProject({ name: "test", path: projectDir });
        const task = await store.createTask({
            projectId: project.id,
            title: "Task",
            description: "test",
        });

        await store.updateTask(task.id, {
            sessions: [
                { id: "s1", type: "claude", label: "A", createdAt: new Date().toISOString(), instance: "main" },
            ],
        });

        await store.clearAllSessions();

        const updatedTask = await store.getTask(task.id);
        expect(updatedTask!.sessions).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run new tests to check current behavior**

Run: `cd packages/backend && bun test tests/services/task-store.test.ts`
Expected: The first test ("only clears sessions matching the given instanceId") should FAIL because the current code also removes legacy sessions (no `instance` field) and sessions older than 24h when `purgeStale` is true.

- [ ] **Step 3: Simplify `clearAllSessions` in task-store.ts**

Replace lines 74-104 of `packages/backend/src/services/task-store.ts`:

```ts
async clearAllSessions(instanceId?: string): Promise<void> {
    const [tasks, projects] = await Promise.all([this.listTasks(), this.listProjects()]);
    for (const task of tasks) {
        if (task.sessions.length === 0) continue;
        const remaining = instanceId
            ? task.sessions.filter((s) => s.instance !== instanceId)
            : [];
        if (remaining.length !== task.sessions.length) {
            await this.updateTask(task.id, { sessions: remaining });
        }
    }
    for (const project of projects) {
        if (project.sessions.length === 0) continue;
        const remaining = instanceId
            ? project.sessions.filter((s) => s.instance !== instanceId)
            : [];
        if (remaining.length !== project.sessions.length) {
            await this.updateProject(project.id, { sessions: remaining });
        }
    }
}
```

- [ ] **Step 4: Update call site in index.ts**

Change line 47 of `packages/backend/src/index.ts` from:
```ts
await store.clearAllSessions(config.instanceId, config.instanceId === "main");
```
to:
```ts
await store.clearAllSessions(config.instanceId);
```

- [ ] **Step 5: Run all task-store tests**

Run: `cd packages/backend && bun test tests/services/task-store.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/task-store.ts packages/backend/src/index.ts packages/backend/tests/services/task-store.test.ts
git commit -m "fix: simplify clearAllSessions to only remove own-instance sessions"
```

---

## Chunk 2: Apply filtering at UI-facing boundaries

### Task 3: Filter in WebSocket handlers (task + project)

**Files:**
- Modify: `packages/backend/src/handlers/task.ts:56-60` (TASK_LIST handler)
- Modify: `packages/backend/src/handlers/task.ts:96-99` (TASK_UPDATE handler)
- Modify: `packages/backend/src/handlers/task.ts:120-123` (TASK_LIST_ARCHIVED handler)
- Modify: `packages/backend/src/handlers/project.ts:28-31` (PROJECT_LIST handler)

The task and project handlers return data directly to the requesting WebSocket client. Apply `filterTaskSessions` / `filterProjectSessions` to all returned objects that contain session arrays.

Note: `TASK_CREATE` returns a newly created task (sessions is always `[]`), `PROJECT_ADD` and `PROJECT_FORK` return new projects (sessions always `[]`), so those don't need filtering.

- [ ] **Step 1: Add filtering to task handlers**

In `packages/backend/src/handlers/task.ts`:

Add import at top:
```ts
import { filterTaskSessions } from "../services/instance-filter";
import { config } from "../config";
```

Update `TASK_LIST` handler (line ~58):
```ts
router.register(MSG.TASK_LIST, async (payload) => {
    const { projectId } = (payload ?? {}) as TaskListPayload;
    const tasks = await store.listTasks(projectId);
    return { tasks: tasks.map((t) => filterTaskSessions(t, config.instanceId)) };
});
```

Update `TASK_UPDATE` handler (line ~98):
```ts
router.register(MSG.TASK_UPDATE, async (payload) => {
    const { id, ...updates } = payload as TaskUpdatePayload;
    const updated = await store.updateTask(id, updates);
    return filterTaskSessions(updated, config.instanceId);
});
```

Update `TASK_ARCHIVE` handler — the return at line ~117:
```ts
const archived = await store.archiveTask(id);
return filterTaskSessions(archived, config.instanceId);
```

Update `TASK_LIST_ARCHIVED` handler (line ~121):
```ts
router.register(MSG.TASK_LIST_ARCHIVED, async () => {
    const tasks = await store.listArchived();
    return { tasks: tasks.map((t) => filterTaskSessions(t, config.instanceId)) };
});
```

Update `TASK_UNARCHIVE` handler (line ~127):
```ts
const task = await store.unarchiveTask(id);
// ... cascade unarchive subtasks ...
return filterTaskSessions(task, config.instanceId);
```

- [ ] **Step 2: Add filtering to project handlers**

In `packages/backend/src/handlers/project.ts`:

Add import at top:
```ts
import { filterProjectSessions } from "../services/instance-filter";
import { config } from "../config";
```

Update `PROJECT_LIST` handler (line ~29):
```ts
router.register(MSG.PROJECT_LIST, async () => {
    const projects = await store.listProjects();
    return { projects: projects.map((p) => filterProjectSessions(p, config.instanceId)) };
});
```

Update `PROJECT_UPDATE` handler (line ~69):
```ts
const updated = await store.updateProject(id, updates);
return filterProjectSessions(updated, config.instanceId);
```

- [ ] **Step 3: Run existing handler tests to verify no regressions**

Run: `cd packages/backend && bun test tests/handlers/task.test.ts tests/handlers/project.test.ts`
Expected: All PASS (existing tests don't assert on sessions from foreign instances)

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/handlers/task.ts packages/backend/src/handlers/project.ts
git commit -m "fix: filter sessions by instance in task and project WebSocket handlers"
```

---

### Task 4: Filter in session-lifecycle broadcasts

**Files:**
- Modify: `packages/backend/src/services/session-lifecycle.ts:194-210`

After session creation, the lifecycle service broadcasts the full task/project to all connected UI clients. These payloads must be filtered before broadcast.

- [ ] **Step 1: Add filtering to session-lifecycle broadcasts**

In `packages/backend/src/services/session-lifecycle.ts`:

Add import at top:
```ts
import { filterTaskSessions, filterProjectSessions } from "./instance-filter";
```

Update the broadcast section (lines 194-210):

```ts
if (task) {
    await taskStore.updateTask(task.id, (currentTask) => ({
        sessions: [...currentTask.sessions, sessionRef],
    }));
    const updatedTask = await taskStore.getTask(task.id);
    if (updatedTask) {
        broadcast({ type: MSG.TASK_UPDATED, payload: filterTaskSessions(updatedTask, config.instanceId) });
    }
} else {
    await taskStore.updateProject(project.id, (currentProject) => ({
        sessions: [...currentProject.sessions, sessionRef],
    }));
    const updatedProject = await taskStore.getProject(project.id);
    if (updatedProject) {
        broadcast({ type: MSG.PROJECT_UPDATED, payload: filterProjectSessions(updatedProject, config.instanceId) });
    }
}
```

- [ ] **Step 2: Run session handler tests**

Run: `cd packages/backend && bun test tests/handlers/session.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/session-lifecycle.ts
git commit -m "fix: filter sessions in session-lifecycle broadcast payloads"
```

---

### Task 5: Filter in title-generator broadcasts

**Files:**
- Modify: `packages/backend/src/services/title-generator.ts:36,69`

The title generator broadcasts `TASK_UPDATED` after updating a task's title (line 69) and after creating a worktree (line 36). Both payloads must be filtered.

- [ ] **Step 1: Add filtering to title-generator broadcasts**

In `packages/backend/src/services/title-generator.ts`:

Add import at top:
```ts
import { filterTaskSessions } from "./instance-filter";
import { config } from "../config";
```

Update the broadcast at line 36 (inside `createWorktreeForTask`):
```ts
broadcast({ type: MSG.TASK_UPDATED, payload: filterTaskSessions(updated, config.instanceId) });
```

Update the broadcast at line 69 (inside `generate`):
```ts
broadcast({ type: MSG.TASK_UPDATED, payload: filterTaskSessions(updated, config.instanceId) });
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/services/title-generator.ts
git commit -m "fix: filter sessions in title-generator broadcast payloads"
```

---

### Task 6: Filter in API route responses

**Files:**
- Modify: `packages/backend/src/api/routes.ts:54-89` (PATCH /api/tasks/:taskId)
- Modify: `packages/backend/src/api/routes.ts:91-155` (PATCH /api/tasks/:taskId/worktree)
- Modify: `packages/backend/src/api/routes.ts:157-169` (GET /api/tasks/:taskId)
- Modify: `packages/backend/src/api/routes.ts:278-286` (GET /api/projects/:projectId/tasks)

These API routes are called by taskflow-cli (running inside agent sessions). While agents always talk to their own instance's backend, filtering here ensures consistency.

- [ ] **Step 1: Add filtering to API routes**

In `packages/backend/src/api/routes.ts`:

Add import at top:
```ts
import { filterTaskSessions } from "../services/instance-filter";
import { config } from "../config";
```

Update PATCH `/api/tasks/:taskId` (line ~79-81):
```ts
const updated = await taskStore.updateTask(params.taskId, updates);
broadcast({ type: MSG.TASK_UPDATED, payload: filterTaskSessions(updated, config.instanceId) });
return jsonResponse(filterTaskSessions(updated, config.instanceId));
```

Update PATCH `/api/tasks/:taskId/worktree` (line ~146-149):
```ts
const updated = await taskStore.updateTask(params.taskId, {
    worktree: { ...task.worktree, enabled: body.enabled },
});
broadcast({ type: MSG.TASK_UPDATED, payload: filterTaskSessions(updated, config.instanceId) });
return jsonResponse(filterTaskSessions(updated, config.instanceId));
```

Update GET `/api/tasks/:taskId` (line ~159-164):
```ts
const task = await taskStore.getTask(params.taskId);
if (!task) {
    return errorResponse(`Task not found: ${params.taskId}`, 404);
}
const log = await taskStore.getTaskLog(params.taskId);
return jsonResponse({ task: filterTaskSessions(task, config.instanceId), log });
```

Update GET `/api/projects/:projectId/tasks` (line ~280):
```ts
const tasks = await taskStore.listTasks(params.projectId);
return jsonResponse({ tasks: tasks.map((t) => filterTaskSessions(t, config.instanceId)) });
```

- [ ] **Step 2: Run API route tests**

Run: `cd packages/backend && bun test tests/api/routes.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/api/routes.ts
git commit -m "fix: filter sessions by instance in API route responses and broadcasts"
```

---

### Task 7: Run full test suite

- [ ] **Step 1: Run all backend tests**

Run: `cd packages/backend && bun test`
Expected: All tests PASS

- [ ] **Step 2: Run type check**

Run: `cd packages/backend && bun run tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run lint**

Run: `cd packages/backend && bun run lint`
Expected: No lint errors (or only pre-existing ones)
