# Task and Project Attributes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tasks and projects a list of named string attributes, editable in the task info panel and readable/writable by agents through `taskflow-cli`.

**Architecture:** An `Attribute` is `{ id, name, value }` stored inline on the existing `Task` and `Project` JSON records. A single pure resolver in `@taskflow/shared` merges three layers — project → parent task → task — with higher layers shadowing lower ones by name. `TaskStore` gains six granular mutation methods so a UI edit and a concurrent agent write cannot clobber each other. New WS handlers serve the UI, new HTTP routes serve the CLI, and both broadcast the existing `TASK_UPDATED` / `PROJECT_UPDATED` events.

**Tech Stack:** TypeScript, Bun (runtime, test runner, package manager), React 19 + Zustand (UI), Tailwind (styling).

**Spec:** `docs/superpowers/specs/2026-07-22-task-project-attributes-design.md`

## Global Constraints

- Use `bun`, never `npm` or `yarn`. Tests run with `bun test` from the repo root.
- No `as any`. Pursue proper types. `as never` is used in existing test fixtures and is acceptable there.
- Do not export a symbol until something outside its module uses it.
- Do not disable eslint rules.
- Do not add `Co-Authored-By` trailers to commits.
- Attribute names are trimmed before storage, must be non-empty, and must be unique within their own list. Uniqueness is checked against the target list alone — a task attribute may reuse a project attribute's name, which is how shadowing is authored.
- Layer precedence, lowest to highest: `project` → `parent` → `task`. A shadowed attribute never appears in resolved output.
- Verify each task with `bun test`, `bun run lint`, and `bun run typecheck` before committing.

---

## File Structure

**Create:**

| Path | Responsibility |
| --- | --- |
| `packages/shared/src/types/attribute.ts` | `Attribute`, `AttributeScope`, `ResolvedAttribute`, `AttributeLayer` |
| `packages/shared/src/utils/attributes.ts` | `resolveAttributes`, `normalizeAttributeName`, `hasNameConflict` |
| `packages/shared/tests/attributes.test.ts` | resolver + validation unit tests |
| `packages/backend/src/services/attribute-mutations.ts` | pure `Attribute[]` create/update/delete producing new arrays or throwing |
| `packages/backend/tests/services/attribute-mutations.test.ts` | tests for the above |
| `packages/backend/tests/services/attribute-store.test.ts` | `TaskStore` attribute method tests |
| `packages/backend/src/handlers/attribute.ts` | WS handlers for `attr:create` / `attr:update` / `attr:delete` |
| `packages/backend/tests/handlers/attribute.test.ts` | WS handler tests |
| `packages/backend/src/api/routes/attribute-routes.ts` | HTTP routes under `/api/tasks/:id/attributes` and `/api/projects/:id/attributes` |
| `packages/backend/tests/api/attribute-routes.test.ts` | HTTP route tests |
| `packages/backend/src/services/taskflow-cli-attribute-commands.md` | agent-facing CLI docs |
| `packages/ui/src/lib/attribute-api.ts` | thin WS calls the UI section uses |
| `packages/ui/src/components/panels/AttributesSection.tsx` | the editable + inherited attribute UI, shared by both info-panel views |

**Modify:**

| Path | Change |
| --- | --- |
| `packages/shared/src/types/task.ts` | add `attributes: Attribute[]` to `Task` |
| `packages/shared/src/types/project.ts` | add `attributes: Attribute[]` to `Project` |
| `packages/shared/src/types/ws.ts` | add three attribute payload interfaces |
| `packages/shared/src/constants.ts` | add three `MSG` entries |
| `packages/shared/src/index.ts` | export the new type and util modules |
| `packages/backend/src/services/task-store.ts` | normalize `attributes` on read; add six mutation methods |
| `packages/backend/src/api/routes.ts` | register attribute routes |
| `packages/backend/src/index.ts` | register attribute WS handlers |
| `packages/backend/src/services/taskflow-cli-bin.ts` | add `handleAttr` and dispatch |
| `packages/backend/src/services/internal-agent-skill.ts` | import + register the new command doc |
| `packages/backend/src/services/taskflow-cli-skill.md` | reference the new command doc |
| `packages/ui/src/components/panels/TaskInfoPanel.tsx` | render `AttributesSection` in both views |

---

## Task 1: Shared types and the resolver

**Files:**

- Create: `packages/shared/src/types/attribute.ts`
- Create: `packages/shared/src/utils/attributes.ts`
- Create: `packages/shared/tests/attributes.test.ts`
- Modify: `packages/shared/src/types/task.ts`
- Modify: `packages/shared/src/types/project.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
    - `interface Attribute { id: string; name: string; value: string }`
    - `type AttributeScope = "project" | "parent" | "task"`
    - `interface ResolvedAttribute extends Attribute { scope: AttributeScope }`
    - `interface AttributeLayer { scope: AttributeScope; attributes: Attribute[] }`
    - `function resolveAttributes(layers: AttributeLayer[]): ResolvedAttribute[]`
    - `function normalizeAttributeName(name: string): string`
    - `function hasNameConflict(list: Attribute[], name: string, ignoreId?: string): boolean`
    - `Task.attributes: Attribute[]`, `Project.attributes: Attribute[]`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/attributes.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
    hasNameConflict,
    normalizeAttributeName,
    resolveAttributes,
} from "../src/utils/attributes";
import type { Attribute } from "../src/types/attribute";

function attr(id: string, name: string, value: string): Attribute {
    return { id, name, value };
}

describe("normalizeAttributeName", () => {
    it("trims surrounding whitespace", () => {
        expect(normalizeAttributeName("  env  ")).toBe("env");
    });

    it("collapses a whitespace-only name to empty", () => {
        expect(normalizeAttributeName("   ")).toBe("");
    });
});

describe("hasNameConflict", () => {
    const list = [attr("a", "env", "prod"), attr("b", "ticket", "T-1")];

    it("reports a conflict for a duplicate name", () => {
        expect(hasNameConflict(list, "env")).toBe(true);
    });

    it("reports no conflict for a fresh name", () => {
        expect(hasNameConflict(list, "region")).toBe(false);
    });

    it("ignores the attribute being renamed", () => {
        expect(hasNameConflict(list, "env", "a")).toBe(false);
    });

    it("compares against the trimmed name", () => {
        expect(hasNameConflict(list, "  env  ")).toBe(true);
    });
});

describe("resolveAttributes", () => {
    it("returns an empty list for no layers", () => {
        expect(resolveAttributes([])).toEqual([]);
    });

    it("merges two layers and tags each with its scope", () => {
        const resolved = resolveAttributes([
            { scope: "project", attributes: [attr("p1", "env", "prod")] },
            { scope: "task", attributes: [attr("t1", "ticket", "T-9")] },
        ]);
        expect(resolved).toEqual([
            { id: "p1", name: "env", value: "prod", scope: "project" },
            { id: "t1", name: "ticket", value: "T-9", scope: "task" },
        ]);
    });

    it("drops a shadowed lower-layer attribute entirely", () => {
        const resolved = resolveAttributes([
            { scope: "project", attributes: [attr("p1", "env", "prod")] },
            { scope: "task", attributes: [attr("t1", "env", "dev")] },
        ]);
        expect(resolved).toEqual([{ id: "t1", name: "env", value: "dev", scope: "task" }]);
    });

    it("resolves three layers with the highest winning", () => {
        const resolved = resolveAttributes([
            { scope: "project", attributes: [attr("p1", "env", "prod"), attr("p2", "team", "core")] },
            { scope: "parent", attributes: [attr("n1", "env", "staging")] },
            { scope: "task", attributes: [attr("t1", "env", "dev")] },
        ]);
        expect(resolved).toEqual([
            { id: "p2", name: "team", value: "core", scope: "project" },
            { id: "t1", name: "env", value: "dev", scope: "task" },
        ]);
    });

    it("lets a middle layer shadow the bottom layer", () => {
        const resolved = resolveAttributes([
            { scope: "project", attributes: [attr("p1", "env", "prod")] },
            { scope: "parent", attributes: [attr("n1", "env", "staging")] },
            { scope: "task", attributes: [] },
        ]);
        expect(resolved).toEqual([{ id: "n1", name: "env", value: "staging", scope: "parent" }]);
    });

    it("preserves insertion order within a layer", () => {
        const resolved = resolveAttributes([
            {
                scope: "project",
                attributes: [attr("p1", "z", "1"), attr("p2", "a", "2"), attr("p3", "m", "3")],
            },
        ]);
        expect(resolved.map((a) => a.name)).toEqual(["z", "a", "m"]);
    });

    it("skips empty layers without affecting order", () => {
        const resolved = resolveAttributes([
            { scope: "project", attributes: [] },
            { scope: "parent", attributes: [attr("n1", "env", "staging")] },
            { scope: "task", attributes: [] },
        ]);
        expect(resolved).toEqual([{ id: "n1", name: "env", value: "staging", scope: "parent" }]);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/shared/tests/attributes.test.ts`
Expected: FAIL — the module `../src/utils/attributes` cannot be resolved.

- [ ] **Step 3: Create the type module**

Create `packages/shared/src/types/attribute.ts`:

```ts
export interface Attribute {
    id: string;
    name: string;
    value: string;
}

export type AttributeScope = "project" | "parent" | "task";

export interface ResolvedAttribute extends Attribute {
    scope: AttributeScope;
}

export interface AttributeLayer {
    scope: AttributeScope;
    attributes: Attribute[];
}
```

- [ ] **Step 4: Create the resolver module**

Create `packages/shared/src/utils/attributes.ts`:

