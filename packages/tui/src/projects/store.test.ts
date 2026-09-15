import { describe, expect, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Project, Task } from "@taskflow/shared";
import { Store } from "../state/store";
import type { NetLike } from "../net/client";
import { project, task } from "../opentui/test-helpers";
import { ProjectStore } from "./store";

type Responder = (payload: unknown) => unknown;

function fakeNet(projects: Project[], tasks: Task[]) {
    const requests: Array<{ type: string; payload: unknown }> = [];
    const responders = new Map<string, Responder>([
        [MSG.PROJECT_LIST, () => ({ projects })],
        [MSG.TASK_LIST, () => ({ tasks })],
        [MSG.MASTER_SESSIONS_LIST, () => ({ sessions: [] })],
    ]);
    const net: NetLike = {
        request<T>(type: string, payload?: unknown): Promise<T> {
            requests.push({ type, payload });
            const responder = responders.get(type);
            if (!responder) return Promise.reject(new Error(`no stub for ${type}`));
            return Promise.resolve().then(() => responder(payload) as T);
        },
        on: () => () => undefined,
        onStatusChange: () => () => undefined,
    };
    const sent = (type: string) =>
        requests.filter((request) => request.type === type).map((request) => request.payload);
    return { net, responders, sent };
}

async function setup(projects: Project[], tasks: Task[] = []) {
    const fake = fakeNet(projects, tasks);
    const store = new Store(fake.net);
    await store.load();
    return { ...fake, store, projectStore: new ProjectStore(fake.net, store) };
}

describe("ProjectStore", () => {
    test("add applies the returned project", async () => {
        const { store, projectStore, responders, sent } = await setup([project("p1", "One")]);
        responders.set(MSG.PROJECT_ADD, () => project("p2", "Two"));

        const added = await projectStore.add("/tmp/p2");

        expect(added.id).toBe("p2");
        expect(sent(MSG.PROJECT_ADD)).toEqual([{ path: "/tmp/p2" }]);
        expect(store.projects.map((p) => p.id)).toEqual(["p1", "p2"]);

        responders.set(MSG.PROJECT_ADD, () => project("p3", "Named"));
        await projectStore.add("/tmp/p3", "Named");
        expect(sent(MSG.PROJECT_ADD)[1]).toEqual({ path: "/tmp/p3", name: "Named" });
    });

    test("hide removes it from the visible projects", async () => {
        const { store, projectStore, responders, sent } = await setup([
            project("p1", "One"),
            project("p2", "Two"),
        ]);
        responders.set(MSG.PROJECT_UPDATE, (payload) => ({
            ...project("p1", "One"),
            ...(payload as object),
        }));

        const hidden = await projectStore.hide("p1");

        expect(hidden.hidden).toBe(true);
        expect(sent(MSG.PROJECT_UPDATE)).toEqual([{ id: "p1", hidden: true }]);
        expect(store.projects.map((p) => p.id)).toEqual(["p2"]);
        expect(store.projectById("p1")?.hidden).toBe(true);
    });

    test("remove drops the project and its tasks", async () => {
        const { store, projectStore, responders, sent } = await setup(
            [project("p1", "One"), project("p2", "Two")],
            [task("t1", "p1", "Gone"), task("t2", "p2", "Kept")],
        );
        responders.set(MSG.PROJECT_REMOVE, () => ({ success: true }));

        await projectStore.remove("p1");

        expect(sent(MSG.PROJECT_REMOVE)).toEqual([{ id: "p1" }]);
        expect(store.projectById("p1")).toBeNull();
        expect(store.tasks.map((t) => t.id)).toEqual(["t2"]);
    });

    test("reorder applies at once and rolls back when the request rejects", async () => {
        const hiddenProject = { ...project("h", "Hidden"), hidden: true };
        const { store, projectStore, responders, sent } = await setup([
            project("p1", "One"),
            hiddenProject,
            project("p2", "Two"),
        ]);
        let reject: (error: Error) => void = () => undefined;
        const pending = new Promise<never>((_resolve, rejectRequest) => {
            reject = rejectRequest;
        });
        responders.set(MSG.PROJECT_REORDER, () => pending);

        const reorder = projectStore.reorder(["p2", "p1"]);

        expect(store.projects.map((p) => p.id)).toEqual(["p2", "p1"]);
        expect(sent(MSG.PROJECT_REORDER)).toEqual([{ orderedIds: ["p2", "h", "p1"] }]);

        reject(new Error("reorder failed"));
        let failure: unknown = null;
        await reorder.catch((error: unknown) => {
            failure = error;
        });
        expect(failure).toBeInstanceOf(Error);
        expect(store.projects.map((p) => p.id)).toEqual(["p1", "p2"]);
        expect(store.projectOrder).toEqual(["p1", "h", "p2"]);
    });

    test("setLinks sends only the id and the links", async () => {
        const { store, projectStore, responders, sent } = await setup([
            project("p1", "One"),
            project("p2", "Two"),
        ]);
        const links = [{ projectId: "p2", note: "API" }];
        responders.set(MSG.PROJECT_UPDATE, () => ({
            ...project("p1", "One"),
            linkedProjects: links,
        }));

        const updated = await projectStore.setLinks("p1", links);

        expect(sent(MSG.PROJECT_UPDATE)).toEqual([{ id: "p1", linkedProjects: links }]);
        expect(updated.linkedProjects).toEqual(links);
        expect(store.projectById("p1")?.linkedProjects).toEqual(links);
    });
});
