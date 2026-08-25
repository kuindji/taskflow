import { describe, expect, it } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Schedule } from "@taskflow/shared";
import type { NetLike } from "../net/client";
import { ScheduleStore } from "./store";

function schedule(id: string, projectId = "p1"): Schedule {
    return {
        id,
        projectId,
        name: id,
        prompt: "echo ok",
        expression: "5m",
        expressionType: "rate",
        timeout: 30,
        enabled: false,
        lastRunAt: null,
        lastError: null,
        nextRunAt: null,
        runningSessionId: null,
        createdAt: "now",
        updatedAt: "now",
    };
}

interface FakeNet extends NetLike {
    emit(type: string, payload: unknown): void;
    respond(type: string, response: unknown): void;
    listenerCount(type: string): number;
}

function fakeNet(): FakeNet {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const responses = new Map<string, unknown[]>();
    return {
        request<T>(type: string): Promise<T> {
            const response = responses.get(type)?.shift();
            if (response instanceof Error) return Promise.reject(response);
            if (response === undefined) return Promise.resolve({ success: true } as T);
            return Promise.resolve(response as T);
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
        respond(type, response) {
            const queue = responses.get(type) ?? [];
            queue.push(response);
            responses.set(type, queue);
        },
        listenerCount(type) {
            return listeners.get(type)?.size ?? 0;
        },
    };
}

describe("ScheduleStore", () => {
    it("removes the previous project's rows before the next owner load resolves", async () => {
        const net = fakeNet();
        net.respond(MSG.SCHEDULE_LIST, { schedules: [schedule("a", "p1")] });
        const store = new ScheduleStore(net);
        await store.load("p1");
        let resolveLoad: ((value: { schedules: Schedule[] }) => void) | undefined;
        net.request = (<T>(type: string): Promise<T> => {
            if (type !== MSG.SCHEDULE_LIST) throw new Error(`unexpected ${type}`);
            return new Promise((resolve) => {
                resolveLoad = resolve as (value: { schedules: Schedule[] }) => void;
            });
        }) as NetLike["request"];

        const loading = store.load("p2");
        expect(store.schedules).toEqual([]);
        resolveLoad?.({ schedules: [schedule("b", "p2")] });
        await loading;
        expect(store.schedules.map((item) => item.id)).toEqual(["b"]);
    });

    it("loads an optional project filter and folds matching updates", async () => {
        const net = fakeNet();
        net.respond(MSG.SCHEDULE_LIST, { schedules: [schedule("s1")] });
        const store = new ScheduleStore(net);
        await store.load("p1");
        net.emit(MSG.SCHEDULE_UPDATED, { ...schedule("s1"), enabled: true });
        net.emit(MSG.SCHEDULE_UPDATED, schedule("other", "p2"));
        expect(store.filterProjectId).toBe("p1");
        expect(store.schedules).toEqual([{ ...schedule("s1"), enabled: true }]);
    });

    it("changes local state only after successful mutations", async () => {
        const net = fakeNet();
        net.respond(MSG.SCHEDULE_LIST, { schedules: [schedule("s1")] });
        const store = new ScheduleStore(net);
        await store.load();
        net.respond(MSG.SCHEDULE_UPDATE, new Error("update failed"));
        // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test .rejects.toThrow() returns a Promise at runtime
        await expect(store.update({ id: "s1", enabled: true })).rejects.toThrow("update failed");
        expect(store.schedules[0]?.enabled).toBe(false);
        net.respond(MSG.SCHEDULE_UPDATE, { ...schedule("s1"), enabled: true });
        await store.update({ id: "s1", enabled: true });
        expect(store.schedules[0]?.enabled).toBe(true);
    });

    it("subscribes once and disposes idempotently", () => {
        const net = fakeNet();
        const store = new ScheduleStore(net);
        expect(net.listenerCount(MSG.SCHEDULE_UPDATED)).toBe(1);
        store.dispose();
        store.dispose();
        expect(net.listenerCount(MSG.SCHEDULE_UPDATED)).toBe(0);
    });

    it("prevents an older project response from replacing a newer load", async () => {
        const resolvers: Array<(value: { schedules: Schedule[] }) => void> = [];
        const net: NetLike = {
            request<T>(): Promise<T> {
                return new Promise((resolve) => resolvers.push(resolve as never));
            },
            on: () => () => undefined,
            onStatusChange: () => () => undefined,
        };
        const store = new ScheduleStore(net);
        const first = store.load("p1");
        const second = store.load("p2");
        resolvers[1]?.({ schedules: [schedule("new", "p2")] });
        await second;
        resolvers[0]?.({ schedules: [schedule("stale", "p1")] });
        await first;
        expect(store.filterProjectId).toBe("p2");
        expect(store.schedules.map((item) => item.id)).toEqual(["new"]);
    });
});
