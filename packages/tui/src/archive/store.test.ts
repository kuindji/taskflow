import { describe, expect, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Task } from "@taskflow/shared";
import { FakeNet, task } from "../opentui/test-helpers";
import { ArchiveStore } from "./store";

function archived(id: string, parentId?: string): Task {
    return {
        ...task(id, "p1", id),
        status: "archived",
        archivedAt: "2026-09-01T10:00:00.000Z",
        ...(parentId ? { parentId } : {}),
    };
}

describe("ArchiveStore", () => {
    test("load returns the payload tasks as they arrive", async () => {
        const net = new FakeNet();
        const tasks = [archived("s1", "a1"), archived("a1"), archived("a2")];
        net.responses.set(MSG.TASK_LIST_ARCHIVED, { tasks });
        const store = new ArchiveStore(net);

        const loaded = await store.load();

        expect(loaded).toEqual(tasks);
        expect(store.tasks()).toEqual(tasks);
        expect(net.requests).toEqual([{ type: MSG.TASK_LIST_ARCHIVED, payload: undefined }]);
    });

    test("unarchive removes the parent and its archived subtasks", async () => {
        const net = new FakeNet();
        net.responses.set(MSG.TASK_LIST_ARCHIVED, {
            tasks: [archived("a1"), archived("s1", "a1"), archived("s2", "a1"), archived("a2")],
        });
        net.responses.set(MSG.TASK_UNARCHIVE, { ...archived("a1"), status: "active" });
        const store = new ArchiveStore(net);
        await store.load();

        const restored = await store.unarchive("a1");

        expect(restored.status).toBe("active");
        expect(net.requests.at(-1)).toEqual({ type: MSG.TASK_UNARCHIVE, payload: { id: "a1" } });
        expect(store.tasks().map((candidate) => candidate.id)).toEqual(["a2"]);
    });

    test("delete re-checks the archive, then sends exactly the id and deleteWorktree", async () => {
        const net = new FakeNet();
        net.responses.set(MSG.TASK_LIST_ARCHIVED, {
            tasks: [archived("a1"), archived("s1", "a1"), archived("a2")],
        });
        net.responses.set(MSG.TASK_DELETE, { success: true });
        const store = new ArchiveStore(net);
        await store.load();

        expect(await store.delete("a1", true)).toBe("deleted");
        net.responses.set(MSG.TASK_LIST_ARCHIVED, { tasks: [archived("a2")] });
        expect(await store.delete("a2", false)).toBe("deleted");

        expect(net.requests.slice(1)).toEqual([
            { type: MSG.TASK_LIST_ARCHIVED, payload: undefined },
            { type: MSG.TASK_DELETE, payload: { id: "a1", deleteWorktree: true } },
            { type: MSG.TASK_LIST_ARCHIVED, payload: undefined },
            { type: MSG.TASK_DELETE, payload: { id: "a2", deleteWorktree: false } },
        ]);
        expect(store.tasks()).toEqual([]);
    });

    test("delete sends nothing for a task that is no longer archived and drops its row", async () => {
        const net = new FakeNet();
        net.responses.set(MSG.TASK_LIST_ARCHIVED, { tasks: [archived("a1"), archived("a2")] });
        net.responses.set(MSG.TASK_DELETE, { success: true });
        const store = new ArchiveStore(net);
        await store.load();
        // Another client restored a2: it is active on the backend now.
        net.responses.set(MSG.TASK_LIST_ARCHIVED, { tasks: [archived("a1")] });

        expect(await store.delete("a2", true)).toBe("not-archived");

        expect(net.requests.filter((request) => request.type === MSG.TASK_DELETE)).toEqual([]);
        expect(store.tasks().map((candidate) => candidate.id)).toEqual(["a1"]);
    });

    test("clear forgets the cached archive", async () => {
        const net = new FakeNet();
        net.responses.set(MSG.TASK_LIST_ARCHIVED, { tasks: [archived("a1")] });
        const store = new ArchiveStore(net);
        await store.load();

        store.clear();

        expect(store.tasks()).toEqual([]);
    });

    test("removeLocal drops only the given ids", async () => {
        const net = new FakeNet();
        net.responses.set(MSG.TASK_LIST_ARCHIVED, { tasks: [archived("a1"), archived("a2")] });
        const store = new ArchiveStore(net);
        await store.load();

        store.removeLocal(["a2"]);

        expect(store.tasks().map((candidate) => candidate.id)).toEqual(["a1"]);
    });
});
