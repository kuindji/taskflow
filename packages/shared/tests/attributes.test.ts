import { describe, expect, it } from "bun:test";
import {
    hasNameConflict,
    normalizeAttributeName,
    resolveAttributes,
} from "../src/utils/attributes";
import type { Attribute } from "../src/types/attribute";

function attr(id: string, name: string, value: string): Attribute {
    return { id, name, value };
}

describe("normalizeAttributeName", () => {
    it("trims surrounding whitespace", () => {
        expect(normalizeAttributeName("  env  ")).toBe("env");
    });

    it("collapses a whitespace-only name to empty", () => {
        expect(normalizeAttributeName("   ")).toBe("");
    });
});

describe("hasNameConflict", () => {
    const list = [attr("a", "env", "prod"), attr("b", "ticket", "T-1")];

    it("reports a conflict for a duplicate name", () => {
        expect(hasNameConflict(list, "env")).toBe(true);
    });

    it("reports no conflict for a fresh name", () => {
        expect(hasNameConflict(list, "region")).toBe(false);
    });

    it("ignores the attribute being renamed", () => {
        expect(hasNameConflict(list, "env", "a")).toBe(false);
    });

    it("compares against the trimmed name", () => {
        expect(hasNameConflict(list, "  env  ")).toBe(true);
    });
});

describe("resolveAttributes", () => {
    it("returns an empty list for no layers", () => {
        expect(resolveAttributes([])).toEqual([]);
    });

    it("merges two layers and tags each with its scope", () => {
        const resolved = resolveAttributes([
            { scope: "project", attributes: [attr("p1", "env", "prod")] },
            { scope: "task", attributes: [attr("t1", "ticket", "T-9")] },
        ]);
        expect(resolved).toEqual([
            { id: "p1", name: "env", value: "prod", scope: "project" },
            { id: "t1", name: "ticket", value: "T-9", scope: "task" },
        ]);
    });

    it("drops a shadowed lower-layer attribute entirely", () => {
        const resolved = resolveAttributes([
            { scope: "project", attributes: [attr("p1", "env", "prod")] },
            { scope: "task", attributes: [attr("t1", "env", "dev")] },
        ]);
        expect(resolved).toEqual([{ id: "t1", name: "env", value: "dev", scope: "task" }]);
    });

    it("resolves three layers with the highest winning", () => {
        const resolved = resolveAttributes([
            {
                scope: "project",
                attributes: [attr("p1", "env", "prod"), attr("p2", "team", "core")],
            },
            { scope: "parent", attributes: [attr("n1", "env", "staging")] },
            { scope: "task", attributes: [attr("t1", "env", "dev")] },
        ]);
        expect(resolved).toEqual([
            { id: "p2", name: "team", value: "core", scope: "project" },
            { id: "t1", name: "env", value: "dev", scope: "task" },
        ]);
    });

    it("lets a middle layer shadow the bottom layer", () => {
        const resolved = resolveAttributes([
            { scope: "project", attributes: [attr("p1", "env", "prod")] },
            { scope: "parent", attributes: [attr("n1", "env", "staging")] },
            { scope: "task", attributes: [] },
        ]);
        expect(resolved).toEqual([{ id: "n1", name: "env", value: "staging", scope: "parent" }]);
    });

    it("preserves insertion order within a layer", () => {
        const resolved = resolveAttributes([
            {
                scope: "project",
                attributes: [attr("p1", "z", "1"), attr("p2", "a", "2"), attr("p3", "m", "3")],
            },
        ]);
        expect(resolved.map((a) => a.name)).toEqual(["z", "a", "m"]);
    });

    it("skips empty layers without affecting order", () => {
        const resolved = resolveAttributes([
            { scope: "project", attributes: [] },
            { scope: "parent", attributes: [attr("n1", "env", "staging")] },
            { scope: "task", attributes: [] },
        ]);
        expect(resolved).toEqual([{ id: "n1", name: "env", value: "staging", scope: "parent" }]);
    });
});
