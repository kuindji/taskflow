import { describe, expect, test } from "bun:test";
import { createSlices } from "./backend-scope";

interface Item {
    id: string;
    name?: string;
}

describe("createSlices", () => {
    test("holds each backend's items separately and reads them merged", () => {
        const slices = createSlices<Item>();
        slices.replace("a", [{ id: "1" }], slices.begin("a"));
        slices.replace("b", [{ id: "2" }], slices.begin("b"));

        expect(slices.read().map((i) => `${i.backendId}:${i.id}`)).toEqual(["a:1", "b:2"]);
    });

    test("of two concurrent fetches, the later request wins", () => {
        const slices = createSlices<Item>();
        // Two overlapping fetchProjects("a") — bootstrapBackend on attach and a
        // refresh, say. Both start before either resolves.
        const first = slices.begin("a");
        const second = slices.begin("a");

        slices.replace("a", [{ id: "old" }], first);
        slices.replace("a", [{ id: "old" }, { id: "new" }], second);

        expect(slices.read().map((i) => i.id)).toEqual(["old", "new"]);
    });

    test("a stale list response is discarded rather than overwriting newer state", () => {
        const slices = createSlices<Item>();
        const token = slices.begin("a"); // taken before the event lands

        // An event mutates the slice while the list request is in flight.
        slices.apply("a", (items) => [...items, { id: "created", backendId: "a" }]);

        // The list response resolves with a snapshot taken before that.
        slices.replace("a", [], token);

        expect(slices.read().map((i) => i.id)).toEqual(["created"]);
    });

    test("a fresh list response replaces the slice", () => {
        const slices = createSlices<Item>();
        slices.apply("a", (items) => [...items, { id: "old", backendId: "a" }]);
        slices.replace("a", [{ id: "new" }], slices.begin("a"));
        expect(slices.read().map((i) => i.id)).toEqual(["new"]);
    });

    test("a list overtaken by writes lands with those writes replayed over it", async () => {
        const slices = createSlices<Item>();

        const landed = await slices.load("a", async () => {
            // Events land before the answer: one updates a listed record, one
            // adds a record the snapshot predates.
            slices.apply("a", (items) =>
                items.map((i) => (i.id === "1" ? { ...i, name: "renamed" } : i)),
            );
            slices.apply("a", (items) => [...items, { id: "created", backendId: "a" }]);
            return [{ id: "1", name: "old" }, { id: "2" }];
        });

        expect(landed).toBe(true);
        expect(slices.read().map((i) => `${i.id}:${i.name ?? ""}`)).toEqual([
            "1:renamed",
            "2:",
            "created:",
        ]);
    });

    test("writes after a list landed are not replayed over the next one", async () => {
        const slices = createSlices<Item>();
        await slices.load("a", async () => [{ id: "1" }]);
        slices.apply("a", (items) => [...items, { id: "later", backendId: "a" }]);

        await slices.load("a", async () => [{ id: "1" }]);

        expect(slices.read().map((i) => i.id)).toEqual(["1"]);
    });

    test("a load superseded by a later request does not ask again", async () => {
        const slices = createSlices<Item>();
        let requests = 0;

        const landed = await slices.load("a", async () => {
            requests++;
            slices.replace("a", [{ id: "newer" }], slices.begin("a"));
            return [{ id: "older" }];
        });

        expect(landed).toBe(false);
        expect(requests).toBe(1);
        expect(slices.read().map((i) => i.id)).toEqual(["newer"]);
    });

    test("a response landing after its machine was dropped brings nothing back", async () => {
        const slices = createSlices<Item>();

        const landed = await slices.load("a", async () => {
            slices.drop("a");
            return [{ id: "1" }];
        });

        expect(landed).toBe(false);
        expect(slices.backends()).toEqual([]);
    });

    test("a request begun before its machine was dropped cannot land on the slice that replaced it", () => {
        const slices = createSlices<Item>();
        const old = slices.begin("a");
        slices.drop("a");
        const fresh = slices.begin("a");
        slices.replace("a", [{ id: "fresh" }], fresh);

        expect(slices.replace("a", [{ id: "old" }], old)).toBe(false);
        expect(slices.read().map((i) => i.id)).toEqual(["fresh"]);
    });

    test("dropping one backend leaves the others untouched", () => {
        const slices = createSlices<Item>();
        slices.replace("a", [{ id: "1" }], slices.begin("a"));
        slices.replace("b", [{ id: "2" }], slices.begin("b"));
        slices.drop("a");
        expect(slices.read().map((i) => i.backendId)).toEqual(["b"]);
    });
});
