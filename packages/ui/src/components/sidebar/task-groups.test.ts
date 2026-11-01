import { expect, test } from "bun:test";
import type { Task } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import { groupTasksByParent } from "./task-groups";

const record = (id: string, parentId?: string): Scoped<Task> => ({
    id,
    parentId,
    projectId: "project",
    title: id,
    description: "",
    notes: "",
    archivedAt: null,
    pinned: false,
    status: "archived",
    sessions: [],
    attributes: [],
    worktree: { enabled: false, path: null, branch: null, pr: null },
    createdAt: "2026-11-01T00:00:00.000Z",
    backendId: "local",
});

test("a subtask nests under its listed parent", () => {
    const { topLevelTasks, subtaskMap } = groupTasksByParent([
        record("parent"),
        record("child", "parent"),
    ]);
    expect(topLevelTasks.map((t) => t.id)).toEqual(["parent"]);
    expect(subtaskMap.get("parent")?.map((t) => t.id)).toEqual(["child"]);
});

test("a subtask archived alone, with its parent still active, gets its own row", () => {
    const { topLevelTasks, subtaskMap } = groupTasksByParent([
        record("archived-child", "active-parent"),
        record("other"),
    ]);
    expect(topLevelTasks.map((t) => t.id)).toEqual(["archived-child", "other"]);
    expect(subtaskMap.size).toBe(0);
});