```ts
import type { Attribute, AttributeLayer, ResolvedAttribute } from "../types/attribute";

function normalizeAttributeName(name: string): string {
    return name.trim();
}

function hasNameConflict(list: Attribute[], name: string, ignoreId?: string): boolean {
    const normalized = normalizeAttributeName(name);
    return list.some((a) => a.id !== ignoreId && a.name === normalized);
}

/**
 * Merge attribute layers, lowest precedence first. A name defined in a higher
 * layer shadows the same name in every lower layer, and the shadowed entry is
 * omitted from the result entirely.
 */
function resolveAttributes(layers: AttributeLayer[]): ResolvedAttribute[] {
    const winners = new Map<string, ResolvedAttribute>();
    for (const layer of layers) {
        for (const attribute of layer.attributes) {
            winners.set(attribute.name, { ...attribute, scope: layer.scope });
        }
    }

    const resolved: ResolvedAttribute[] = [];
    for (const layer of layers) {
        for (const attribute of layer.attributes) {
            const winner = winners.get(attribute.name);
            if (winner && winner.id === attribute.id) {
                resolved.push(winner);
            }
        }
    }
    return resolved;
}

export { hasNameConflict, normalizeAttributeName, resolveAttributes };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test packages/shared/tests/attributes.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 6: Add `attributes` to `Task` and `Project`**

In `packages/shared/src/types/task.ts`, add the import at the top and the field to `Task`:

```ts
import type { Attribute } from "./attribute";
```

```ts
export interface Task {
    id: string;
    projectId: string;
    parentId?: string;
    title: string;
    description: string;
    notes: string;
    worktree: TaskWorktree;
    sessions: SessionRef[];
    attributes: Attribute[];
    createdAt: string;
    status: "active" | "archived";
    archivedAt: string | null;
    pinned: boolean;
    initCommand?: string;
}
```

In `packages/shared/src/types/project.ts`:

```ts
import type { Attribute } from "./attribute";
import type { SessionRef } from "./task";
```

```ts
export interface Project {
    id: string;
    name: string;
    path: string;
    sessions: SessionRef[];
    attributes: Attribute[];
    createdAt: string;
    defaultInitCommand?: string;
    prompt?: string;
    linkedProjects?: LinkedProject[];
    hidden?: boolean;
    locationValid?: boolean;
}
```

- [ ] **Step 7: Export the new modules**

In `packages/shared/src/index.ts`, add alongside the existing exports:

```ts
export * from "./types/attribute";
export * from "./utils/attributes";
```

- [ ] **Step 8: Typecheck**

Run: `bun run typecheck`
Expected: FAIL, with errors in `packages/backend` and `packages/ui` about `attributes` missing from object literals that construct a `Task` or `Project`. This is expected — Task 2 fixes the backend construction sites.

Fix only the shared package's own errors, if any. To confirm shared is clean on its own:

Run: `cd packages/shared && bunx tsc --noEmit`
Expected: PASS with no output.

- [ ] **Step 9: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add Attribute type and layer resolver"
```

---

## Task 2: Store mutations

**Files:**

- Create: `packages/backend/src/services/attribute-mutations.ts`
- Create: `packages/backend/tests/services/attribute-mutations.test.ts`
- Create: `packages/backend/tests/services/attribute-store.test.ts`
- Modify: `packages/backend/src/services/task-store.ts`

**Interfaces:**

- Consumes: `Attribute`, `normalizeAttributeName`, `hasNameConflict` from Task 1.
- Produces:
    - `function addAttribute(list: Attribute[], id: string, name: string, value: string): Attribute[]`
    - `function editAttribute(list: Attribute[], id: string, updates: { name?: string; value?: string }): Attribute[]`
    - `function removeAttribute(list: Attribute[], id: string): Attribute[]`
    - `TaskStore.createTaskAttribute(taskId: string, name: string, value: string): Promise<Task>`
    - `TaskStore.updateTaskAttribute(taskId: string, attrId: string, updates: { name?: string; value?: string }): Promise<Task>`
    - `TaskStore.deleteTaskAttribute(taskId: string, attrId: string): Promise<Task>`
    - `TaskStore.createProjectAttribute(projectId: string, name: string, value: string): Promise<Project>`
    - `TaskStore.updateProjectAttribute(projectId: string, attrId: string, updates: { name?: string; value?: string }): Promise<Project>`
    - `TaskStore.deleteProjectAttribute(projectId: string, attrId: string): Promise<Project>`
    - `TaskStore.resolveTaskAttributeLayers(taskId: string): Promise<AttributeLayer[]>`
    - `TaskStore.resolveProjectAttributeLayers(projectId: string): Promise<AttributeLayer[]>`

All six mutation methods throw `Error` on a missing owner, a missing attribute id, an empty name, or a duplicate name.

- [ ] **Step 1: Write the failing test for the pure mutations**

Create `packages/backend/tests/services/attribute-mutations.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
    addAttribute,
    editAttribute,
    removeAttribute,
} from "../../src/services/attribute-mutations";
import type { Attribute } from "@taskflow/shared";

const base: Attribute[] = [
    { id: "a", name: "env", value: "prod" },
    { id: "b", name: "ticket", value: "T-1" },
];

describe("addAttribute", () => {
    it("appends a new attribute without mutating the input", () => {
        const next = addAttribute(base, "c", "region", "eu");
        expect(next).toHaveLength(3);
        expect(next[2]).toEqual({ id: "c", name: "region", value: "eu" });
        expect(base).toHaveLength(2);
    });

    it("trims the name", () => {
        const next = addAttribute(base, "c", "  region  ", "eu");
        expect(next[2].name).toBe("region");
    });

    it("rejects an empty name", () => {
        expect(() => addAttribute(base, "c", "   ", "eu")).toThrow(
            "Attribute name cannot be empty",
        );
    });

    it("rejects a duplicate name", () => {
        expect(() => addAttribute(base, "c", "env", "dev")).toThrow(
            'Attribute name already exists: "env"',
        );
    });
});

describe("editAttribute", () => {
    it("changes the value", () => {
        const next = editAttribute(base, "a", { value: "staging" });
        expect(next[0]).toEqual({ id: "a", name: "env", value: "staging" });
    });

    it("changes the name", () => {
        const next = editAttribute(base, "a", { name: "environment" });
        expect(next[0].name).toBe("environment");
    });

    it("allows renaming an attribute to its own current name", () => {
        const next = editAttribute(base, "a", { name: "env" });
        expect(next[0].name).toBe("env");
    });

    it("rejects renaming onto a sibling's name", () => {
        expect(() => editAttribute(base, "a", { name: "ticket" })).toThrow(
            'Attribute name already exists: "ticket"',
        );
    });

    it("rejects an unknown id", () => {
        expect(() => editAttribute(base, "zzz", { value: "x" })).toThrow(
            "Attribute not found: zzz",
        );
    });

    it("preserves position", () => {
        const next = editAttribute(base, "a", { value: "staging" });
        expect(next.map((a) => a.id)).toEqual(["a", "b"]);
    });
});

describe("removeAttribute", () => {
    it("removes by id", () => {
        const next = removeAttribute(base, "a");
        expect(next.map((a) => a.id)).toEqual(["b"]);
    });

    it("rejects an unknown id", () => {
        expect(() => removeAttribute(base, "zzz")).toThrow("Attribute not found: zzz");
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/backend/tests/services/attribute-mutations.test.ts`
Expected: FAIL — cannot resolve `../../src/services/attribute-mutations`.

- [ ] **Step 3: Implement the pure mutations**

Create `packages/backend/src/services/attribute-mutations.ts`:

```ts
import type { Attribute } from "@taskflow/shared";
import { hasNameConflict, normalizeAttributeName } from "@taskflow/shared";

function requireValidName(list: Attribute[], name: string, ignoreId?: string): string {
    const normalized = normalizeAttributeName(name);
    if (!normalized) {
        throw new Error("Attribute name cannot be empty");
    }
    if (hasNameConflict(list, normalized, ignoreId)) {
        throw new Error(`Attribute name already exists: "${normalized}"`);
    }
    return normalized;
}

function addAttribute(list: Attribute[], id: string, name: string, value: string): Attribute[] {
    const normalized = requireValidName(list, name);
    return [...list, { id, name: normalized, value }];
}

function editAttribute(
    list: Attribute[],
    id: string,
    updates: { name?: string; value?: string },
): Attribute[] {
    const index = list.findIndex((a) => a.id === id);
    if (index === -1) {
        throw new Error(`Attribute not found: ${id}`);
    }
    const current = list[index];
    const name = updates.name === undefined ? current.name : requireValidName(list, updates.name, id);
    const value = updates.value === undefined ? current.value : updates.value;
    const next = [...list];
    next[index] = { id, name, value };
    return next;
}

function removeAttribute(list: Attribute[], id: string): Attribute[] {
    if (!list.some((a) => a.id === id)) {
        throw new Error(`Attribute not found: ${id}`);
    }
    return list.filter((a) => a.id !== id);
}

export { addAttribute, editAttribute, removeAttribute };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/backend/tests/services/attribute-mutations.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Write the failing test for the store methods**

Create `packages/backend/tests/services/attribute-store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { TaskStore } from "../../src/services/task-store";

