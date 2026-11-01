import { expect, test } from "bun:test";
import type { Task } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import { takeReadyStarts, type PendingTaskStart } from "./pending-task-starts";

const task = (id: string, path: string | null): Scoped<Task> => ({
    id,
    projectId: "project",
    title: id,
    description: "",
    notes: "",
    archivedAt: null,
    pinned: false,
    status: "active",
    sessions: [],
    attributes: [],
    worktree: { enabled: true, path, branch: `task/${id}`, pr: null },
    createdAt: "2026-11-01T00:00:00.000Z",
    backendId: "local",
});

const startedIds = (ready: ReturnType<typeof takeReadyStarts>) => ready.map((r) => r.task.id);

test("a second task waiting on its worktree does not replace the first one's start", () => {
    const pending = new Map<string, PendingTaskStart>();
    pending.set("a", { kind: "session", type: "claude", description: "" });
    pending.set("b", { kind: "flow", flowId: "flow" });

    expect(startedIds(takeReadyStarts(pending, [task("a", null), task("b", null)]))).toEqual([]);

    const first = takeReadyStarts(pending, [task("a", "/repo/.worktrees/a"), task("b", null)]);
    expect(first).toEqual([
        {
            task: task("a", "/repo/.worktrees/a"),
            start: { kind: "session", type: "claude", description: "" },
        },
    ]);

    const second = takeReadyStarts(pending, [
        task("a", "/repo/.worktrees/a"),
        task("b", "/repo/.worktrees/b"),
    ]);
    expect(second.map((r) => r.start)).toEqual([{ kind: "flow", flowId: "flow" }]);
    expect(pending.size).toBe(0);
});

test("a start whose task is gone is dropped without starting", () => {
    const pending = new Map<string, PendingTaskStart>([["gone", { kind: "flow", flowId: "flow" }]]);
    expect(takeReadyStarts(pending, [])).toEqual([]);
    expect(pending.size).toBe(0);
});

test("a task whose worktree setup failed starts in the project folder", () => {
    const failed = {
        ...task("a", null),
        worktree: { enabled: false, path: null, branch: null, pr: null },
    };
    const pending = new Map<string, PendingTaskStart>([["a", { kind: "flow", flowId: "flow" }]]);
    expect(startedIds(takeReadyStarts(pending, [failed]))).toEqual(["a"]);
});
