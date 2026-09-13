import { describe, expect, test } from "bun:test";
import { createSlices } from "./backend-scope";

interface Item {
    id: string;
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

    test("dropping one backend leaves the others untouched", () => {
        const slices = createSlices<Item>();
        slices.replace("a", [{ id: "1" }], slices.begin("a"));
        slices.replace("b", [{ id: "2" }], slices.begin("b"));
        slices.drop("a");
        expect(slices.read().map((i) => i.backendId)).toEqual(["b"]);
    });
});
