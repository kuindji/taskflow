import { describe, expect, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Task, TaskLogEntry } from "@taskflow/shared";
import type { NetLike } from "../net/client";
import { TaskDetailStore } from "./store";

function entry(id: string, timestamp: string): TaskLogEntry {
    return { id, sessionId: "s1", timestamp, type: "info", message: id };
}

function task(id: string): Task {
    return {
        id,
        projectId: "p1",
        title: id,
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

function controlledNet(): NetLike & {
    emit(type: string, payload: unknown): void;
    resolve(taskId: string, entries: TaskLogEntry[]): void;
    requests: Array<{ type: string; payload: unknown }>;
} {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const pending = new Map<string, (value: unknown) => void>();
    const requests: Array<{ type: string; payload: unknown }> = [];
    return {
        requests,
        request<T>(type: string, payload?: unknown): Promise<T> {
            requests.push({ type, payload });
            if (type !== MSG.TASK_LOG_LIST) return Promise.resolve(task("saved") as T);
            const taskId = (payload as { taskId: string }).taskId;
            return new Promise<T>((resolve) => pending.set(taskId, resolve as (value: unknown) => void));
        },
        on(type, handler) {
            const set = listeners.get(type) ?? new Set();
            set.add(handler);
            listeners.set(type, set);
            return () => set.delete(handler);
        },
        onStatusChange: () => () => undefined,
        emit(type, payload) {
            for (const handler of listeners.get(type) ?? []) handler(payload);
        },
        resolve(taskId, entries) {
            pending.get(taskId)?.({ entries });
        },
    };
}

describe("TaskDetailStore", () => {
    test("ignores a late load from a previous selection and retains snapshots", async () => {
        const net = controlledNet();
        const store = new TaskDetailStore(net);
        const first = store.loadLogs("t1");
        const second = store.loadLogs("t2");
        net.resolve("t2", [entry("two", "2026-01-02")]);
        await second;
        net.resolve("t1", [entry("one", "2026-01-01")]);
        await first;
        expect(store.logsFor("t1")).toEqual([]);
        expect(store.logsFor("t2").map((item) => item.id)).toEqual(["two"]);

        const reload = store.loadLogs("t1");
        net.resolve("t1", []);
        await reload;
        store.dispose();
    });

    test("does not overwrite a broadcast that overlaps a load", async () => {
        const net = controlledNet();
        const store = new TaskDetailStore(net);
        const loading = store.loadLogs("t1");
        net.emit(MSG.TASK_LOG_ADDED, { taskId: "t1", entry: entry("live", "2026-01-03") });
        net.resolve("t1", [entry("stale", "2026-01-01")]);
        await loading;
        expect(store.logsFor("t1").map((item) => item.id)).toEqual(["live"]);
        store.dispose();
    });

    test("keeps logs chronological and de-duplicates repeated broadcasts", () => {
        const net = controlledNet();
        const store = new TaskDetailStore(net);
        net.emit(MSG.TASK_LOG_ADDED, { taskId: "t1", entry: entry("later", "2026-01-03") });
        net.emit(MSG.TASK_LOG_ADDED, { taskId: "t1", entry: entry("early", "2026-01-01") });
        net.emit(MSG.TASK_LOG_ADDED, { taskId: "t1", entry: entry("later", "2026-01-03") });
        expect(store.logsFor("t1").map((item) => item.id)).toEqual(["early", "later"]);
        store.dispose();
    });

    test("returns backend records for task and attribute mutations", async () => {
        const net = controlledNet();
        const store = new TaskDetailStore(net);
        expect(await store.create({ projectId: "p1", title: "New", description: "" })).toEqual(
            task("saved"),
        );
        expect(await store.update({ id: "t1", notes: "note" })).toEqual(task("saved"));
        expect(await store.archive("t1")).toEqual(task("saved"));
        expect(await store.createAttribute({ taskId: "t1", name: "env" })).toEqual(
            task("saved"),
        );
        expect(await store.updateAttribute({ taskId: "t1", attrId: "a1", value: "x" })).toEqual(
            task("saved"),
        );
        expect(await store.deleteAttribute({ taskId: "t1", attrId: "a1" })).toEqual(
            task("saved"),
        );
        expect(net.requests.map((request) => request.type)).toEqual([
            MSG.TASK_CREATE,
            MSG.TASK_UPDATE,
            MSG.TASK_ARCHIVE,
            MSG.ATTR_CREATE,
            MSG.ATTR_UPDATE,
            MSG.ATTR_DELETE,
        ]);
        store.dispose();
    });
});
