import { afterEach, describe, expect, test } from "bun:test";
import { MASTER_OWNER_ID, MSG } from "@taskflow/shared";
import type {
    ActionDefinition,
    FlowDefinition,
    Notification,
    Project,
    Task,
} from "@taskflow/shared";
import { closeConnection, openConnection, setPrimary } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { useDiffStore } from "./diff-store";
import { filterByProject, useFlowStore } from "./flow-store";
import { useNotificationStore } from "./notification-store";
import { useProjectStore } from "./project-store";
import { settingsFor, useSettingsStore } from "./settings-store";
import { resetBackend } from "./store-reset";
import { useTaskStore } from "./task-store";

function project(id: string, name: string): Project {
    return {
        id,
        name,
        path: `/repos/${id}`,
        sessions: [],
        attributes: [],
        createdAt: "2026-09-13T00:00:00.000Z",
    };
}

/** A backend holding `projects`, answering PROJECT_UPDATE with the patched record. */
function startProjectBackend(label: string, projects: Project[]): TestServer {
    return startTestServer(label, (type, payload) => {
        if (type === MSG.PROJECT_LIST) return { projects };
        if (type === MSG.PROJECT_UPDATE) {
            const { id, ...updates } = payload as { id: string };
            const current = projects.find((p) => p.id === id);
            return { ...current, ...updates };
        }
        return {};
    });
}

