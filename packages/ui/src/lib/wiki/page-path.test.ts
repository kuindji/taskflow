import { describe, expect, it } from "bun:test";
import { resolveWikiPageHref } from "./page-path";

const pages = new Map([
    ["business/money", "business/money.md"],
    ["business/index", "business/index.markdown"],
]);

describe("resolveWikiPageHref", () => {
    it("maps an exact page id to its real file", () => {
        expect(resolveWikiPageHref("/w/wiki", pages, "business/money")).toEqual({
            href: "/w/wiki/business/money.md",
            exists: true,
        });
    });

    it("resolves a folder to its index page, matching the backend graph", () => {
        // The backend counts [[business]] as a valid link to business/index, so
        // the preview must not render it broken or navigate to business.md.
        expect(resolveWikiPageHref("/w/wiki", pages, "business")).toEqual({
            href: "/w/wiki/business/index.markdown",
            exists: true,
        });
    });

    it("keeps the real extension rather than assuming .md", () => {
        expect(resolveWikiPageHref("/w/wiki", pages, "business/index").href).toBe(
            "/w/wiki/business/index.markdown",
        );
    });

    it("tolerates a leading ./ and a trailing slash", () => {
        expect(resolveWikiPageHref("/w/wiki", pages, "./business/").href).toBe(
            "/w/wiki/business/index.markdown",
        );
    });

    it("reports an unknown target as broken, with a plausible .md path", () => {
        expect(resolveWikiPageHref("/w/wiki", pages, "does/not/exist")).toEqual({
            href: "/w/wiki/does/not/exist.md",
            exists: false,
        });
    });

    it("does not produce a dangling slash for an unknown folder-shaped target", () => {
        expect(resolveWikiPageHref("/w/wiki", pages, "nope/").href).toBe("/w/wiki/nope.md");
    });

    it("keeps an explicit extension on an unknown target", () => {
        expect(resolveWikiPageHref("/w/wiki", pages, "notes.md").href).toBe("/w/wiki/notes.md");
    });
});
