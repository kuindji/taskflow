import { afterAll, beforeAll, expect, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Task } from "@taskflow/shared";
import { openConnection, closeConnection } from "@/lib/connection-registry";
import { startTestServer } from "@/lib/test-ws-server";
import { useTaskStore } from "./task-store";
import { useDialogStore, alert } from "./dialog-store";
import { resetBackend } from "./store-reset";

const warning = "Task deleted, but worktree cleanup failed: remove worktree: denied";
const record = (id: string, parentId?: string): Task => ({
    id,
    parentId,
    projectId: "project",
    title: id,
    description: "",
    notes: "",
    archivedAt: null,
    pinned: false,
    status: "active",
    sessions: [],
    attributes: [],
    worktree: { enabled: true, path: "/repo/linked", branch: "task/cleanup", pr: null },
    createdAt: "2026-10-30T00:00:00.000Z",
});
const server = startTestServer("task-cleanup", (type) => {
    if (type === MSG.TASK_LIST)
        return { tasks: [record("parent"), record("child", "parent"), record("other")] };
    if (type === MSG.TASK_LIST_ARCHIVED) return { tasks: [record("archived-child", "parent")] };
    if (type === MSG.TASK_DELETE) return { success: true, cleanupError: warning };
    return {};
});
beforeAll(async () => {
    await openConnection("task-cleanup", server.origin);
});
afterAll(() => {
    closeConnection("task-cleanup", "detach");
    resetBackend("task-cleanup");
    server.stop();
    while (useDialogStore.getState().open) useDialogStore.getState().dismiss();
});

test("a cleanup warning removes the task family and opens Worktree cleanup failed", async () => {
    await useTaskStore.getState().fetchTasks("task-cleanup");
    await useTaskStore.getState().fetchArchivedTasks("task-cleanup");
    const parent = useTaskStore.getState().tasks.find((task) => task.id === "parent");
    if (!parent) throw new Error("Missing task fixture");
    useTaskStore.getState().setActiveTask("child");
    const statesAtWarning: string[][] = [];
    const unsubscribe = useDialogStore.subscribe((state) => {
        if (state.title === "Worktree cleanup failed")
            statesAtWarning.push(useTaskStore.getState().tasks.map((task) => task.id));
    });
    try {
        await useTaskStore.getState().deleteTask(parent, { deleteWorktree: true });
        expect(useTaskStore.getState().tasks.map((task) => task.id)).toEqual(["other"]);
        expect(useTaskStore.getState().archivedTasks).toEqual([]);
        expect(useTaskStore.getState().activeTaskId).toBeNull();
        expect(useDialogStore.getState()).toMatchObject({
            open: true,
            mode: "alert",
            title: "Worktree cleanup failed",
            description: warning,
        });
        expect(statesAtWarning).toEqual([["other"]]);
    } finally {
        unsubscribe();
        useDialogStore.getState().dismiss();
    }
});

test("a cleanup warning queues behind an existing dialog without blocking deletion", async () => {
    void alert({ title: "Existing", description: "Already open" });
    await useTaskStore.getState().fetchTasks("task-cleanup");
    const parent = useTaskStore.getState().tasks.find((task) => task.id === "parent");
    if (!parent) throw new Error("Missing task fixture");
    await useTaskStore.getState().deleteTask(parent, { deleteWorktree: true });
    expect(useDialogStore.getState().title).toBe("Existing");
    expect(useDialogStore.getState().queue).toHaveLength(1);
    useDialogStore.getState().dismiss();
    expect(useDialogStore.getState()).toMatchObject({
        title: "Worktree cleanup failed",
        description: warning,
    });
    useDialogStore.getState().dismiss();
});