async function until(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error("timed out waiting for the store");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

const servers: TestServer[] = [];

async function attachTwo(a: Project[], b: Project[]): Promise<[TestServer, TestServer]> {
    const serverA = startProjectBackend("A", a);
    const serverB = startProjectBackend("B", b);
    servers.push(serverA, serverB);
    await openConnection("a", serverA.origin);
    await openConnection("b", serverB.origin);
    await useProjectStore.getState().fetchProjects("a");
    await useProjectStore.getState().fetchProjects("b");
    return [serverA, serverB];
}

function recordOn(backendId: string, id: string) {
    return useProjectStore
        .getState()
        .projects.find((p) => p.backendId === backendId && p.id === id);
}

afterEach(() => {
    for (const id of ["a", "b"]) {
        closeConnection(id, "detach");
        resetBackend(id);
    }
    servers.splice(0).forEach((server) => server.stop());
});

describe("project store across two backends", () => {
    test("records from both backends coexist, each tagged with its own backend", async () => {
        await attachTwo([project("1", "Alpha")], [project("2", "Beta")]);

        expect(useProjectStore.getState().projects.map((p) => `${p.backendId}:${p.id}`)).toEqual([
            "a:1",
            "b:2",
        ]);
    });

    test("an update delivered by one backend changes only that backend's record", async () => {
        // The same repository on both machines: identical id and shape.
        const [serverA] = await attachTwo([project("same", "Repo")], [project("same", "Repo")]);

        serverA.broadcast(MSG.PROJECT_UPDATED, project("same", "Renamed"));
        await until(() => recordOn("a", "same")?.name === "Renamed");

        expect(recordOn("b", "same")?.name).toBe("Repo");
    });

    test("detaching one backend leaves the other's records intact", async () => {
        await attachTwo([project("1", "Alpha")], [project("2", "Beta")]);

        // What `backend-store.detach` does to renderer state.
        closeConnection("a", "detach");
        resetBackend("a");

        expect(useProjectStore.getState().projects.map((p) => `${p.backendId}:${p.id}`)).toEqual([
            "b:2",
        ]);
    });

    test("an event landing while a machine's first list is in flight does not lose the list", async () => {
        // A busy machine broadcasts updates all the time; one reaches the
        // renderer before the answer to the list request does.
        const projects = [project("1", "Alpha"), project("2", "Beta")];
        const server: TestServer = startTestServer("A", (type) => {
            if (type !== MSG.PROJECT_LIST) return {};
            server.broadcast(MSG.PROJECT_UPDATED, project("1", "Alpha"));
            return { projects };
        });
        servers.push(server);
        await openConnection("a", server.origin);

        await useProjectStore.getState().fetchProjects("a");

        await until(() => useProjectStore.getState().projects.length === 2);
    });

    test("a mutation on one backend's record is sent on that backend's connection only", async () => {
        const [serverA, serverB] = await attachTwo(
            [project("same", "Repo")],
            [project("same", "Repo")],
        );
        const record = recordOn("b", "same");
        if (!record) throw new Error("b's record is missing");

        await useProjectStore.getState().updateProject(record, { name: "Only on B" });

        expect(serverB.received.map((r) => r.type)).toContain(MSG.PROJECT_UPDATE);
        expect(serverA.received.map((r) => r.type)).not.toContain(MSG.PROJECT_UPDATE);
        expect(recordOn("b", "same")?.name).toBe("Only on B");
        expect(recordOn("a", "same")?.name).toBe("Repo");
    });
});

function task(id: string): Task {
    return {
        id,
        projectId: "1",
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

describe("task store across backends", () => {
    test("a task created while the task list is in flight is listed once", async () => {
        // The machine creates the task, broadcasts TASK_CREATED, then answers a
        // list that already holds it.
        const created = task("t1");
        const server: TestServer = startTestServer("A", (type) => {
            if (type !== MSG.TASK_LIST) return {};
            server.broadcast(MSG.TASK_CREATED, created);
            return { tasks: [created] };
        });
        servers.push(server);
        await openConnection("a", server.origin);

        await useTaskStore.getState().fetchTasks("a");

        expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual(["t1"]);
    });

    test("detaching a machine clears the active task only when it was that machine's", async () => {
        const serverA = startTestServer("A", (type) =>
            type === MSG.TASK_LIST ? { tasks: [task("ta")] } : {},
        );
        const serverB = startTestServer("B", (type) =>
            type === MSG.TASK_LIST ? { tasks: [task("tb")] } : {},
        );
        servers.push(serverA, serverB);
        await openConnection("a", serverA.origin);
        await openConnection("b", serverB.origin);
        await useTaskStore.getState().fetchTasks("a");
        await useTaskStore.getState().fetchTasks("b");

        useTaskStore.getState().setActiveTask("tb");
        closeConnection("a", "detach");
        resetBackend("a");
        expect(useTaskStore.getState().activeTaskId).toBe("tb");

        useTaskStore.getState().setActiveTask("ta");
        // Detaching b does not know ta; only a's own detach may clear it.
        closeConnection("b", "detach");
        resetBackend("b");
        expect(useTaskStore.getState().activeTaskId).toBe("ta");

        await openConnection("a", serverA.origin);
        await useTaskStore.getState().fetchTasks("a");
        closeConnection("a", "detach");
        resetBackend("a");
        expect(useTaskStore.getState().activeTaskId).toBeNull();
    });

    test("a machine attached while the archive is shown lists its archived tasks", async () => {
        const serverA = startTestServer("A", (type) =>
            type === MSG.TASK_LIST ? { tasks: [task("ta")] } : { tasks: [] },
        );
        const serverB = startTestServer("B", (type) =>
            type === MSG.TASK_LIST ? { tasks: [task("tb")] } : { tasks: [task("archived-b")] },
        );
        servers.push(serverA, serverB);
        await openConnection("a", serverA.origin);
        await useTaskStore.getState().fetchTasks("a");
        useTaskStore.getState().setShowArchive(true);

        await openConnection("b", serverB.origin);
        await useTaskStore.getState().fetchTasks("b");

        try {
            await until(() => useTaskStore.getState().archivedTasks.length === 1);
        } finally {
            useTaskStore.getState().setShowArchive(false);
        }
        expect(useTaskStore.getState().archivedTasks.map((t) => `${t.backendId}:${t.id}`)).toEqual([
            "b:archived-b",
        ]);
    });
});

async function openTwo(
    respondA: (type: string, payload: unknown) => unknown,
    respondB: (type: string, payload: unknown) => unknown,
): Promise<[TestServer, TestServer]> {
    const serverA = startTestServer("A", respondA);
    const serverB = startTestServer("B", respondB);
    servers.push(serverA, serverB);
    await openConnection("a", serverA.origin);
    await openConnection("b", serverB.origin);
    return [serverA, serverB];
}

function notification(id: string): Notification {
    return {
        id,
        projectId: "1",
        sessionId: "s1",
        message: id,
        read: false,
        createdAt: "2026-09-13T00:00:00.000Z",
    };
}

describe("the stores the sidebar reads, across backends", () => {
    test("dismissing all notifications clears every attached machine", async () => {
        const [serverA, serverB] = await openTwo(
            (type) =>
                type === MSG.NOTIFICATION_LIST ? { notifications: [notification("na")] } : {},
            (type) =>
                type === MSG.NOTIFICATION_LIST ? { notifications: [notification("nb")] } : {},
        );
        await useNotificationStore.getState().fetchNotifications("a");
        await useNotificationStore.getState().fetchNotifications("b");

        await useNotificationStore.getState().deleteAll();

        const clears = (server: TestServer) =>
            server.received.filter((r) => r.type === MSG.NOTIFICATION_DELETED);
        expect(clears(serverA).map((r) => r.payload)).toEqual([{ all: true }]);
        expect(clears(serverB).map((r) => r.payload)).toEqual([{ all: true }]);
    });

    test("a clear replayed over a list answered after it keeps the notifications created since", async () => {
        let lists = 0;
        const server: TestServer = startTestServer("A", (type) => {
            if (type !== MSG.NOTIFICATION_LIST) return {};
            lists++;
            if (lists === 1) return { notifications: [notification("old")] };
            // The machine clears, broadcasts that, and a new one arrives before it answers.
            server.broadcast(MSG.NOTIFICATION_DELETED, { all: true });
            return { notifications: [notification("new")] };
        });
        servers.push(server);
        await openConnection("a", server.origin);
        await useNotificationStore.getState().fetchNotifications("a");

        await useNotificationStore.getState().fetchNotifications("a");

        expect(useNotificationStore.getState().notifications.map((n) => n.id)).toEqual(["new"]);
    });

    test("detaching a machine drops only its diff badges", async () => {
        const [serverA, serverB] = await openTwo(
            () => ({}),
            () => ({}),
        );
        const stats = {
            additions: 3,
            deletions: 1,
            diffDisabled: false,
            commitDisabled: false,
            hasChanges: true,
            branch: "main",
            ahead: 0,
            behind: 2,
        };
        serverA.broadcast(MSG.GIT_CHANGE_STATS, { targetId: "project-a", stats });
        serverB.broadcast(MSG.GIT_CHANGE_STATS, { targetId: "project-b", stats });
        await until(() => Object.keys(useDiffStore.getState().behindByProject).length === 2);

        closeConnection("a", "detach");
        resetBackend("a");

        const state = useDiffStore.getState();
        expect(Object.keys(state.statsByProject)).toEqual(["project-b"]);
        expect(state.behindByProject).toEqual({ "project-b": 2 });
        expect(state.branchByProject).toEqual({ "project-b": "main" });
    });

    test("a project's run menu offers none of another machine's global flows", async () => {
        const flow = (id: string, projectId?: string): FlowDefinition => ({
            id,
            name: id,
            description: "",
            actions: [],
            createdAt: "2026-09-13T00:00:00.000Z",
            updatedAt: "2026-09-13T00:00:00.000Z",
            ...(projectId ? { projectId } : {}),
        });
        await openTwo(
            (type) => (type === MSG.FLOW_DEFINITIONS_LIST ? { flows: [flow("global-a")] } : {}),
            (type) =>
                type === MSG.FLOW_DEFINITIONS_LIST
                    ? { flows: [flow("global-b"), flow("own-b", "project-b")] }
                    : {},
        );
        await useFlowStore.getState().fetchFlows("a");
        await useFlowStore.getState().fetchFlows("b");

        const offered = filterByProject(useFlowStore.getState().flows, "project-b", "b");

        expect(offered.map((f) => f.id).sort()).toEqual(["global-b", "own-b"]);
    });

    test("each machine's settings are read as its own, and writes go only to primary", async () => {
        const settings = (mode: string) => ({
            general: { confirmBeforeExit: false },
            claude: { permissionMode: mode },
        });
        const [serverA, serverB] = await openTwo(
            (type) =>
                type === MSG.SETTINGS_GET || type === MSG.SETTINGS_UPDATE
                    ? settings("default")
                    : {},
            (type) => (type === MSG.SETTINGS_GET ? settings("plan") : {}),
        );
        setPrimary("a");
        await useSettingsStore.getState().fetchSettings("a");
        await useSettingsStore.getState().fetchSettings("b");

        expect(settingsFor("b")?.claude.permissionMode).toBe("plan");
        expect(useSettingsStore.getState().settings?.claude.permissionMode).toBe("default");

        await useSettingsStore.getState().updateSettings({ editor: { wordWrap: false } });

        expect(serverA.received.map((r) => r.type)).toContain(MSG.SETTINGS_UPDATE);
        expect(serverB.received.map((r) => r.type)).not.toContain(MSG.SETTINGS_UPDATE);
    });

    test("pausing another machine's run reaches that machine and no other", async () => {
        const action = (id: string): ActionDefinition => ({
            id,
            name: id,
            prompt: "",
            sessionType: "claude",
            createdAt: "2026-09-13T00:00:00.000Z",
            updatedAt: "2026-09-13T00:00:00.000Z",
        });
        const [serverA, serverB] = await openTwo(
            (type) => (type === MSG.FLOW_ACTIONS_LIST ? { actions: [action("x")] } : {}),
            (type) =>
                type === MSG.FLOW_START
                    ? {
                          taskId: "task-b",
                          flowId: "flow-b",
                          status: "running",
                          currentActionIndex: 0,
                          actions: [],
                          artifacts: [],
                          startedAt: "2026-09-13T00:00:00.000Z",
                      }
                    : {},
        );
        await useFlowStore.getState().startFlow("b", { taskId: "task-b", flowId: "flow-b" });
        const run = useFlowStore.getState().activeRuns["task-b"];
        if (!run) throw new Error("b's run is missing");

        await useFlowStore.getState().pauseFlow(run.backendId, "task-b", run.flowId);

        expect(run.backendId).toBe("b");
        expect(serverB.received.map((r) => r.type)).toContain(MSG.FLOW_PAUSE);
        expect(serverA.received.map((r) => r.type)).not.toContain(MSG.FLOW_PAUSE);
    });

    test("another machine's master run does not show in primary's master workspace", async () => {
        const run = (owner: { taskId?: string; master?: true }) => ({
            ...owner,
            flowId: "flow-b",
            status: "running",
            currentActionIndex: 0,
            actions: [],
            artifacts: [],
            startedAt: "2026-09-13T00:00:00.000Z",
        });
        const [, serverB] = await openTwo(
            () => ({}),
            () => ({}),
        );
        setPrimary("a");

        serverB.broadcast(MSG.FLOW_RUN_UPDATED, run({ master: true }));
        // Same socket, so this lands after the master run.
        serverB.broadcast(MSG.FLOW_RUN_UPDATED, run({ taskId: "task-b" }));
        await until(() => Boolean(useFlowStore.getState().activeRuns["task-b"]));

        expect(useFlowStore.getState().activeRuns[MASTER_OWNER_ID]).toBeUndefined();
    });
});
