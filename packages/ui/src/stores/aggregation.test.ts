import { afterEach, describe, expect, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Project, Task } from "@taskflow/shared";
import { closeConnection, openConnection } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { useProjectStore } from "./project-store";
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
