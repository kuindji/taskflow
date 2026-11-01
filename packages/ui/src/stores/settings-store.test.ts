import { afterEach, expect, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Project, Task } from "@taskflow/shared";
import { closeConnection, openConnection, setPrimary } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { useProjectStore } from "./project-store";
import { useSettingsStore } from "./settings-store";
import { resetBackend } from "./store-reset";
import { useTaskStore } from "./task-store";

function project(id: string): Project {
    return {
        id,
        name: id,
        path: `/repos/${id}`,
        sessions: [],
        attributes: [],
        createdAt: "2026-09-13T00:00:00.000Z",
    };
}

function task(id: string, projectId: string): Task {
    return {
        id,
        projectId,
        title: id,
        description: "",
        notes: "",
        worktree: { enabled: false, path: null, branch: null, pr: null },
        sessions: [],
        attributes: [],
        createdAt: "2026-09-13T00:00:00.000Z",
        status: "active",
        archivedAt: null,
        pinned: false,
    };
}

const servers: TestServer[] = [];

afterEach(() => {
    closeConnection("a", "detach");
    resetBackend("a");
    servers.splice(0).forEach((server) => server.stop());
});

test("adopting an existing data folder lists that folder's projects and tasks", async () => {
    const datasets = {
        "/data/old": { projects: [project("old")], tasks: [task("old-task", "old")] },
        "/data/new": { projects: [project("new")], tasks: [task("new-task", "new")] },
    };
    let dataDir: keyof typeof datasets = "/data/old";
    const server = startTestServer("a", (type, payload) => {
        if (type === MSG.PROJECT_LIST) return { projects: datasets[dataDir].projects };
        if (type === MSG.TASK_LIST) return { tasks: datasets[dataDir].tasks };
        if (type === MSG.SETTINGS_UPDATE_DATA_DIR) {
            dataDir = (payload as { path: keyof typeof datasets }).path;
            return { dataDir, baseDir: "/data/old", isDefault: false };
        }
        return {};
    });
    servers.push(server);
    await openConnection("a", server.origin);
    setPrimary("a");
    await useProjectStore.getState().fetchProjects("a");
    await useTaskStore.getState().fetchTasks("a");
    useTaskStore.setState({ activeTaskId: "old-task" });

    await useSettingsStore.getState().updateDataDir("/data/new", "adopt");

    expect(useProjectStore.getState().projects.map((p) => p.id)).toEqual(["new"]);
    expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual(["new-task"]);
    expect(useTaskStore.getState().activeTaskId).toBeNull();
});