describe("TaskStore attributes", () => {
    let tempDir: string;
    let store: TaskStore;
    let projectId: string;
    let projectPath: string;

    beforeEach(async () => {
        tempDir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-attr-")));
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
        projectPath = join(tempDir, "repo");
        await mkdir(projectPath, { recursive: true });
        const project = await store.addProject({ path: projectPath });
        projectId = project.id;
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("starts a new task with an empty attribute list", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        expect(task.attributes).toEqual([]);
    });

    it("starts a new project with an empty attribute list", async () => {
        const project = await store.getProject(projectId);
        expect(project?.attributes).toEqual([]);
    });

    it("defaults attributes to [] when reading a legacy task record", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        const raw = { ...task } as Record<string, unknown>;
        delete raw.attributes;
        await writeFile(join(tempDir, "tasks", `${task.id}.json`), JSON.stringify(raw), "utf-8");

        const reread = await store.getTask(task.id);
        expect(reread?.attributes).toEqual([]);
    });

    it("defaults attributes to [] when reading a legacy project record", async () => {
        await writeFile(
            join(tempDir, "projects.json"),
            JSON.stringify([
                {
                    id: projectId,
                    name: "repo",
                    path: projectPath,
                    sessions: [],
                    createdAt: new Date(0).toISOString(),
                },
            ]),
            "utf-8",
        );

        const project = await store.getProject(projectId);
        expect(project?.attributes).toEqual([]);
    });

    it("creates, renames, sets and deletes a task attribute", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });

        const created = await store.createTaskAttribute(task.id, "  env  ", "dev");
        expect(created.attributes).toHaveLength(1);
        expect(created.attributes[0].name).toBe("env");
        expect(created.attributes[0].value).toBe("dev");
        const attrId = created.attributes[0].id;

        const renamed = await store.updateTaskAttribute(task.id, attrId, { name: "environment" });
        expect(renamed.attributes[0].name).toBe("environment");

        const valued = await store.updateTaskAttribute(task.id, attrId, { value: "prod" });
        expect(valued.attributes[0].value).toBe("prod");

        const deleted = await store.deleteTaskAttribute(task.id, attrId);
        expect(deleted.attributes).toEqual([]);
    });

    it("persists task attributes across reads", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        await store.createTaskAttribute(task.id, "env", "dev");

        const reread = await store.getTask(task.id);
        expect(reread?.attributes[0]).toMatchObject({ name: "env", value: "dev" });
    });

    it("creates, renames, sets and deletes a project attribute", async () => {
        const created = await store.createProjectAttribute(projectId, "team", "core");
        const attrId = created.attributes[0].id;

        const renamed = await store.updateProjectAttribute(projectId, attrId, { name: "squad" });
        expect(renamed.attributes[0].name).toBe("squad");

        const valued = await store.updateProjectAttribute(projectId, attrId, { value: "infra" });
        expect(valued.attributes[0].value).toBe("infra");

        const deleted = await store.deleteProjectAttribute(projectId, attrId);
        expect(deleted.attributes).toEqual([]);
    });

    it("rejects a duplicate name within one task", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        await store.createTaskAttribute(task.id, "env", "dev");

        await expect(store.createTaskAttribute(task.id, "env", "prod")).rejects.toThrow(
            'Attribute name already exists: "env"',
        );
    });

    it("accepts the same name on a task and its project", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        await store.createProjectAttribute(projectId, "env", "prod");
        const updated = await store.createTaskAttribute(task.id, "env", "dev");

        expect(updated.attributes[0].value).toBe("dev");
    });

    it("rejects an unknown task", async () => {
        await expect(store.createTaskAttribute("missing", "env", "dev")).rejects.toThrow(
            "Task not found: missing",
        );
    });

    it("rejects an unknown project", async () => {
        await expect(store.createProjectAttribute("missing", "env", "dev")).rejects.toThrow(
            "Project not found: missing",
        );
    });

    it("keeps both attributes when two project creates race", async () => {
        await Promise.all([
            store.createProjectAttribute(projectId, "env", "prod"),
            store.createProjectAttribute(projectId, "team", "core"),
        ]);

        const project = await store.getProject(projectId);
        expect(project?.attributes.map((a) => a.name).sort()).toEqual(["env", "team"]);
    });

    it("keeps both attributes when two task creates race", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        await Promise.all([
            store.createTaskAttribute(task.id, "env", "prod"),
            store.createTaskAttribute(task.id, "team", "core"),
        ]);

        const reread = await store.getTask(task.id);
        expect(reread?.attributes.map((a) => a.name).sort()).toEqual(["env", "team"]);
    });

    it("resolves project and task layers for a top-level task", async () => {
        const task = await store.createTask({ projectId, title: "T", description: "" });
        await store.createProjectAttribute(projectId, "env", "prod");
        await store.createTaskAttribute(task.id, "ticket", "T-9");

        const layers = await store.resolveTaskAttributeLayers(task.id);
        expect(layers.map((l) => l.scope)).toEqual(["project", "task"]);
        expect(layers[0].attributes[0].name).toBe("env");
        expect(layers[1].attributes[0].name).toBe("ticket");
    });

    it("resolves three layers for a subtask", async () => {
        const parent = await store.createTask({ projectId, title: "P", description: "" });
        const child = await store.createTask({
            projectId,
            parentId: parent.id,
            title: "C",
            description: "",
        });
        await store.createProjectAttribute(projectId, "env", "prod");
        await store.createTaskAttribute(parent.id, "env", "staging");
        await store.createTaskAttribute(child.id, "env", "dev");

        const layers = await store.resolveTaskAttributeLayers(child.id);
        expect(layers.map((l) => l.scope)).toEqual(["project", "parent", "task"]);
        expect(layers[1].attributes[0].value).toBe("staging");
    });

    it("resolves a single layer for a project", async () => {
        await store.createProjectAttribute(projectId, "env", "prod");
        const layers = await store.resolveProjectAttributeLayers(projectId);
        expect(layers.map((l) => l.scope)).toEqual(["project"]);
    });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `bun test packages/backend/tests/services/attribute-store.test.ts`
Expected: FAIL — `store.createTaskAttribute is not a function`, plus assertion failures on `attributes` being `undefined`.

- [ ] **Step 7: Normalize `attributes` on read**

In `packages/backend/src/services/task-store.ts`, extend the existing normalization in `readTask` (around line 176):

```ts
            const task = JSON.parse(data) as Task;
            return {
                ...task,
                pinned: task.pinned ?? false,
                attributes: task.attributes ?? [],
                worktree: { ...task.worktree, pr: task.worktree.pr ?? null },
            };
```

Find `listProjects` in the same file and normalize each project the same way. The method parses `projectsFile` and returns `Project[]`; map the parsed array through:

```ts
            .map((project) => ({ ...project, attributes: project.attributes ?? [] }))
```

Apply it to the parsed list before any ordering or filtering already present, so every downstream consumer sees a normalized value.

- [ ] **Step 8: Set `attributes` on creation**

In `createTask`, add the field to the constructed `Task` literal, immediately after `sessions: []`:

```ts
            sessions: [],
            attributes: [],
```

In `addProject`, add the same field to the constructed `Project` literal, immediately after `sessions: []`:

```ts
            sessions: [],
            attributes: [],
```

- [ ] **Step 9: Add the store methods**

Add the import at the top of `packages/backend/src/services/task-store.ts`:

```ts
import type { Attribute, AttributeLayer } from "@taskflow/shared";
import { addAttribute, editAttribute, removeAttribute } from "./attribute-mutations";
```

Merge `Attribute` and `AttributeLayer` into the existing `import type { ... } from "@taskflow/shared"` block rather than adding a second one.

Add these methods to the `TaskStore` class, after `updateTask`:

```ts
    private async mutateTaskAttributes(
        taskId: string,
        mutate: (list: Attribute[]) => Attribute[],
    ): Promise<Task> {
        return this.withTaskMutation(taskId, async () => {
            const task = await this.readTask(this.taskPath(taskId));
            if (!task) throw new Error(`Task not found: ${taskId}`);
            const updated: Task = { ...task, attributes: mutate(task.attributes) };
            await this.writeTask(this.taskPath(taskId), updated);
            return updated;
        });
    }

    async createTaskAttribute(taskId: string, name: string, value: string): Promise<Task> {
        const id = randomUUID();
        return this.mutateTaskAttributes(taskId, (list) => addAttribute(list, id, name, value));
    }

    async updateTaskAttribute(
        taskId: string,
        attrId: string,
        updates: { name?: string; value?: string },
    ): Promise<Task> {
        return this.mutateTaskAttributes(taskId, (list) => editAttribute(list, attrId, updates));
    }

    async deleteTaskAttribute(taskId: string, attrId: string): Promise<Task> {
        return this.mutateTaskAttributes(taskId, (list) => removeAttribute(list, attrId));
    }

    private async mutateProjectAttributes(
        projectId: string,
        mutate: (list: Attribute[]) => Attribute[],
    ): Promise<Project> {
        // The function form reads inside updateProject's own read-modify-write,
        // which Step 9a makes atomic. Reading separately here would reintroduce
        // the lost-update race.
        return this.updateProject(projectId, (project) => ({
            attributes: mutate(project.attributes),
        }));
    }

    async createProjectAttribute(projectId: string, name: string, value: string): Promise<Project> {
        const id = randomUUID();
        return this.mutateProjectAttributes(projectId, (list) =>
            addAttribute(list, id, name, value),
        );
    }

    async updateProjectAttribute(
        projectId: string,
        attrId: string,
        updates: { name?: string; value?: string },
    ): Promise<Project> {
        return this.mutateProjectAttributes(projectId, (list) =>
            editAttribute(list, attrId, updates),
        );
    }

    async deleteProjectAttribute(projectId: string, attrId: string): Promise<Project> {
        return this.mutateProjectAttributes(projectId, (list) => removeAttribute(list, attrId));
    }

    async resolveTaskAttributeLayers(taskId: string): Promise<AttributeLayer[]> {
        const task = await this.getTask(taskId);
        if (!task) throw new Error(`Task not found: ${taskId}`);
        const project = await this.getProject(task.projectId);
        const layers: AttributeLayer[] = [
            { scope: "project", attributes: project?.attributes ?? [] },
        ];
        if (task.parentId) {
            const parent = await this.getTask(task.parentId);
            layers.push({ scope: "parent", attributes: parent?.attributes ?? [] });
        }
        layers.push({ scope: "task", attributes: task.attributes });
        return layers;
    }

    async resolveProjectAttributeLayers(projectId: string): Promise<AttributeLayer[]> {
        const project = await this.getProject(projectId);
        if (!project) throw new Error(`Project not found: ${projectId}`);
        return [{ scope: "project", attributes: project.attributes }];
    }
```

- [ ] **Step 9a: Serialize `updateProject`'s read-modify-write**

`updateProject` currently reads the whole projects file, mutates one entry, and writes it back with no lock (`packages/backend/src/services/task-store.ts:289`). Two concurrent attribute creates would both read the same `attributes` array and the second write would silently drop the first. Task mutations are already safe via `withTaskMutation`; projects need the equivalent.

Add the lock field beside the existing mutation maps near the top of the class:

```ts
    private projectsMutation: Promise<unknown> = Promise.resolve();
```

Add the helper next to `withTaskMutation`:

```ts
    /**
     * Serializes read-modify-write cycles over the single projects file. Not
     * reentrant — never call a locked method from inside another one.
     */
    private withProjectsMutation<T>(mutation: () => Promise<T>): Promise<T> {
        const run = this.projectsMutation.then(mutation, mutation);
        this.projectsMutation = run.catch(() => undefined);
        return run;
    }
```

Then wrap the **entire existing body** of `updateProject` in it. The method currently opens with `const projects = await this.listProjects();`; change it to:

```ts
    ): Promise<Project> {
        return this.withProjectsMutation(async () => {
            const projects = await this.listProjects();
            // ...the existing body, unchanged, indented one level...
        });
    }
```

Indent the existing body one level and leave every statement in it alone, including the trailing `locationValid` re-validation and the `return`.

Do **not** wrap `addProject`. The lock is not reentrant and `addProject` calls `this.updateProject(duplicate.id, { hidden: false })` on the duplicate-path branch, which would deadlock. `addProject` racing `updateProject` remains possible; that is a pre-existing hazard this feature does not introduce and does not widen.

- [ ] **Step 10: Allow `attributes` through `updateProject`**

`updateProject`'s `updates` parameter is a `Partial<Pick<Project, ...>>` union with a function form. Add `"attributes"` to **both** `Pick` lists so `mutateProjectAttributes` typechecks:

