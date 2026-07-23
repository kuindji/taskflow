import { describe, expect, it } from "bun:test";
import type { AttributeLayer } from "../types/attribute";
import { resolveWikiRoot } from "./wiki-root";

function layers(...entries: Array<[AttributeLayer["scope"], string, string]>): AttributeLayer[] {
    const byScope = new Map<AttributeLayer["scope"], AttributeLayer>();
    entries.forEach(([scope, name, value], i) => {
        const layer = byScope.get(scope) ?? { scope, attributes: [] };
        layer.attributes.push({ id: `a${i}`, name, value });
        byScope.set(scope, layer);
    });
    return ["project", "parent", "task"]
        .map((scope) => byScope.get(scope as AttributeLayer["scope"]))
        .filter((layer): layer is AttributeLayer => layer !== undefined);
}

describe("resolveWikiRoot", () => {
    it("resolves a relative value against the working dir", () => {
        expect(
            resolveWikiRoot({
                layers: layers(["project", "wiki", "docs/wiki"]),
                workingDir: "/w/repo",
            }),
        ).toBe("/w/repo/docs/wiki");
    });

    it("uses an absolute value as-is", () => {
        expect(
            resolveWikiRoot({
                layers: layers(["project", "wiki", "/srv/notes"]),
                workingDir: "/w/repo",
            }),
        ).toBe("/srv/notes");
    });

    it("resolves against a worktree working dir, not the main checkout", () => {
        expect(
            resolveWikiRoot({
                layers: layers(["project", "wiki", "docs/wiki"]),
                workingDir: "/w/repo/.worktrees/feature",
            }),
        ).toBe("/w/repo/.worktrees/feature/docs/wiki");
    });

    it("lets a task-scoped value shadow the project value", () => {
        expect(
            resolveWikiRoot({
                layers: layers(["project", "wiki", "docs/wiki"], ["task", "wiki", "docs/other"]),
                workingDir: "/w/repo",
            }),
        ).toBe("/w/repo/docs/other");
    });

    it("matches the attribute name exactly", () => {
        expect(
            resolveWikiRoot({
                layers: layers(["project", "Wiki", "docs/wiki"]),
                workingDir: "/w/repo",
            }),
        ).toBeNull();
        expect(
            resolveWikiRoot({
                layers: layers(["project", "wiki-root", "docs/wiki"]),
                workingDir: "/w/repo",
            }),
        ).toBeNull();
    });

    it("returns null with no wiki attribute, no working dir, or an empty value", () => {
        expect(resolveWikiRoot({ layers: layers(), workingDir: "/w/repo" })).toBeNull();
        expect(
            resolveWikiRoot({
                layers: layers(["project", "wiki", "docs/wiki"]),
                workingDir: null,
            }),
        ).toBeNull();
        expect(
            resolveWikiRoot({ layers: layers(["project", "wiki", "  "]), workingDir: "/w/repo" }),
        ).toBeNull();
    });

    it("strips a trailing slash", () => {
        expect(
            resolveWikiRoot({
                layers: layers(["project", "wiki", "docs/wiki/"]),
                workingDir: "/w/repo",
            }),
        ).toBe("/w/repo/docs/wiki");
    });
});
