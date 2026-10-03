import { describe, expect, it } from "bun:test";
import { expectRejects } from "../expect-rejects";
import { KeyedQueue } from "../../src/services/keyed-queue";
import { normalizeOwner, ownerIdOf, ownerKey, sameOwner } from "../../src/services/session-owner";

describe("session owner helpers", () => {
    it("normalizes an owner to exactly one field", () => {
        expect(normalizeOwner({ taskId: "t1" })).toEqual({ taskId: "t1" });
        expect(normalizeOwner({ projectId: "p1" })).toEqual({ projectId: "p1" });
        expect(normalizeOwner({ master: true })).toEqual({ master: true });
        for (const bad of [{}, { taskId: "t1", projectId: "p1" }, { taskId: "", master: false }]) {
            expect(() => normalizeOwner(bad)).toThrow(
                "Exactly one of taskId, projectId, or master is required",
            );
        }
    });

    it("derives log ids and lock keys", () => {
        expect(ownerIdOf({ taskId: "t1" })).toBe("t1");
        expect(ownerIdOf({ projectId: "p1" })).toBe("p1");
        expect(ownerIdOf({ master: true })).toBe("master");
        expect(ownerKey({ taskId: "t1" })).toBe("task:t1");
        expect(ownerKey({ projectId: "p1" })).toBe("project:p1");
        expect(ownerKey({ master: true })).toBe("master");
    });

    it("compares owners by kind and id", () => {
        expect(sameOwner({ taskId: "x" }, { taskId: "x" })).toBe(true);
        expect(sameOwner({ taskId: "x" }, { projectId: "x" })).toBe(false);
        expect(sameOwner({ master: true }, { master: true })).toBe(true);
    });
});

describe("KeyedQueue", () => {
    it("runs one key's steps in call order", async () => {
        const queue = new KeyedQueue();
        const seen: string[] = [];
        await Promise.all([
            queue.run("k", async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                seen.push("first");
            }),
            queue.run("k", async () => {
                seen.push("second");
            }),
        ]);
        expect(seen).toEqual(["first", "second"]);
    });

    it("keeps going after a failed step and lets other keys run", async () => {
        const queue = new KeyedQueue();
        const failed = queue.run("k", async () => {
            throw new Error("boom");
        });
        await expectRejects(failed, "boom");
        expect(await queue.run("k", async () => "next")).toBe("next");
        expect(await queue.run("other", async () => "other")).toBe("other");
    });

    it("drains everything queued so far", async () => {
        const queue = new KeyedQueue();
        let done = false;
        void queue.run("k", async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            done = true;
        });
        await queue.drain();
        expect(done).toBe(true);
    });
});
