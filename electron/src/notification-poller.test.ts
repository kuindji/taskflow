import { beforeEach, expect, test } from "bun:test";
import type { AttachedBackend } from "./attached-backends";
import { createNotificationPoller, type BackendNotification } from "./notification-poller";

const A = "http://127.0.0.1:4101";
const B = "http://127.0.0.1:4102";

let backends: AttachedBackend[];
let lists: Map<string, BackendNotification[]>;
let delivered: { id: string; backendId: () => string | null }[];

function notification(id: string, createdAt: string): BackendNotification {
    return {
        id,
        projectId: "project-1",
        sessionId: "session-1",
        message: id,
        read: false,
        createdAt: `2026-09-13T${createdAt}.000Z`,
    };
}

/** Adds a notification to what `origin` answers, newest first like the backend. */
function emit(origin: string, n: BackendNotification): void {
    lists.set(origin, [n, ...(lists.get(origin) ?? [])]);
}

function makePoller() {
    return createNotificationPoller({
        getAttachedBackends: () => backends,
        fetchNotifications: (origin) => Promise.resolve(lists.get(origin) ?? []),
        notify: (n, backendId) => delivered.push({ id: n.id, backendId }),
    });
}

beforeEach(() => {
    backends = [
        { id: "local", origin: A, isLocal: true },
        { id: "desktop.local:main", origin: B, isLocal: false },
    ];
    lists = new Map();
    delivered = [];
});

test("a machine's notification older than another machine's newest still arrives", async () => {
    const poller = makePoller();
    await poller.poll();

    emit(B, notification("b-1", "10:00:01"));
    await poller.poll();
    emit(A, notification("a-1", "10:00:10"));
    await poller.poll();
    emit(B, notification("b-2", "10:00:05"));
    await poller.poll();

    expect(delivered.map((d) => d.id)).toEqual(["b-1", "a-1", "b-2"]);
    expect(delivered.map((d) => d.backendId())).toEqual([
        "desktop.local:main",
        "local",
        "desktop.local:main",
    ]);
});

test("what a machine already holds when it is first polled is not shown", async () => {
    emit(B, notification("old", "09:00:00"));
    const poller = makePoller();
    await poller.poll();
    await poller.poll();

    expect(delivered).toEqual([]);
});

test("a record renamed at its handshake keeps its watermark and clicks name the new id", async () => {
    const poller = makePoller();
    await poller.poll();
    emit(B, notification("b-1", "10:00:01"));
    await poller.poll();

    backends = [backends[0], { id: "abc123", origin: B, isLocal: false }];
    await poller.poll();

    expect(delivered.map((d) => d.id)).toEqual(["b-1"]);
    expect(delivered[0].backendId()).toBe("abc123");
});

test("a machine detached after showing a notification names no machine on click", async () => {
    const poller = makePoller();
    await poller.poll();
    emit(B, notification("b-1", "10:00:01"));
    await poller.poll();

    backends = [backends[0]];

    expect(delivered[0].backendId()).toBeNull();
});
