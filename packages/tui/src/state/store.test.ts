import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Project, SessionRef, Task } from "@taskflow/shared";
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
    listenerCount(type: string): number;
}

function fakeNet(projects: Project[], tasks: Task[], masterSessions: SessionRef[] = []): FakeNet {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    return {
        request<T>(type: string): Promise<T> {
            if (type === MSG.PROJECT_LIST) return Promise.resolve({ projects } as T);
            if (type === MSG.TASK_LIST) return Promise.resolve({ tasks } as T);
            if (type === MSG.MASTER_SESSIONS_LIST)
                return Promise.resolve({ sessions: masterSessions } as T);
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
        listenerCount(type) {
            return listeners.get(type)?.size ?? 0;
        },
    };
}

/**
 * A net whose two snapshot requests settle independently, so a test can emit a
 * broadcast in the window between the first response and the second.
 */
function slowNet(
    projects: Project[],
    tasks: Task[],
    masterSessions: SessionRef[] = [],
): FakeNet & { resolveProjects(): void } {
    const net = fakeNet(projects, tasks, masterSessions);
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    return {
        ...net,
        request<T>(type: string): Promise<T> {
            if (type === MSG.PROJECT_LIST) return gate.then(() => ({ projects }) as T);
            return net.request<T>(type);
        },
        resolveProjects: () => {
            release();
        },
    };
}

/**
 * A net that serves one snapshot pair per `load()` call, each behind its own
 * gate, so a test can resolve a later load before an earlier one.
 */
function stagedNet(
    rounds: { projects: Project[]; tasks: Task[]; masterSessions?: SessionRef[] }[],
    failing: number[] = [],
): FakeNet & { release(round: number): void } {
    const base = fakeNet([], []);
    const gates = rounds.map((round, index) => {
        let release = (): void => undefined;
        const opened = new Promise<void>((resolve) => {
            release = resolve;
        });
        return { round, opened, release, fails: failing.includes(index) };
    });
    let projectCall = 0;
    let taskCall = 0;
    let masterCall = 0;
    return {
        ...base,
        request<T>(type: string): Promise<T> {
            if (type === MSG.PROJECT_LIST) {
                const gate = gates[projectCall++];
                if (!gate) throw new Error("stagedNet: no snapshot left for PROJECT_LIST");
                return gate.opened.then(() => {
                    if (gate.fails) throw new Error("snapshot failed");
                    return { projects: gate.round.projects } as T;
                });
            }
            if (type === MSG.TASK_LIST) {
                const gate = gates[taskCall++];
                if (!gate) throw new Error("stagedNet: no snapshot left for TASK_LIST");
                return gate.opened.then(() => {
                    if (gate.fails) throw new Error("snapshot failed");
                    return { tasks: gate.round.tasks } as T;
                });
            }
            if (type === MSG.MASTER_SESSIONS_LIST) {
                const gate = gates[masterCall++];
                if (!gate) throw new Error("stagedNet: no snapshot left for MASTER_SESSIONS_LIST");
                return gate.opened.then(() => {
                    if (gate.fails) throw new Error("snapshot failed");
                    return { sessions: gate.round.masterSessions ?? [] } as T;
                });
            }
            return base.request<T>(type);
        },
        release(round) {
            const gate = gates[round];
            if (!gate) throw new Error(`stagedNet: no gate ${String(round)}`);
            gate.release();
        },
    };
}

/** Let an internally started `load()` settle before asserting on the store. */
async function flush(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe("Store", () => {
    test("loads projects and tasks", async () => {
        const store = new Store(fakeNet([project("p1", "One")], [task("t1", "p1", "Task")]));
        await store.load();
        expect(store.projects).toHaveLength(1);
        expect(store.tasksFor("p1").map((t) => t.id)).toEqual(["t1"]);
        store.dispose();
    });

    test("loads master sessions in the same snapshot", async () => {
        const master = { id: "m1", type: "shell" as const, label: "Shell", createdAt: "now" };
        const store = new Store(fakeNet([], [], [master]));
        await store.load();
        expect(store.masterSessions).toEqual([master]);
        store.dispose();
    });

    test("replays a master-session broadcast over an in-flight snapshot", async () => {
        const stale = { id: "old", type: "shell" as const, label: "Old", createdAt: "now" };
        const fresh = { id: "new", type: "shell" as const, label: "New", createdAt: "now" };
        const net = slowNet([], [], [stale]);
        const store = new Store(net);
        const loading = store.load();
        net.emit(MSG.MASTER_SESSIONS_LIST, { sessions: [fresh] });
        net.resolveProjects();
        await loading;
        expect(store.masterSessions).toEqual([fresh]);
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
    test("removes a project's tasks when the project is removed", async () => {
        const net = fakeNet(
            [project("p1", "One"), project("p2", "Two")],
            [task("t1", "p1", "A"), task("t2", "p2", "B")],
        );
        const store = new Store(net);
        await store.load();
        net.emit(MSG.PROJECT_REMOVED, { id: "p1" });
        expect(store.projects.map((p) => p.id)).toEqual(["p2"]);
        expect(store.tasks.map((t) => t.id)).toEqual(["t2"]);
        store.dispose();
    });

    test("hides projects flagged hidden", async () => {
        const hidden = { ...project("p9", "Hidden"), hidden: true };
        const store = new Store(fakeNet([project("p1", "One"), hidden], []));
        await store.load();
        expect(store.projects.map((p) => p.id)).toEqual(["p1"]);
        store.dispose();
    });

    test("keeps an event that arrived while load() was in flight", async () => {
        const net = slowNet([project("p1", "One")], []);
        const store = new Store(net);
        const loading = store.load();
        // The TASK_LIST snapshot has already resolved without t7; the
        // PROJECT_LIST one has not, so this event lands mid-load.
        net.emit(MSG.TASK_CREATED, task("t7", "p1", "Raced"));
        net.resolveProjects();
        await loading;
        expect(store.tasksFor("p1").map((t) => t.id)).toEqual(["t7"]);
        store.dispose();
    });

    test("dispose detaches the backend event subscriptions", async () => {
        const net = fakeNet([project("p1", "One")], []);
        const store = new Store(net);
        await store.load();
        expect(net.listenerCount(MSG.TASK_CREATED)).toBe(1);
        store.dispose();
        expect(net.listenerCount(MSG.TASK_CREATED)).toBe(0);
        net.emit(MSG.TASK_CREATED, task("t8", "p1", "After dispose"));
        expect(store.tasksFor("p1")).toHaveLength(0);
    });
    test("a superseded load() does not overwrite the newer snapshot", async () => {
        const net = stagedNet([
            { projects: [project("p1", "One")], tasks: [] },
            { projects: [project("p1", "One")], tasks: [task("t2", "p1", "New")] },
        ]);
        const store = new Store(net);
        const first = store.load();
        const second = store.load();
        // The second load settles first and commits the newer snapshot.
        net.release(1);
        await second;
        expect(store.tasksFor("p1").map((t) => t.id)).toEqual(["t2"]);
        // The first load settles late; its snapshot is older and must be dropped.
        net.release(0);
        await first;
        expect(store.tasksFor("p1").map((t) => t.id)).toEqual(["t2"]);
        store.dispose();
    });
    test("an event that arrives after the newest load was issued survives its snapshot", async () => {
        const net = stagedNet([
            { projects: [project("p1", "One")], tasks: [] },
            { projects: [project("p1", "One")], tasks: [] },
        ]);
        const store = new Store(net);
        const first = store.load();
        const second = store.load();
        // Lands after both requests went out, so neither snapshot can contain it.
        net.emit(MSG.TASK_CREATED, task("t5", "p1", "Queued"));
        net.release(1);
        await second;
        net.release(0);
        await first;
        expect(store.tasksFor("p1").map((t) => t.id)).toEqual(["t5"]);
        store.dispose();
    });

    test("does not replay an event the newer snapshot already covers", async () => {
        const net = stagedNet([
            { projects: [project("p1", "One")], tasks: [task("t1", "p1", "Original")] },
            { projects: [project("p1", "One")], tasks: [task("t1", "p1", "New")] },
        ]);
        const store = new Store(net);
        const first = store.load();
        // Broadcast before the second load's requests went out, so the second
        // snapshot is built from a backend that has already applied it.
        net.emit(MSG.TASK_UPDATED, task("t1", "p1", "Old"));
        const second = store.load();
        net.release(1);
        await second;
        net.release(0);
        await first;
        expect(store.tasksFor("p1")[0]?.title).toBe("New");
        store.dispose();
    });

    test("keeps a queued event when the load that would cover it fails", async () => {
        const net = stagedNet([{ projects: [], tasks: [] }], [0]);
        const store = new Store(net);
        const loading = store.load();
        net.emit(MSG.TASK_CREATED, task("t6", "p1", "Queued"));
        net.release(0);
        let failure = "";
        try {
            await loading;
        } catch (err) {
            failure = err instanceof Error ? err.message : String(err);
        }
        expect(failure).toBe("snapshot failed");
        expect(store.tasks.map((t) => t.id)).toEqual(["t6"]);
        store.dispose();
    });

    test("applies a project reorder broadcast", async () => {
        const net = fakeNet([project("p1", "One"), project("p2", "Two")], []);
        const store = new Store(net);
        await store.load();
        net.emit(MSG.PROJECT_REORDERED, { orderedIds: ["p2", "p1"] });
        expect(store.projects.map((p) => p.id)).toEqual(["p2", "p1"]);
        store.dispose();
    });

    test("archives a parent's subtasks when only the parent archive is broadcast", async () => {
        const parent: Task = {
            ...task("parent", "p1", "Parent"),
            createdAt: "2026-01-01T00:00:00Z",
        };
        const child: Task = {
            ...task("child", "p1", "Child"),
            parentId: "parent",
            createdAt: "2026-02-01T00:00:00Z",
        };
        const net = fakeNet([project("p1", "One")], [parent, child]);
        const store = new Store(net);
        await store.load();
        net.emit(MSG.TASK_UPDATED, {
            ...parent,
            status: "archived",
            archivedAt: "2026-08-23T00:00:00Z",
        });
        expect(store.tasksFor("p1").map((t) => t.id)).toEqual([]);
        store.dispose();
    });

    test("restores a parent's subtasks when the parent is unarchived", async () => {
        const parent: Task = {
            ...task("parent", "p1", "Parent"),
            createdAt: "2026-01-01T00:00:00Z",
        };
        const child: Task = {
            ...task("child", "p1", "Child"),
            parentId: "parent",
            createdAt: "2026-02-01T00:00:00Z",
        };
        const net = fakeNet([project("p1", "One")], [parent, child]);
        const store = new Store(net);
        await store.load();
        net.emit(MSG.TASK_UPDATED, {
            ...parent,
            status: "archived",
            archivedAt: "2026-08-23T00:00:00Z",
        });
        net.emit(MSG.TASK_UPDATED, { ...parent, status: "active", archivedAt: null });
        // Newest first, so the subtask sorts above the parent it was added to.
        expect(store.tasksFor("p1").map((t) => t.id)).toEqual(["child", "parent"]);
        store.dispose();
    });

    test("leaves subtasks alone when a parent update does not change its status", async () => {
        const parent: Task = {
            ...task("parent", "p1", "Parent"),
            createdAt: "2026-01-01T00:00:00Z",
        };
        const child: Task = {
            ...task("child", "p1", "Child"),
            parentId: "parent",
            createdAt: "2026-02-01T00:00:00Z",
        };
        const archivedChild: Task = {
            ...task("other", "p1", "Archived child"),
            parentId: "parent",
            createdAt: "2026-03-01T00:00:00Z",
            status: "archived",
            archivedAt: "2026-08-23T00:00:00Z",
        };
        const net = fakeNet([project("p1", "One")], [parent, child, archivedChild]);
        const store = new Store(net);
        await store.load();
        net.emit(MSG.TASK_UPDATED, { ...parent, title: "Renamed" });
        expect(store.tasksFor("p1").map((t) => t.id)).toEqual(["child", "parent"]);
        store.dispose();
    });

    test("orders a newly created task by creation time, not arrival", async () => {
        const older: Task = { ...task("t-old", "p1", "Older"), createdAt: "2026-01-01T00:00:00Z" };
        const newer: Task = { ...task("t-new", "p1", "Newer"), createdAt: "2026-06-01T00:00:00Z" };
        const net = fakeNet([project("p1", "One")], [older]);
        const store = new Store(net);
        await store.load();
        net.emit(MSG.TASK_CREATED, newer);
        expect(store.tasksFor("p1").map((t) => t.id)).toEqual(["t-new", "t-old"]);
        store.dispose();
    });

    test("floats a task to the top when it is pinned", async () => {
        const newer: Task = { ...task("t1", "p1", "Newer"), createdAt: "2026-06-01T00:00:00Z" };
        const older: Task = { ...task("t2", "p1", "Older"), createdAt: "2026-01-01T00:00:00Z" };
        const net = fakeNet([project("p1", "One")], [newer, older]);
        const store = new Store(net);
        await store.load();
        net.emit(MSG.TASK_UPDATED, { ...older, pinned: true });
        expect(store.tasksFor("p1").map((t) => t.id)).toEqual(["t2", "t1"]);
        store.dispose();
    });

    test("refetches subtasks the backend restores with an unarchived parent", async () => {
        const parent: Task = {
            ...task("parent", "p1", "Parent"),
            createdAt: "2026-01-01T00:00:00Z",
        };
        const child: Task = {
            ...task("child", "p1", "Child"),
            parentId: "parent",
            createdAt: "2026-02-01T00:00:00Z",
        };
        // The first snapshot is taken while the whole family is archived, so
        // TASK_LIST — which serves active tasks only — carries none of it.
        const net = stagedNet([
            { projects: [project("p1", "One")], tasks: [] },
            { projects: [project("p1", "One")], tasks: [parent, child] },
        ]);
        const store = new Store(net);
        const loading = store.load();
        net.release(0);
        await loading;
        net.emit(MSG.TASK_UPDATED, parent);
        net.release(1);
        await flush();
        expect([...store.tasksFor("p1")].map((t) => t.id).sort()).toEqual(["child", "parent"]);
        store.dispose();
    });
});
