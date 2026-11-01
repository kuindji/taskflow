import { afterAll, beforeAll, expect, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Task } from "@taskflow/shared";
import { openConnection, closeConnection } from "@/lib/connection-registry";
import { startTestServer } from "@/lib/test-ws-server";
import { useTaskStore } from "./task-store";
import { resetBackend } from "./store-reset";

const BACKEND = "task-status-events";
const record = (id: string, status: Task["status"], parentId?: string): Task => ({
    id,
    parentId,
    projectId: "project",
    title: id,
    description: "",
    notes: "",
    archivedAt: status === "archived" ? "2026-11-01T00:00:00.000Z" : null,
    pinned: false,
    status,
    sessions: [],
    attributes: [],
    worktree: { enabled: false, path: null, branch: null, pr: null },
    createdAt: "2026-11-01T00:00:00.000Z",
});

let liveTasks: Task[] = [];
let archivedTasks: Task[] = [];
const server = startTestServer(BACKEND, (type) => {
    if (type === MSG.TASK_LIST) return { tasks: liveTasks };
    if (type === MSG.TASK_LIST_ARCHIVED) return { tasks: archivedTasks };
    return {};
});
beforeAll(async () => {
    await openConnection(BACKEND, server.origin);
});
afterAll(() => {
    closeConnection(BACKEND, "detach");
    resetBackend(BACKEND);
    server.stop();
});

function until(check: () => boolean): Promise<void> {
    return new Promise((resolve) => {
        if (check()) return resolve();
        const unsubscribe = useTaskStore.subscribe(() => {
            if (check()) {
                unsubscribe();
                resolve();
            }
        });
    });
}

const liveIds = () => useTaskStore.getState().tasks.map((t) => t.id);
const archivedIds = () => useTaskStore.getState().archivedTasks.map((t) => t.id);

test("an archive made elsewhere moves the task family out of the live list", async () => {
    liveTasks = [
        record("parent", "active"),
        record("child", "active", "parent"),
        record("other", "active"),
    ];
    archivedTasks = [];
    await useTaskStore.getState().fetchTasks(BACKEND);
    useTaskStore.getState().setShowArchive(true);
    await until(() => archivedIds().length === 0);
    useTaskStore.getState().setActiveTask("child");

    liveTasks = [record("other", "active")];
    archivedTasks = [record("parent", "archived"), record("child", "archived", "parent")];
    server.broadcast(MSG.TASK_UPDATED, record("parent", "archived"));
    await until(() => !liveIds().includes("parent") && archivedIds().includes("parent"));

    expect(liveIds()).toEqual(["other"]);
    expect(archivedIds().sort()).toEqual(["child", "parent"]);
    expect(useTaskStore.getState().activeTaskId).toBeNull();
    useTaskStore.getState().setShowArchive(false);
});

test("a restore made elsewhere brings the task family back to the live list", async () => {
    liveTasks = [record("other", "active")];
    archivedTasks = [record("parent", "archived"), record("child", "archived", "parent")];
    await useTaskStore.getState().fetchTasks(BACKEND);
    await useTaskStore.getState().fetchArchivedTasks(BACKEND);
    expect(liveIds()).toEqual(["other"]);

    liveTasks = [
        record("parent", "active"),
        record("child", "active", "parent"),
        record("other", "active"),
    ];
    archivedTasks = [];
    server.broadcast(MSG.TASK_UPDATED, record("parent", "active"));
    await until(() => liveIds().includes("child"));

    expect(liveIds().sort()).toEqual(["child", "other", "parent"]);
    expect(archivedIds()).toEqual([]);
});

test("an update to a live task still replaces it in place", async () => {
    liveTasks = [record("other", "active")];
    await useTaskStore.getState().fetchTasks(BACKEND);
    server.broadcast(MSG.TASK_UPDATED, { ...record("other", "active"), title: "renamed" });
    await until(() => useTaskStore.getState().tasks.some((t) => t.title === "renamed"));
    expect(liveIds()).toEqual(["other"]);
});

test("a list refresh while the archive is shown refreshes the archive too", async () => {
    // A reconnect refetches the lists; a restore made while disconnected sent
    // no event this client saw.
    liveTasks = [record("other", "active")];
    archivedTasks = [record("gone", "archived")];
    await useTaskStore.getState().fetchTasks(BACKEND);
    useTaskStore.getState().setShowArchive(true);
    await until(() => archivedIds().includes("gone"));

    liveTasks = [record("gone", "active"), record("other", "active")];
    archivedTasks = [];
    await useTaskStore.getState().fetchTasks(BACKEND);
    await until(() => !archivedIds().includes("gone"));

    expect(liveIds().sort()).toEqual(["gone", "other"]);
    expect(archivedIds()).toEqual([]);
    useTaskStore.getState().setShowArchive(false);
});