```ts
    async updateProject(
        id: string,
        updates:
            | Partial<
                  Pick<
                      Project,
                      | "name"
                      | "path"
                      | "sessions"
                      | "hidden"
                      | "defaultInitCommand"
                      | "prompt"
                      | "linkedProjects"
                      | "attributes"
                  >
              >
            | ((
                  project: Project,
              ) => Partial<
                  Pick<
                      Project,
                      | "name"
                      | "path"
                      | "sessions"
                      | "hidden"
                      | "defaultInitCommand"
                      | "prompt"
                      | "linkedProjects"
                      | "attributes"
                  >
              >),
    ): Promise<Project> {
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `bun test packages/backend/tests/services/attribute-store.test.ts`
Expected: PASS — 16 tests. The two race tests are the ones that fail if Step 9a's lock was skipped.

- [ ] **Step 11a: Fix the typed test fixtures that now need `attributes`**

`packages/backend/tsconfig.json` includes `tests`, so `Task` and `Project` object literals in test files must carry the new required field. `packages/backend/tests/services/instance-filter.test.ts` has two.

In `baseTask` (around line 17), add the field after `sessions: []`:

```ts
        sessions: [],
        attributes: [],
```

In `baseProject` (around line 76), add the same after `sessions: []`:

```ts
        sessions: [],
        attributes: [],
```

Then find any others:

Run: `bun run typecheck 2>&1 | grep -i "attributes"`
Expected: no output once every literal is fixed. Add `attributes: []` at each site the command reports.

- [ ] **Step 12: Full verification**

Run: `bun test`
Expected: PASS.

Run: `bun run typecheck`
Expected: PASS for `packages/shared` and `packages/backend`. `packages/ui` is untouched so far and does not construct `Task` or `Project` literals; if it reports an error, note it and fix it in Task 6.

Run: `bun run lint`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add packages/backend/src/services packages/backend/tests/services
git commit -m "feat(backend): add attribute mutations to TaskStore"
```

---

## Task 3: WebSocket handlers

**Files:**

- Create: `packages/backend/src/handlers/attribute.ts`
- Create: `packages/backend/tests/handlers/attribute.test.ts`
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/types/ws.ts`
- Modify: `packages/backend/src/index.ts`

**Interfaces:**

- Consumes: the six `TaskStore` methods from Task 2; `MSG` from `@taskflow/shared`.
- Produces:
    - `MSG.ATTR_CREATE = "attr:create"`, `MSG.ATTR_UPDATE = "attr:update"`, `MSG.ATTR_DELETE = "attr:delete"`
    - `type AttributeOwner = { taskId: string; projectId?: never } | { projectId: string; taskId?: never }`
    - `type AttrCreatePayload = AttributeOwner & { name: string; value?: string }`
    - `type AttrUpdatePayload = AttributeOwner & { attrId: string; name?: string; value?: string }`
    - `type AttrDeletePayload = AttributeOwner & { attrId: string }`
    - `function registerAttributeHandlers(deps: { router: Router; store: TaskStore; broadcast: (event: WsEvent) => void }): void`

Each handler returns the updated `Task` or `Project` and broadcasts `MSG.TASK_UPDATED` / `MSG.PROJECT_UPDATED`.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/handlers/attribute.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, realpath, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import type { Project, Task, WsEvent } from "@taskflow/shared";
import { Router } from "../../src/ws/router";
import { TaskStore } from "../../src/services/task-store";
import { registerAttributeHandlers } from "../../src/handlers/attribute";

describe("attribute handlers", () => {
    let tempDir: string;
    let store: TaskStore;
    let router: Router;
    let events: WsEvent[];
    let projectId: string;
    let taskId: string;

    beforeEach(async () => {
        tempDir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-attr-ws-")));
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
        router = new Router();
        events = [];
        registerAttributeHandlers({
            router,
            store,
            broadcast: (event) => {
                events.push(event);
            },
        });

        const projectPath = join(tempDir, "repo");
        await mkdir(projectPath, { recursive: true });
        projectId = (await store.addProject({ path: projectPath })).id;
        taskId = (await store.createTask({ projectId, title: "T", description: "" })).id;
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("creates a task attribute and broadcasts TASK_UPDATED", async () => {
        const task = (await router.handle(MSG.ATTR_CREATE, {
            taskId,
            name: "env",
            value: "dev",
        })) as Task;

        expect(task.attributes).toHaveLength(1);
        expect(task.attributes[0]).toMatchObject({ name: "env", value: "dev" });
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe(MSG.TASK_UPDATED);
    });

    it("defaults a missing value to an empty string", async () => {
        const task = (await router.handle(MSG.ATTR_CREATE, { taskId, name: "env" })) as Task;
        expect(task.attributes[0].value).toBe("");
    });

    it("updates a task attribute", async () => {
        const created = (await router.handle(MSG.ATTR_CREATE, { taskId, name: "env" })) as Task;
        const attrId = created.attributes[0].id;

        const updated = (await router.handle(MSG.ATTR_UPDATE, {
            taskId,
            attrId,
            value: "prod",
        })) as Task;

        expect(updated.attributes[0].value).toBe("prod");
    });

    it("deletes a task attribute", async () => {
        const created = (await router.handle(MSG.ATTR_CREATE, { taskId, name: "env" })) as Task;
        const attrId = created.attributes[0].id;

        const updated = (await router.handle(MSG.ATTR_DELETE, { taskId, attrId })) as Task;
        expect(updated.attributes).toEqual([]);
    });

    it("creates a project attribute and broadcasts PROJECT_UPDATED", async () => {
        const project = (await router.handle(MSG.ATTR_CREATE, {
            projectId,
            name: "team",
            value: "core",
        })) as Project;

        expect(project.attributes[0]).toMatchObject({ name: "team", value: "core" });
        expect(events[0].type).toBe(MSG.PROJECT_UPDATED);
    });

    it("rejects a payload naming neither owner", async () => {
        await expect(router.handle(MSG.ATTR_CREATE, { name: "env" })).rejects.toThrow(
            "Attribute owner requires taskId or projectId",
        );
    });

    it("propagates a duplicate-name error", async () => {
        await router.handle(MSG.ATTR_CREATE, { taskId, name: "env" });
        await expect(router.handle(MSG.ATTR_CREATE, { taskId, name: "env" })).rejects.toThrow(
            'Attribute name already exists: "env"',
        );
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/backend/tests/handlers/attribute.test.ts`
Expected: FAIL — cannot resolve `../../src/handlers/attribute`.

- [ ] **Step 3: Add the MSG constants**

In `packages/shared/src/constants.ts`, add a block after the `// Tasks` group:

```ts
    // Attributes
    ATTR_CREATE: "attr:create",
    ATTR_UPDATE: "attr:update",
    ATTR_DELETE: "attr:delete",
```

- [ ] **Step 4: Add the payload types**

In `packages/shared/src/types/ws.ts`, add after the task message block:

```ts
// Attribute messages
export type AttributeOwner =
    | { taskId: string; projectId?: never }
    | { projectId: string; taskId?: never };

export type AttrCreatePayload = AttributeOwner & { name: string; value?: string };

export type AttrUpdatePayload = AttributeOwner & {
    attrId: string;
    name?: string;
    value?: string;
};

export type AttrDeletePayload = AttributeOwner & { attrId: string };
```

- [ ] **Step 5: Implement the handlers**

Create `packages/backend/src/handlers/attribute.ts`:

```ts
import { MSG } from "@taskflow/shared";
import type {
    AttrCreatePayload,
    AttrDeletePayload,
    AttrUpdatePayload,
    Project,
    Task,
    WsEvent,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { TaskStore } from "../services/task-store";
import { filterProjectSessions, filterTaskSessions } from "../services/instance-filter";
import { config } from "../config";

interface AttributeHandlerDeps {
    router: Router;
    store: TaskStore;
    broadcast: (event: WsEvent) => void;
}

interface OwnerRef {
    taskId?: string;
    projectId?: string;
}

function resolveOwner(payload: OwnerRef): { taskId: string } | { projectId: string } {
    if (payload.taskId) return { taskId: payload.taskId };
    if (payload.projectId) return { projectId: payload.projectId };
    throw new Error("Attribute owner requires taskId or projectId");
}

export function registerAttributeHandlers(deps: AttributeHandlerDeps): void {
    const { router, store, broadcast } = deps;

    function publishTask(task: Task): Task {
        const filtered = filterTaskSessions(task, config.instanceId);
        broadcast({ type: MSG.TASK_UPDATED, payload: filtered });
        return filtered;
    }

    function publishProject(project: Project): Project {
        const filtered = filterProjectSessions(project, config.instanceId);
        broadcast({ type: MSG.PROJECT_UPDATED, payload: filtered });
        return filtered;
    }

    router.register(MSG.ATTR_CREATE, async (payload) => {
        const { name, value } = payload as AttrCreatePayload;
        const owner = resolveOwner(payload as OwnerRef);
        if ("taskId" in owner) {
            return publishTask(await store.createTaskAttribute(owner.taskId, name, value ?? ""));
        }
        return publishProject(
            await store.createProjectAttribute(owner.projectId, name, value ?? ""),
        );
    });

    router.register(MSG.ATTR_UPDATE, async (payload) => {
        const { attrId, name, value } = payload as AttrUpdatePayload;
        const owner = resolveOwner(payload as OwnerRef);
        const updates = { name, value };
        if ("taskId" in owner) {
            return publishTask(await store.updateTaskAttribute(owner.taskId, attrId, updates));
        }
        return publishProject(
            await store.updateProjectAttribute(owner.projectId, attrId, updates),
        );
    });

    router.register(MSG.ATTR_DELETE, async (payload) => {
        const { attrId } = payload as AttrDeletePayload;
        const owner = resolveOwner(payload as OwnerRef);
        if ("taskId" in owner) {
            return publishTask(await store.deleteTaskAttribute(owner.taskId, attrId));
        }
        return publishProject(await store.deleteProjectAttribute(owner.projectId, attrId));
    });
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test packages/backend/tests/handlers/attribute.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 7: Wire the handlers into the server**

In `packages/backend/src/index.ts`, add the import next to the other handler imports (near line 21):

```ts
import { registerAttributeHandlers } from "./handlers/attribute";
```

And register it immediately after the `registerTaskHandlers({ ... });` call:

```ts
        registerAttributeHandlers({ router, store, broadcast: server.broadcast });
```

- [ ] **Step 8: Verify**

Run: `bun test`
Expected: PASS.

Run: `bun run lint && bun run typecheck`
Expected: PASS for `packages/shared` and `packages/backend`.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src packages/backend/src packages/backend/tests
git commit -m "feat(backend): add attribute websocket handlers"
```

