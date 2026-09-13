import { afterEach, describe, expect, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Project } from "@taskflow/shared";
import { closeConnection, openConnection } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { useProjectStore } from "./project-store";
import { resetBackend } from "./store-reset";

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
