import { describe, it, expect } from "bun:test";
import { computeMovedOrder } from "../../src/services/project-move";

describe("computeMovedOrder", () => {
    const ids = ["a", "b", "c", "d"];

    it("moves to a 1-based position (later)", () => {
        expect(computeMovedOrder(ids, "a", { to: 3 })).toEqual(["b", "c", "a", "d"]);
    });

    it("moves to a 1-based position (earlier)", () => {
        expect(computeMovedOrder(ids, "d", { to: 1 })).toEqual(["d", "a", "b", "c"]);
    });

    it("clamps to out-of-range positions", () => {
        expect(computeMovedOrder(ids, "a", { to: 99 })).toEqual(["b", "c", "d", "a"]);
        expect(computeMovedOrder(ids, "c", { to: 0 })).toEqual(["c", "a", "b", "d"]);
    });

    it("moves before a target id", () => {
        expect(computeMovedOrder(ids, "d", { before: "b" })).toEqual(["a", "d", "b", "c"]);
    });

    it("moves after a target id", () => {
        expect(computeMovedOrder(ids, "a", { after: "c" })).toEqual(["b", "c", "a", "d"]);
    });

    it("throws on unknown id", () => {
        expect(() => computeMovedOrder(ids, "x", { to: 1 })).toThrow();
    });

    it("throws on unknown target", () => {
        expect(() => computeMovedOrder(ids, "a", { before: "x" })).toThrow();
    });
});