---

## Task 4: HTTP routes

**Files:**

- Create: `packages/backend/src/api/routes/attribute-routes.ts`
- Create: `packages/backend/tests/api/attribute-routes.test.ts`
- Modify: `packages/backend/src/api/routes.ts`

**Interfaces:**

- Consumes: the `TaskStore` methods from Task 2; `resolveAttributes` from Task 1; `jsonResponse` / `errorResponse` from `./response-helpers`.
- Produces: `function registerAttributeRoutes(deps: AttributeRouteDeps): void`, where `AttributeRouteDeps` is `{ apiRouter: ApiRouter; taskStore: TaskStore; broadcast: (event: WsEvent) => void }` — a structural subset of the existing `ApiRouteDeps`, so `registerApiRoutes` can pass `deps` straight through.

Routes, registered for both `tasks` and `projects`:

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| `GET` | `/api/tasks/:taskId/attributes` | `?own=1` | `{ attributes: ResolvedAttribute[] }` |
| `GET` | `/api/tasks/:taskId/attributes/:attrId` | — | `{ attribute: ResolvedAttribute }` |
| `POST` | `/api/tasks/:taskId/attributes` | `{ name, value? }` | the updated `Task` |
| `PATCH` | `/api/tasks/:taskId/attributes/:attrId` | `{ name?, value? }` | the updated `Task` |
| `DELETE` | `/api/tasks/:taskId/attributes/:attrId` | — | the updated `Task` |

Project routes are identical with `projectId` and return the updated `Project`.

`GET` with `?own=1` returns only the owner's own list, each entry still carrying its scope. Without it, the resolved (post-shadowing) view is returned. `GET /attributes/:attrId` searches the resolved layers and returns a `404` if the id is in no layer — a shadowed attribute is still found by direct id lookup.

`PATCH` and `DELETE` are own-list only. If the id belongs to an inherited layer, the route returns `400` with a message naming the owning scope and the flag needed to reach it, rather than the generic "Attribute not found" the store would produce.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/api/attribute-routes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, realpath, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { Attribute, Project, ResolvedAttribute, Task, WsEvent } from "@taskflow/shared";
import { ApiRouter } from "../../src/api/router";
import { TaskStore } from "../../src/services/task-store";
import { registerAttributeRoutes } from "../../src/api/routes/attribute-routes";

const BASE = "http://localhost";

