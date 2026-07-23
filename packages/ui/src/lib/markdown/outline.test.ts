import { describe, expect, it } from "bun:test";
import { extractOutline } from "./outline";

describe("extractOutline", () => {
    it("collects ATX headings with depth, text and slug", () => {
        expect(extractOutline("# Money\n\ntext\n\n## Currency notes\n")).toEqual([
            { depth: 1, text: "Money", id: "money" },
            { depth: 2, text: "Currency notes", id: "currency-notes" },
        ]);
    });

    it("strips inline markup before slugging, matching rehype-slug", () => {
        expect(extractOutline("## The `rates` *table*\n")).toEqual([
            { depth: 2, text: "The rates table", id: "the-rates-table" },
        ]);
    });

    it("uses the link text of a heading link", () => {
        expect(extractOutline("## See [the glossary](./g.md)\n")).toEqual([
            { depth: 2, text: "See the glossary", id: "see-the-glossary" },
        ]);
    });

    it("deduplicates repeated headings the way github-slugger does", () => {
        expect(extractOutline("# Notes\n# Notes\n").map((h) => h.id)).toEqual(["notes", "notes-1"]);
    });

    it("ignores headings inside fenced code blocks", () => {
        expect(extractOutline("```\n# not a heading\n```\n\n# real\n")).toEqual([
            { depth: 1, text: "real", id: "real" },
        ]);
    });

    it("ignores a leading frontmatter block", () => {
        expect(extractOutline("---\ntitle: x\n---\n\n# Real\n")).toEqual([
            { depth: 1, text: "Real", id: "real" },
        ]);
    });

    it("ignores trailing closing hashes", () => {
        expect(extractOutline("## Money ##\n")).toEqual([{ depth: 2, text: "Money", id: "money" }]);
    });

    it("returns an empty list for a document with no headings", () => {
        expect(extractOutline("just prose\n")).toEqual([]);
    });
});
