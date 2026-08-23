import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Project, Task } from "@taskflow/shared";
import { Store } from "./store";
import type { NetLike } from "../net/client";

function project(id: string, name: string): Project {
    return { id, name, path: `/tmp/${id}`, sessions: [], attributes: [], createdAt: "" };
}

function task(id: string, projectId: string, title: string): Task {
    return {
        id,
        projectId,
        title,
        description: "",
        notes: "",
        worktree: { enabled: false, path: null, branch: null, pr: null },
        sessions: [],
        attributes: [],
        createdAt: "",
        status: "active",
        archivedAt: null,
        pinned: false,
    };
}

interface FakeNet extends NetLike {
    emit(type: string, payload: unknown): void;
}

function fakeNet(projects: Project[], tasks: Task[]): FakeNet {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    return {
        request<T>(type: string): Promise<T> {
            if (type === MSG.PROJECT_LIST) return Promise.resolve({ projects } as T);
            if (type === MSG.TASK_LIST) return Promise.resolve({ tasks } as T);
            return Promise.reject(new Error(`no stub for ${type}`));
        },
        onStatusChange: () => () => undefined,
        on(type, handler) {
            let set = listeners.get(type);
            if (!set) {
                set = new Set();
                listeners.set(type, set);
            }
            set.add(handler);
            return () => {
                set.delete(handler);
            };
        },
        emit(type, payload) {
            for (const handler of listeners.get(type) ?? []) handler(payload);
        },
    };
}

describe("Store", () => {
    test("loads projects and tasks", async () => {
        const store = new Store(fakeNet([project("p1", "One")], [task("t1", "p1", "Task")]));
        await store.load();
        expect(store.projects).toHaveLength(1);
        expect(store.tasksFor("p1").map((t) => t.id)).toEqual(["t1"]);
        store.dispose();
    });

    test("applies a task update in place and notifies listeners", async () => {
        const net = fakeNet([project("p1", "One")], [task("t1", "p1", "Old")]);
        const store = new Store(net);
        await store.load();
        let notified = 0;
        store.onChange(() => notified++);
        net.emit(MSG.TASK_UPDATED, task("t1", "p1", "New"));
        expect(store.tasksFor("p1")[0]?.title).toBe("New");
        expect(notified).toBe(1);
        store.dispose();
    });

    test("appends a created task", async () => {
        const net = fakeNet([project("p1", "One")], []);
        const store = new Store(net);
        await store.load();
        net.emit(MSG.TASK_CREATED, task("t2", "p1", "Fresh"));
        expect(store.tasksFor("p1")).toHaveLength(1);
        store.dispose();
    });

    test("excludes archived tasks from tasksFor", async () => {
        const archived = { ...task("t3", "p1", "Gone"), status: "archived" as const };
        const store = new Store(fakeNet([project("p1", "One")], [archived]));
        await store.load();
        expect(store.tasksFor("p1")).toHaveLength(0);
        store.dispose();
    });

    test("stops notifying after unsubscribe", async () => {
        const net = fakeNet([project("p1", "One")], []);
        const store = new Store(net);
        await store.load();
        let notified = 0;
        const off = store.onChange(() => notified++);
        off();
        net.emit(MSG.TASK_CREATED, task("t4", "p1", "X"));
        expect(notified).toBe(0);
        store.dispose();
    });
});