describe("attribute routes", () => {
    let tempDir: string;
    let store: TaskStore;
    let apiRouter: ApiRouter;
    let events: WsEvent[];
    let projectId: string;
    let taskId: string;

    async function call(method: string, path: string, body?: unknown): Promise<Response> {
        const req = new Request(`${BASE}${path}`, {
            method,
            ...(body === undefined
                ? {}
                : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
        });
        const res = await apiRouter.handle(req);
        if (!res) throw new Error(`No route matched ${method} ${path}`);
        return res;
    }

    beforeEach(async () => {
        tempDir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-attr-api-")));
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
        apiRouter = new ApiRouter();
        events = [];
        registerAttributeRoutes({
            apiRouter,
            taskStore: store,
            broadcast: (event) => {
                events.push(event);
            },
        });

        const projectPath = join(tempDir, "repo");
        await mkdir(projectPath, { recursive: true });
        projectId = (await store.addProject({ path: projectPath })).id;
        taskId = (await store.createTask({ projectId, title: "T", description: "" })).id;
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("creates a task attribute and broadcasts", async () => {
        const res = await call("POST", `/api/tasks/${taskId}/attributes`, {
            name: "env",
            value: "dev",
        });
        expect(res.status).toBe(200);

        const task = (await res.json()) as Task;
        expect(task.attributes[0]).toMatchObject({ name: "env", value: "dev" });
        expect(events).toHaveLength(1);
    });

    it("rejects a create with a missing name", async () => {
        const res = await call("POST", `/api/tasks/${taskId}/attributes`, { value: "dev" });
        expect(res.status).toBe(400);
    });

    it("rejects a create with a duplicate name", async () => {
        await call("POST", `/api/tasks/${taskId}/attributes`, { name: "env" });
        const res = await call("POST", `/api/tasks/${taskId}/attributes`, { name: "env" });
        expect(res.status).toBe(400);
    });

    it("returns 404 for an unknown task", async () => {
        const res = await call("POST", `/api/tasks/missing/attributes`, { name: "env" });
        expect(res.status).toBe(404);
    });

    it("returns the resolved view with shadowed entries omitted", async () => {
        await store.createProjectAttribute(projectId, "env", "prod");
        await store.createProjectAttribute(projectId, "team", "core");
        await store.createTaskAttribute(taskId, "env", "dev");

        const res = await call("GET", `/api/tasks/${taskId}/attributes`);
        const { attributes } = (await res.json()) as { attributes: ResolvedAttribute[] };

        expect(attributes).toEqual([
            expect.objectContaining({ name: "team", value: "core", scope: "project" }),
            expect.objectContaining({ name: "env", value: "dev", scope: "task" }),
        ]);
    });

    it("returns only the task's own attributes with ?own=1", async () => {
        await store.createProjectAttribute(projectId, "team", "core");
        await store.createTaskAttribute(taskId, "env", "dev");

        const res = await call("GET", `/api/tasks/${taskId}/attributes?own=1`);
        const { attributes } = (await res.json()) as { attributes: ResolvedAttribute[] };

        expect(attributes).toEqual([
            expect.objectContaining({ name: "env", value: "dev", scope: "task" }),
        ]);
    });

    it("gets an inherited attribute by id from task context", async () => {
        const project = await store.createProjectAttribute(projectId, "team", "core");
        const attrId = project.attributes[0].id;

        const res = await call("GET", `/api/tasks/${taskId}/attributes/${attrId}`);
        const { attribute } = (await res.json()) as { attribute: ResolvedAttribute };

        expect(attribute).toMatchObject({ name: "team", scope: "project" });
    });

    it("gets a shadowed attribute by id even though the list omits it", async () => {
        const project = await store.createProjectAttribute(projectId, "env", "prod");
        const shadowedId = project.attributes[0].id;
        await store.createTaskAttribute(taskId, "env", "dev");

        const res = await call("GET", `/api/tasks/${taskId}/attributes/${shadowedId}`);
        const { attribute } = (await res.json()) as { attribute: ResolvedAttribute };

        expect(attribute).toMatchObject({ value: "prod", scope: "project" });
    });

    it("returns 404 for an unknown attribute id", async () => {
        const res = await call("GET", `/api/tasks/${taskId}/attributes/nope`);
        expect(res.status).toBe(404);
    });

    it("patches a task attribute", async () => {
        const created = await store.createTaskAttribute(taskId, "env", "dev");
        const attrId = created.attributes[0].id;

        const res = await call("PATCH", `/api/tasks/${taskId}/attributes/${attrId}`, {
            value: "prod",
        });
        const task = (await res.json()) as Task;

        expect(task.attributes[0].value).toBe("prod");
    });

    it("rejects a patch with no recognised field", async () => {
        const created = await store.createTaskAttribute(taskId, "env", "dev");
        const attrId = created.attributes[0].id;

        const res = await call("PATCH", `/api/tasks/${taskId}/attributes/${attrId}`, {});
        expect(res.status).toBe(400);
    });

    it("deletes a task attribute", async () => {
        const created = await store.createTaskAttribute(taskId, "env", "dev");
        const attrId = created.attributes[0].id;

        const res = await call("DELETE", `/api/tasks/${taskId}/attributes/${attrId}`);
        const task = (await res.json()) as Task;

        expect(task.attributes).toEqual([]);
    });

    it("creates and lists project attributes", async () => {
        const createRes = await call("POST", `/api/projects/${projectId}/attributes`, {
            name: "team",
            value: "core",
        });
        const project = (await createRes.json()) as Project;
        expect(project.attributes[0]).toMatchObject({ name: "team" });

        const listRes = await call("GET", `/api/projects/${projectId}/attributes`);
        const { attributes } = (await listRes.json()) as { attributes: ResolvedAttribute[] };
        expect(attributes).toEqual([
            expect.objectContaining({ name: "team", scope: "project" }),
        ]);
    });

    it("refuses to edit a project attribute from task context", async () => {
        const project = await store.createProjectAttribute(projectId, "team", "core");
        const attrId = project.attributes[0].id;

        const res = await call("PATCH", `/api/tasks/${taskId}/attributes/${attrId}`, {
            value: "infra",
        });

        expect(res.status).toBe(400);
        const { error } = (await res.json()) as { error: string };
        expect(error).toContain("belongs to project");
        expect(error).toContain(`--project-id ${projectId}`);
    });

    it("refuses to delete a parent task's attribute from a subtask", async () => {
        const parent = await store.createTask({ projectId, title: "P", description: "" });
        const child = await store.createTask({
            projectId,
            parentId: parent.id,
            title: "C",
            description: "",
        });
        const withAttr = await store.createTaskAttribute(parent.id, "env", "staging");
        const attrId = withAttr.attributes[0].id;

        const res = await call("DELETE", `/api/tasks/${child.id}/attributes/${attrId}`);

        expect(res.status).toBe(400);
        const { error } = (await res.json()) as { error: string };
        expect(error).toContain("belongs to parent task");
        expect(error).toContain(`--task-id ${parent.id}`);
    });

    it("keeps the created attribute's id stable across a rename", async () => {
        const created = await store.createTaskAttribute(taskId, "env", "dev");
        const attrId = created.attributes[0].id;

        await call("PATCH", `/api/tasks/${taskId}/attributes/${attrId}`, { name: "environment" });
        const res = await call("GET", `/api/tasks/${taskId}/attributes/${attrId}`);
        const { attribute } = (await res.json()) as { attribute: Attribute };

        expect(attribute.id).toBe(attrId);
        expect(attribute.name).toBe("environment");
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/backend/tests/api/attribute-routes.test.ts`
Expected: FAIL — cannot resolve `../../src/api/routes/attribute-routes`.

- [ ] **Step 3: Implement the routes**

Create `packages/backend/src/api/routes/attribute-routes.ts`:

```ts
import type { ApiRouter } from "../router";
import type { TaskStore } from "../../services/task-store";
import type { AttributeLayer, Project, Task, WsEvent } from "@taskflow/shared";
import { MSG, resolveAttributes } from "@taskflow/shared";
import { filterProjectSessions, filterTaskSessions } from "../../services/instance-filter";
import { config } from "../../config";
import { jsonResponse, errorResponse } from "./response-helpers";

interface AttributeRouteDeps {
    apiRouter: ApiRouter;
    taskStore: TaskStore;
    broadcast: (event: WsEvent) => void;
}

type OwnerKind = "task" | "project";

function statusForError(message: string): number {
    return message.includes("not found") ? 404 : 400;
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
    try {
        return (await req.json()) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function registerAttributeRoutes(deps: AttributeRouteDeps): void {
    const { apiRouter, taskStore, broadcast } = deps;

    function publish(kind: OwnerKind, owner: Task | Project): Response {
        if (kind === "task") {
            const filtered = filterTaskSessions(owner as Task, config.instanceId);
            broadcast({ type: MSG.TASK_UPDATED, payload: filtered });
            return jsonResponse(filtered);
        }
        const filtered = filterProjectSessions(owner as Project, config.instanceId);
        broadcast({ type: MSG.PROJECT_UPDATED, payload: filtered });
        return jsonResponse(filtered);
    }

    async function layersFor(kind: OwnerKind, ownerId: string): Promise<AttributeLayer[]> {
        return kind === "task"
            ? taskStore.resolveTaskAttributeLayers(ownerId)
            : taskStore.resolveProjectAttributeLayers(ownerId);
    }

    /**
     * Writes are own-list only. When the id belongs to an inherited layer, say so
     * and name the flag that reaches it, instead of the store's generic
     * "Attribute not found".
     */
    async function foreignAttributeError(
        kind: OwnerKind,
        ownerId: string,
        attrId: string,
    ): Promise<string | null> {
        if (kind === "project") return null;

        const task = await taskStore.getTask(ownerId);
        // A missing task is reported by the mutation itself, as a 404.
        if (!task) return null;
        if (task.attributes.some((a) => a.id === attrId)) return null;

        const project = await taskStore.getProject(task.projectId);
        if (project?.attributes.some((a) => a.id === attrId)) {
            return `attribute ${attrId} belongs to project "${project.name}"; use --project-id ${project.id} to edit it`;
        }

        if (task.parentId) {
            const parent = await taskStore.getTask(task.parentId);
            if (parent?.attributes.some((a) => a.id === attrId)) {
                return `attribute ${attrId} belongs to parent task "${parent.title}"; use --task-id ${parent.id} to edit it`;
            }
        }

        return null;
    }

    function register(kind: OwnerKind): void {
        const collection = kind === "task" ? "tasks" : "projects";
        const idParam = kind === "task" ? "taskId" : "projectId";
        const basePath = `/api/${collection}/:${idParam}/attributes`;

        apiRouter.register("GET", basePath, async (req, params) => {
            const ownerId = params[idParam];
            try {
                const layers = await layersFor(kind, ownerId);
                const url = new URL(req.url);
                const ownOnly = url.searchParams.get("own") === "1";
                const selected = ownOnly ? layers.filter((l) => l.scope === kind) : layers;
                return jsonResponse({ attributes: resolveAttributes(selected) });
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
                return errorResponse(message, statusForError(message));
            }
        });

        apiRouter.register("GET", `${basePath}/:attrId`, async (_req, params) => {
            const ownerId = params[idParam];
            try {
                const layers = await layersFor(kind, ownerId);
                // Search every layer, not the resolved view: a shadowed attribute
                // is still addressable by its id.
                for (const layer of layers) {
                    const found = layer.attributes.find((a) => a.id === params.attrId);
                    if (found) {
                        return jsonResponse({ attribute: { ...found, scope: layer.scope } });
                    }
                }
                return errorResponse(`Attribute not found: ${params.attrId}`, 404);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
                return errorResponse(message, statusForError(message));
            }
        });

        apiRouter.register("POST", basePath, async (req, params) => {
            const body = await readJsonBody(req);
            if (!body) return errorResponse("Invalid JSON body", 400);

            const name = body.name;
            if (typeof name !== "string") {
                return errorResponse('Field "name" is required and must be a string', 400);
            }
            const value = body.value;
            if (value !== undefined && typeof value !== "string") {
                return errorResponse('Field "value" must be a string', 400);
            }

            const ownerId = params[idParam];
            try {
                const updated =
                    kind === "task"
                        ? await taskStore.createTaskAttribute(ownerId, name, value ?? "")
                        : await taskStore.createProjectAttribute(ownerId, name, value ?? "");
                return publish(kind, updated);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
                return errorResponse(message, statusForError(message));
            }
        });

        apiRouter.register("PATCH", `${basePath}/:attrId`, async (req, params) => {
            const body = await readJsonBody(req);
            if (!body) return errorResponse("Invalid JSON body", 400);

            const updates: { name?: string; value?: string } = {};
            if ("name" in body) {
                if (typeof body.name !== "string") {
                    return errorResponse('Field "name" must be a string', 400);
                }
                updates.name = body.name;
            }
            if ("value" in body) {
                if (typeof body.value !== "string") {
                    return errorResponse('Field "value" must be a string', 400);
                }
                updates.value = body.value;
            }
            if (Object.keys(updates).length === 0) {
                return errorResponse("No valid fields to update", 400);
            }

            const ownerId = params[idParam];
            try {
                const foreign = await foreignAttributeError(kind, ownerId, params.attrId);
                if (foreign) return errorResponse(foreign, 400);

                const updated =
                    kind === "task"
                        ? await taskStore.updateTaskAttribute(ownerId, params.attrId, updates)
                        : await taskStore.updateProjectAttribute(ownerId, params.attrId, updates);
                return publish(kind, updated);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
                return errorResponse(message, statusForError(message));
            }
        });

        apiRouter.register("DELETE", `${basePath}/:attrId`, async (_req, params) => {
            const ownerId = params[idParam];
            try {
                const foreign = await foreignAttributeError(kind, ownerId, params.attrId);
                if (foreign) return errorResponse(foreign, 400);

                const updated =
                    kind === "task"
                        ? await taskStore.deleteTaskAttribute(ownerId, params.attrId)
                        : await taskStore.deleteProjectAttribute(ownerId, params.attrId);
                return publish(kind, updated);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
                return errorResponse(message, statusForError(message));
            }
        });
    }

    register("task");
    register("project");
}

export { registerAttributeRoutes };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/backend/tests/api/attribute-routes.test.ts`
Expected: PASS — 16 tests.

- [ ] **Step 5: Wire the routes in**

In `packages/backend/src/api/routes.ts`, add the import alongside the others:

```ts
import { registerAttributeRoutes } from "./routes/attribute-routes";
```

and the call inside `registerApiRoutes`, after `registerTaskRoutes(deps);`:

```ts
    registerAttributeRoutes(deps);
```

- [ ] **Step 6: Verify**

Run: `bun test`
Expected: PASS. Note `packages/backend/tests/api/routes.test.ts` passes `taskStore: {} as never`; the attribute routes only touch `taskStore` inside a handler, so registration alone stays safe.

Run: `bun run lint && bun run typecheck`
Expected: PASS for shared and backend.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/api packages/backend/tests/api
git commit -m "feat(backend): add attribute http routes"
```

---

## Task 5: CLI commands and agent docs

**Files:**

- Create: `packages/backend/src/services/taskflow-cli-attribute-commands.md`
- Modify: `packages/backend/src/services/taskflow-cli-bin.ts`
- Modify: `packages/backend/src/services/internal-agent-skill.ts`
- Modify: `packages/backend/src/services/taskflow-cli-skill.md`

**Interfaces:**

- Consumes: the HTTP routes from Task 4; the existing `api(method, path, body?)`, `parseFlags(args, spec)`, `taskId` / `projectId` module-level bindings in `taskflow-cli-bin.ts`.
- Produces: `taskflow-cli attr <subcommand>`.

Scope resolution for every `attr` subcommand:

1. an explicit `--task-id <id>` flag → task scope
2. an explicit `--project-id <id>` flag → project scope
3. otherwise `TASKFLOW_TASK_ID` (or the pre-command `--task <id>` global) → task scope
4. otherwise `TASKFLOW_PROJECT_ID` → project scope
5. otherwise → error

Passing both `--task-id` and `--project-id` is an error.

- [ ] **Step 1: Add the `handleAttr` function**

In `packages/backend/src/services/taskflow-cli-bin.ts`, add this after the existing `handleTask` function:

```ts
interface AttrScope {
    collection: "tasks" | "projects";
    ownerId: string;
}

function resolveAttrScope(flags: Record<string, string | boolean>): AttrScope {
    const taskFlag = typeof flags["task-id"] === "string" ? flags["task-id"] : "";
    const projectFlag = typeof flags["project-id"] === "string" ? flags["project-id"] : "";

    if (taskFlag && projectFlag) {
        process.stderr.write("Error: pass either --task-id or --project-id, not both\n");
        process.exit(1);
    }
    if (taskFlag) return { collection: "tasks", ownerId: taskFlag };
    if (projectFlag) return { collection: "projects", ownerId: projectFlag };
    if (taskId) return { collection: "tasks", ownerId: taskId };
    if (projectId) return { collection: "projects", ownerId: projectId };

    process.stderr.write(
        "Error: no attribute scope — set TASKFLOW_TASK_ID or TASKFLOW_PROJECT_ID, or pass --task-id / --project-id\n",
    );
    process.exit(1);
}

const ATTR_SCOPE_FLAGS = { "task-id": "string", "project-id": "string" } as const;

async function handleAttr(args: string[]): Promise<void> {
    const subcmd = args[0] ?? "";
    const rest = args.slice(1);

    if (subcmd === "list") {
        const { flags } = parseFlags(rest, { ...ATTR_SCOPE_FLAGS, own: "boolean" });
        const scope = resolveAttrScope(flags);
        const query = flags.own ? "?own=1" : "";
        process.stdout.write(
            await api("GET", `/api/${scope.collection}/${scope.ownerId}/attributes${query}`),
        );
        return;
    }

    if (subcmd === "get") {
        const { flags, positional } = parseFlags(rest, ATTR_SCOPE_FLAGS);
        const attrId = positional[0] ?? "";
        if (!attrId) {
            process.stderr.write("Usage: taskflow-cli attr get <id>\n");
            process.exit(1);
        }
        const scope = resolveAttrScope(flags);
        process.stdout.write(
            await api("GET", `/api/${scope.collection}/${scope.ownerId}/attributes/${attrId}`),
        );
        return;
    }

    if (subcmd === "create") {
        const { flags, positional } = parseFlags(rest, ATTR_SCOPE_FLAGS);
        const name = positional[0] ?? "";
        if (!name) {
            process.stderr.write('Usage: taskflow-cli attr create "<name>" ["<value>"]\n');
            process.exit(1);
        }
        const scope = resolveAttrScope(flags);
        process.stdout.write(
            await api("POST", `/api/${scope.collection}/${scope.ownerId}/attributes`, {
                name,
                value: positional[1] ?? "",
            }),
        );
        return;
    }

    if (subcmd === "set" || subcmd === "rename") {
        const { flags, positional } = parseFlags(rest, ATTR_SCOPE_FLAGS);
        const attrId = positional[0] ?? "";
        const nextValue = positional[1];
        if (!attrId || nextValue === undefined) {
            process.stderr.write(
                subcmd === "set"
                    ? 'Usage: taskflow-cli attr set <id> "<value>"\n'
                    : 'Usage: taskflow-cli attr rename <id> "<name>"\n',
            );
            process.exit(1);
        }
        const scope = resolveAttrScope(flags);
        const body = subcmd === "set" ? { value: nextValue } : { name: nextValue };
        process.stdout.write(
            await api(
                "PATCH",
                `/api/${scope.collection}/${scope.ownerId}/attributes/${attrId}`,
                body,
            ),
        );
        return;
    }

    if (subcmd === "delete") {
        const { flags, positional } = parseFlags(rest, ATTR_SCOPE_FLAGS);
        const attrId = positional[0] ?? "";
        if (!attrId) {
            process.stderr.write("Usage: taskflow-cli attr delete <id>\n");
            process.exit(1);
        }
        const scope = resolveAttrScope(flags);
        process.stdout.write(
            await api("DELETE", `/api/${scope.collection}/${scope.ownerId}/attributes/${attrId}`),
        );
        return;
    }

    process.stderr.write(
        "Usage: taskflow-cli attr <list|get|create|set|rename|delete> [--task-id <id>] [--project-id <id>]\n",
    );
    process.exit(1);
}
```

`ATTR_SCOPE_FLAGS` is declared `as const`, but `parseFlags` takes `Record<string, "string" | "boolean">`. If TypeScript rejects the spread, drop the `as const` and annotate explicitly:

```ts
const ATTR_SCOPE_FLAGS: Record<string, "string" | "boolean"> = {
    "task-id": "string",
    "project-id": "string",
};
```

- [ ] **Step 2: Add the dispatch case**

In the `switch (cmd)` block near the bottom of `taskflow-cli-bin.ts`, add a case beside the others:

```ts
        case "attr":
            await handleAttr(rest);
            break;
```

- [ ] **Step 3: Write the CLI docs**

Create `packages/backend/src/services/taskflow-cli-attribute-commands.md`:

````markdown
## Attribute commands

Attributes are name/value pairs attached to a task or a project. A value is always a plain string.

Attributes resolve in layers: **project → parent task → task**. A higher layer shadows a lower one with the same name, and the shadowed attribute does not appear in `attr list`.

Scope is inferred from the session: inside a task it is the task, inside a project session it is the project. Pass `--task-id <id>` or `--project-id <id>` on any subcommand to target a different owner explicitly.

`taskflow-cli attr list` List the resolved attributes for the current scope
`taskflow-cli attr list --own` List only this task's (or project's) own attributes
`taskflow-cli attr get <id>` Get one attribute by id, including its scope
`taskflow-cli attr create "<name>"` Create an attribute with an empty value
`taskflow-cli attr create "<name>" "<value>"` Create an attribute with a value
`taskflow-cli attr set <id> "<value>"` Replace an attribute's value
`taskflow-cli attr rename <id> "<name>"` Rename an attribute
`taskflow-cli attr delete <id>` Delete an attribute

`taskflow-cli attr list --project-id <id>` Read a specific project's attributes
`taskflow-cli attr create "env" "prod" --project-id <id>` Create a project attribute
`taskflow-cli attr set <id> "value" --task-id <id>` Edit another task's attribute

Names are trimmed and must be unique within one owner's own list. A task may reuse a project attribute's name — that is how you override it.

`get` finds an attribute in any layer, so an inherited or shadowed attribute is still readable by id. `set`, `rename` and `delete` only work on the current scope's own attributes; pass `--project-id` or `--task-id` to edit another owner's.
````

- [ ] **Step 4: Register the doc file**

In `packages/backend/src/services/internal-agent-skill.ts`, add the import beside the other command-doc imports:

```ts
import attributeCommandsMd from "./taskflow-cli-attribute-commands.md" with { type: "text" };
```

and the entry in `COMMAND_FILES`, after the project entry:

```ts
    "taskflow-cli-attribute-commands.md": attributeCommandsMd,
```

- [ ] **Step 5: Reference the doc from the skill**

In `packages/backend/src/services/taskflow-cli-skill.md`, add after the project commands block:

```markdown
# All attribute commands
@taskflow-cli-attribute-commands.md
```

- [ ] **Step 6: Verify the CLI end to end**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

Run: `bun test`
Expected: PASS.

Confirm the doc is embedded and the dispatch is reachable:

Run: `bun -e 'import { getResolvedCliHelp } from "./packages/backend/src/services/internal-agent-skill.ts"; const help = getResolvedCliHelp(); console.log(help.includes("attr create") ? "OK: attr docs embedded" : "MISSING");'`
Expected: `OK: attr docs embedded`

Run: `TASKFLOW_API_URL=http://127.0.0.1:9 bun run packages/backend/src/services/taskflow-cli-bin.ts attr`
Expected: exits non-zero, printing `Usage: taskflow-cli attr <list|get|create|set|rename|delete> ...` on stderr. Reaching the usage line proves dispatch works without a running backend. `TASKFLOW_API_URL` must be set because the CLI exits at module load when it is missing (`taskflow-cli-bin.ts:7`); the URL is never dialled on this path.

Also confirm scope inference fails loudly rather than silently defaulting:

Run: `TASKFLOW_API_URL=http://127.0.0.1:9 bun run packages/backend/src/services/taskflow-cli-bin.ts attr list`
Expected: exits non-zero with `Error: no attribute scope — set TASKFLOW_TASK_ID or TASKFLOW_PROJECT_ID, or pass --task-id / --project-id`.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services
git commit -m "feat(cli): add attr commands and agent docs"
```

---

## Task 6: UI

**Files:**

- Create: `packages/ui/src/lib/attribute-api.ts`
- Create: `packages/ui/src/components/panels/AttributesSection.tsx`
- Modify: `packages/ui/src/components/panels/TaskInfoPanel.tsx`

**Interfaces:**

- Consumes: `MSG.ATTR_CREATE` / `ATTR_UPDATE` / `ATTR_DELETE` and the payload types from Task 3; `resolveAttributes`, `normalizeAttributeName`, `hasNameConflict` from Task 1; `sendRequest` from `@/hooks/useWebSocket`.
- Produces: `<AttributesSection owner={...} inheritedLayers={...} attributes={...} />`.

The section is presentational plus RPC. It holds no persistent state of its own: `TASK_UPDATED` / `PROJECT_UPDATED` broadcasts flow into the existing Zustand stores, and the panel re-renders from the store.

- [ ] **Step 1: Write the API module**

Create `packages/ui/src/lib/attribute-api.ts`:

```ts
import type { AttributeOwner } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";

async function createAttribute(owner: AttributeOwner, name: string, value: string): Promise<void> {
    await sendRequest(MSG.ATTR_CREATE, { ...owner, name, value });
}

async function updateAttribute(
    owner: AttributeOwner,
    attrId: string,
    updates: { name?: string; value?: string },
): Promise<void> {
    await sendRequest(MSG.ATTR_UPDATE, { ...owner, attrId, ...updates });
}

async function deleteAttribute(owner: AttributeOwner, attrId: string): Promise<void> {
    await sendRequest(MSG.ATTR_DELETE, { ...owner, attrId });
}

export { createAttribute, deleteAttribute, updateAttribute };
```

- [ ] **Step 2: Write the section component**

Create `packages/ui/src/components/panels/AttributesSection.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Attribute, AttributeLayer, AttributeOwner } from "@taskflow/shared";
import { hasNameConflict, normalizeAttributeName, resolveAttributes } from "@taskflow/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    createAttribute,
    deleteAttribute,
    updateAttribute,
} from "@/lib/attribute-api";

const SAVE_DEBOUNCE_MS = 500;

interface AttributesSectionProps {
    owner: AttributeOwner;
    /** Own attributes, editable here. */
    attributes: Attribute[];
    /** Lower-precedence layers, read-only. Empty for a project. */
    inheritedLayers: AttributeLayer[];
    /** Prefix for input ids, so task and project panels don't collide. */
    idPrefix: string;
}

type DraftField = "name" | "value";
type Drafts = Record<string, Partial<Record<DraftField, string>>>;

const scopeLabels: Record<string, string> = {
    project: "project",
    parent: "parent task",
    task: "task",
};

function AttributesSection({
    owner,
    attributes,
    inheritedLayers,
    idPrefix,
}: AttributesSectionProps) {
    const [error, setError] = useState<string | null>(null);
    // A field with a draft is being edited; without one it renders the store
    // value. Clearing a draft is how a save (or a rejection) hands control back
    // to the store.
    const [drafts, setDrafts] = useState<Drafts>({});
    const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

    // Debounced saves fire outside render, so they read the latest props here
    // rather than closing over a stale render's values.
    const attributesRef = useRef(attributes);
    const ownerRef = useRef(owner);
    useEffect(() => {
        attributesRef.current = attributes;
        ownerRef.current = owner;
    });

    useEffect(() => {
        const pending = timers.current;
        return () => {
            for (const timer of pending.values()) {
                clearTimeout(timer);
            }
            pending.clear();
        };
    }, []);

    // Inherited rows shadowed by an own attribute must not be shown, so resolve
    // the full stack and keep only the entries the own list did not shadow.
    const inherited = useMemo(() => {
        const resolved = resolveAttributes([
            ...inheritedLayers,
            { scope: "task", attributes },
        ]);
        return resolved.filter((a) => !attributes.some((own) => own.id === a.id));
    }, [attributes, inheritedLayers]);

    const setDraft = useCallback((attrId: string, field: DraftField, text: string) => {
        setDrafts((current) => ({
            ...current,
            [attrId]: { ...current[attrId], [field]: text },
        }));
    }, []);

    const clearDraft = useCallback((attrId: string, field: DraftField) => {
        setDrafts((current) => {
            const entry = current[attrId];
            if (!entry || entry[field] === undefined) return current;
            const { [field]: _dropped, ...remaining } = entry;
            const next = { ...current };
            if (Object.keys(remaining).length === 0) {
                delete next[attrId];
            } else {
                next[attrId] = remaining;
            }
            return next;
        });
    }, []);

    const commitText = useCallback(
        (attrId: string, field: DraftField, text: string) => {
            const attribute = attributesRef.current.find((a) => a.id === attrId);
            if (!attribute) return;

            if (field === "value") {
                if (text === attribute.value) {
                    clearDraft(attrId, "value");
                    return;
                }
                setError(null);
                void updateAttribute(ownerRef.current, attrId, { value: text })
                    .then(() => clearDraft(attrId, "value"))
                    .catch((err: unknown) => {
                        setError(
                            err instanceof Error ? err.message : "Failed to update attribute",
                        );
                        clearDraft(attrId, "value");
                    });
                return;
            }

            const name = normalizeAttributeName(text);
            if (name === attribute.name) {
                clearDraft(attrId, "name");
                return;
            }
            if (!name) {
                setError("Attribute name cannot be empty");
                clearDraft(attrId, "name");
                return;
            }
            if (hasNameConflict(attributesRef.current, name, attrId)) {
                setError(`"${name}" already exists here`);
                clearDraft(attrId, "name");
                return;
            }
            setError(null);
            void updateAttribute(ownerRef.current, attrId, { name })
                .then(() => clearDraft(attrId, "name"))
                .catch((err: unknown) => {
                    setError(err instanceof Error ? err.message : "Failed to rename attribute");
                    clearDraft(attrId, "name");
                });
        },
        [clearDraft],
    );

    const scheduleCommit = useCallback(
        (attrId: string, field: DraftField, text: string) => {
            const key = `${attrId}:${field}`;
            const existing = timers.current.get(key);
            if (existing) clearTimeout(existing);
            timers.current.set(
                key,
                setTimeout(() => {
                    timers.current.delete(key);
                    commitText(attrId, field, text);
                }, SAVE_DEBOUNCE_MS),
            );
        },
        [commitText],
    );

    const commitNow = useCallback(
        (attrId: string, field: DraftField, text: string) => {
            const key = `${attrId}:${field}`;
            const existing = timers.current.get(key);
            if (existing) {
                clearTimeout(existing);
                timers.current.delete(key);
            }
            commitText(attrId, field, text);
        },
        [commitText],
    );

    const handleChange = useCallback(
        (attrId: string, field: DraftField, text: string) => {
            setDraft(attrId, field, text);
            scheduleCommit(attrId, field, text);
        },
        [scheduleCommit, setDraft],
    );

    const addAttribute = useCallback(() => {
        let candidate = "new-attribute";
        let suffix = 2;
        while (hasNameConflict(attributes, candidate)) {
            candidate = `new-attribute-${suffix}`;
            suffix += 1;
        }
        setError(null);
        void createAttribute(owner, candidate, "").catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "Failed to add attribute");
        });
    }, [attributes, owner]);

    const removeAttribute = useCallback(
        (attrId: string) => {
            setError(null);
            void deleteAttribute(owner, attrId).catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Failed to delete attribute");
            });
        },
        [owner],
    );

    return (
        <div>
            <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-medium">Attributes</span>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={addAttribute}
                    aria-label="Add attribute"
                    tooltip="Add attribute"
                    tooltipSide="bottom">
                    <Plus className="h-3 w-3" />
                </Button>
            </div>

            {inherited.length > 0 && (
                <div className="mt-2 space-y-1">
                    {inherited.map((attribute) => (
                        <div
                            key={attribute.id}
                            className="flex items-center gap-2 text-xs opacity-70">
                            <span className="border-border text-muted-foreground shrink-0 rounded border px-1 py-0.5 text-[10px]">
                                {scopeLabels[attribute.scope] ?? attribute.scope}
                            </span>
                            <span className="text-secondary-foreground min-w-0 flex-1 truncate">
                                {attribute.name}
                            </span>
                            <span className="text-muted-foreground min-w-0 flex-1 truncate">
                                {attribute.value}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <div className="mt-2 space-y-1">
                {attributes.map((attribute) => (
                    <div key={attribute.id} className="flex items-center gap-1">
                        <Input
                            id={`${idPrefix}-attr-name-${attribute.id}`}
                            aria-label="Attribute name"
                            value={drafts[attribute.id]?.name ?? attribute.name}
                            onChange={(e) => handleChange(attribute.id, "name", e.target.value)}
                            onBlur={(e) => commitNow(attribute.id, "name", e.target.value)}
                            placeholder="name"
                            className="h-7 flex-1 text-xs"
                        />
                        <Input
                            id={`${idPrefix}-attr-value-${attribute.id}`}
                            aria-label="Attribute value"
                            value={drafts[attribute.id]?.value ?? attribute.value}
                            onChange={(e) => handleChange(attribute.id, "value", e.target.value)}
                            onBlur={(e) => commitNow(attribute.id, "value", e.target.value)}
                            placeholder="value"
                            className="h-7 flex-1 text-xs"
                        />
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => removeAttribute(attribute.id)}
                            aria-label={`Delete attribute ${attribute.name}`}
                            tooltip="Delete attribute"
                            tooltipSide="bottom">
                            <Trash2 className="h-3 w-3" />
                        </Button>
                    </div>
                ))}
            </div>

            {attributes.length === 0 && inherited.length === 0 && (
                <p className="text-muted-foreground mt-1 text-xs">No attributes yet.</p>
            )}

            {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
        </div>
    );
}

export { AttributesSection };
```

The inputs are controlled against a draft map rather than uncontrolled with `defaultValue`. `defaultValue` would be a bug here: React ignores changes to it after mount, so a value written by an agent — or a name the server normalized — would never appear in a field the user had already touched. With drafts, a field shows the store value until the user types, and returns to the store value the moment a save resolves or fails. A rejected rename therefore reverts visibly, which is the behaviour Step 6 checks.

Saves are debounced by `SAVE_DEBOUNCE_MS` and flushed on blur, matching how the existing title/notes/prompt fields in this panel behave.

- [ ] **Step 3: Render the section in the project view**

In `packages/ui/src/components/panels/TaskInfoPanel.tsx`, add the import:

```tsx
import { AttributesSection } from "@/components/panels/AttributesSection";
```

In the project branch (`if (workspace.scope === "project" && project)`), insert between the "Project-specific system prompt" block and the "Path" block:

```tsx
                        <Separator className="my-4" />

                        <AttributesSection
                            owner={{ projectId: project.id }}
                            attributes={project.attributes}
                            inheritedLayers={[]}
                            idPrefix="project-info"
                        />
```

- [ ] **Step 4: Render the section in the task view**

Still in `TaskInfoPanel.tsx`, compute the inherited layers near the other `useMemo` calls at the top of the component:

```tsx
    const parentTask = useTaskStore((s) =>
        task?.parentId ? s.tasks.find((t) => t.id === task.parentId) : undefined,
    );
    const taskProject = useProjectStore((s) =>
        task ? s.projects.find((p) => p.id === task.projectId) : undefined,
    );
    const inheritedLayers = useMemo<AttributeLayer[]>(() => {
        const layers: AttributeLayer[] = [
            { scope: "project", attributes: taskProject?.attributes ?? [] },
        ];
        if (task?.parentId) {
            layers.push({ scope: "parent", attributes: parentTask?.attributes ?? [] });
        }
        return layers;
    }, [parentTask, task?.parentId, taskProject]);
```

Add the type import at the top:

```tsx
import type { AttributeLayer, TaskLogEntryType } from "@taskflow/shared";
```

Then in the task branch, insert between the "Notes" block and the "Edited Files" block:

```tsx
                    <Separator className="my-4" />

                    <AttributesSection
                        owner={{ taskId: task.id }}
                        attributes={task.attributes}
                        inheritedLayers={inheritedLayers}
                        idPrefix="task-info"
                    />
```

These selectors return a `find` result. `find` returns the element's own identity, so zustand's default equality holds as long as that element object is unchanged — a re-render only happens when the parent task or project actually changes.

That guarantee is undermined by an existing line in this component. `TaskInfoPanel.tsx:54` reads:

```tsx
    const { updateTask, fetchTaskLog } = useTaskStore();
```

Calling `useTaskStore()` with no selector subscribes the panel to every task-store change, so the new selectors buy nothing while it stands. Replace that line with two selectors:

```tsx
    const updateTask = useTaskStore((s) => s.updateTask);
    const fetchTaskLog = useTaskStore((s) => s.fetchTaskLog);
```

Both are stable function references created once at store setup, so this is a safe, mechanical substitution. `updateProject` on the next line is already selected correctly and needs no change.

- [ ] **Step 5: Verify**

Run: `bun run typecheck`
Expected: PASS across all packages.

Run: `bun run lint`
Expected: PASS.

Run: `bun test`
Expected: PASS.

- [ ] **Step 6: Verify in the running app**

Run: `bun run dev:backend` in one terminal and `bun run dev:electron` in another (see `package.json`). Then:

1. Select a project in the sidebar. The project info panel shows an empty "Attributes" section. Click `+`, rename the new row to `env`, set its value to `prod`, and blur.
2. Select a task in that project. The task info panel shows `env / prod` in the inherited block with a `project` badge.
3. Click `+` on the task, rename the row to `env`, set the value to `dev`. The inherited `env` row disappears; only the task's own `env` remains.
4. Add a second task attribute and rename it to `env`. An inline error appears and the name reverts on the next store update.

Confirm each step before continuing. If step 4 leaves the input showing the rejected name, that is acceptable — the store value is unchanged and the error is displayed.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src
git commit -m "feat(ui): add attributes section to task and project info panels"
```

---

## Task 7: Full verification

**Files:** none — this task only runs checks.

- [ ] **Step 1: Run the full suite**

Run: `bun test`
Expected: PASS, with the new suites present: `attributes.test.ts`, `attribute-mutations.test.ts`, `attribute-store.test.ts`, `attribute.test.ts`, `attribute-routes.test.ts`.

- [ ] **Step 2: Lint and typecheck**

Run: `bun run lint && bun run typecheck && bun run format:check`
Expected: PASS. If `format:check` fails, run `bun run format` and amend.

- [ ] **Step 3: Confirm back-compat against real data**

The dev backend shares the real data directory. Before running it against your own tasks, confirm the normalization path holds by re-reading a pre-existing record:

Run: `bun test packages/backend/tests/services/attribute-store.test.ts -t "legacy"`
Expected: PASS — 2 tests covering legacy task and project records.

- [ ] **Step 4: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore: formatting for attributes feature"
```

(Skip if there is nothing to commit.)
