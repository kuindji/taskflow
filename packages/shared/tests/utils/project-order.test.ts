import { describe, it, expect } from "bun:test";
import { orderProjectsByIds, buildReorderedProjectIds } from "../../src/utils/project-order";

describe("orderProjectsByIds", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

    it("reorders items to match orderedIds", () => {
        expect(orderProjectsByIds(items, ["c", "a", "b"]).map((i) => i.id)).toEqual([
            "c",
            "a",
            "b",
        ]);
    });

    it("appends items missing from orderedIds in original order", () => {
        expect(orderProjectsByIds(items, ["c"]).map((i) => i.id)).toEqual(["c", "a", "b"]);
    });

    it("ignores unknown ids in orderedIds", () => {
        expect(orderProjectsByIds(items, ["x", "b", "a"]).map((i) => i.id)).toEqual([
            "b",
            "a",
            "c",
        ]);
    });

    it("returns original order for empty orderedIds", () => {
        expect(orderProjectsByIds(items, []).map((i) => i.id)).toEqual(["a", "b", "c"]);
    });
});

describe("buildReorderedProjectIds", () => {
    it("reorders only visible ids, pinning others to their slots", () => {
        // full: a(hidden) b(vis) c(vis) d(hidden) e(vis); visible reordered to e,b,c
        const result = buildReorderedProjectIds(["a", "b", "c", "d", "e"], ["e", "b", "c"]);
        expect(result).toEqual(["a", "e", "b", "d", "c"]);
    });

    it("equals a plain reorder when all ids are visible", () => {
        expect(buildReorderedProjectIds(["a", "b", "c"], ["c", "a", "b"])).toEqual([
            "c",
            "a",
            "b",
        ]);
    });
});
