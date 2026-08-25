import { describe, expect, test } from "bun:test";
import { MSG, type Notification } from "@taskflow/shared";
import type { NetLike } from "../net/client";
import { NotificationStore } from "./store";

function notification(id: string, read = false): Notification {
    return {
        id,
        projectId: "p1",
        sessionId: "s1",
        message: id,
        read,
        createdAt: `2026-08-25T00:00:0${id.length}.000Z`,
    };
}

function fakeNet(): NetLike & {
    requests: Array<{ type: string; payload: unknown }>;
    emit(type: string, payload: unknown): void;
    resolveList(notifications: Notification[]): void;
} {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const requests: Array<{ type: string; payload: unknown }> = [];
    let resolveList = (_value: unknown): void => undefined;
    return {
        requests,
        request<T>(type: string, payload?: unknown): Promise<T> {
            requests.push({ type, payload });
            if (type !== MSG.NOTIFICATION_LIST) return Promise.resolve({ success: true } as T);
            return new Promise<T>((resolve) => {
                resolveList = resolve as (value: unknown) => void;
            });
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
        resolveList(notifications) {
            resolveList({ notifications });
        },
    };
}

describe("NotificationStore", () => {
    test("folds live events over a snapshot and updates unread state before delivery", async () => {
        const net = fakeNet();
        const deliveredAtUnread: number[] = [];
        const store = new NotificationStore(net, () => {
            deliveredAtUnread.push(store.unreadCount);
        });
        const loading = store.load();
        net.emit(MSG.NOTIFICATION_CREATED, { notification: notification("live") });
        expect(deliveredAtUnread).toEqual([]);
        net.resolveList([notification("stale", true)]);
        await loading;
        expect(store.notifications.map((item) => item.id)).toEqual(["stale", "live"]);
        expect(store.unreadCount).toBe(1);
        expect(deliveredAtUnread).toEqual([1]);
        store.dispose();
    });

    test("does not deliver an initial or reconnect snapshot", async () => {
        const firstNet = fakeNet();
        const delivered: string[] = [];
        const store = new NotificationStore(firstNet, (item) => {
            delivered.push(item.id);
        });
        const first = store.load();
        firstNet.resolveList([notification("old")]);
        await first;
        const second = store.load();
        firstNet.resolveList([notification("old"), notification("older")]);
        await second;
        expect(delivered).toEqual([]);
        store.dispose();
    });

    test("mirrors update and delete broadcasts", async () => {
        const net = fakeNet();
        const store = new NotificationStore(net);
        const loading = store.load();
        net.resolveList([notification("one"), notification("two", true)]);
        await loading;
        net.emit(MSG.NOTIFICATION_UPDATED, { notification: notification("one", true) });
        expect(store.unreadCount).toBe(0);
        net.emit(MSG.NOTIFICATION_DELETED, { id: "two" });
        expect(store.notifications.map((item) => item.id)).toEqual(["one"]);
        net.emit(MSG.NOTIFICATION_DELETED, { all: true });
        expect(store.notifications).toEqual([]);
        store.dispose();
    });

    test("marks all unread and clears only read records through existing messages", async () => {
        const net = fakeNet();
        const store = new NotificationStore(net);
        const loading = store.load();
        net.resolveList([notification("unread"), notification("read", true)]);
        await loading;
        await store.markAllRead();
        await store.clearRead();
        expect(net.requests.slice(1)).toEqual([
            { type: MSG.NOTIFICATION_UPDATED, payload: { id: "unread" } },
            { type: MSG.NOTIFICATION_DELETED, payload: { id: "read" } },
        ]);
        store.dispose();
    });
});
