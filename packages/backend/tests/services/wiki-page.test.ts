import { describe, expect, it } from "bun:test";
import { parseWikiPage } from "../../src/services/wiki-page";

function parse(source: string, pageId = "business/money") {
    return parseWikiPage({
        pageId,
        relativePath: `${pageId}.md`,
        source,
        mtimeMs: 1000,
    });
}

describe("parseWikiPage", () => {
    it("prefers the frontmatter title", () => {
        expect(parse("---\ntitle: Money\n---\n\n# Something else\n").title).toBe("Money");
    });

    it("falls back to the first H1", () => {
        expect(parse("# Something else\n\ntext\n").title).toBe("Something else");
    });

    it("falls back to the filename when there is neither", () => {
        expect(parse("just prose\n", "business/money").title).toBe("money");
    });

    it("carries the frontmatter relationship fields", () => {
        const page = parse(
            "---\nparents:\n  - business\nchildren:\n  - business/money/rates\nrelated_pages:\n  - g\nlast_updated: 2026-05-04\n---\n\n# Money\n",
        );
        expect(page.parents).toEqual(["business"]);
        expect(page.children).toEqual(["business/money/rates"]);
        expect(page.relatedPages).toEqual(["g"]);
        expect(page.lastUpdated).toBe("2026-05-04");
    });

    it("collects headings with slugs", () => {
        expect(parse("# Money\n\n## Exchange rates\n").headings).toEqual([
            { depth: 1, text: "Money", id: "money" },
            { depth: 2, text: "Exchange rates", id: "exchange-rates" },
        ]);
    });

    it("collects wiki-link targets", () => {
        expect(parse("# t\n\nsee [[business/glossary]] and [[a/b|alias]]\n").rawLinks).toEqual([
            "business/glossary",
            "a/b",
        ]);
    });

    it("collects relative markdown link targets, resolved against the page", () => {
        expect(parse("# t\n\n[g](./glossary.md) and [r](../rates.md)\n").rawLinks).toEqual([
            "business/glossary",
            "rates",
        ]);
    });

    it("ignores external links", () => {
        expect(parse("# t\n\n[x](https://example.com)\n").rawLinks).toEqual([]);
    });

    it("deduplicates repeated targets, keeping first-appearance order", () => {
        expect(parse("# t\n\n[[b]] [[a]] [[b]]\n").rawLinks).toEqual(["b", "a"]);
    });

    it("interleaves markdown links and wiki-links in source order", () => {
        expect(parse("# t\n\n[m](./m.md) then [[w]] then [n](./n.md)\n").rawLinks).toEqual([
            "business/m",
            "w",
            "business/n",
        ]);
    });

    it("ignores links inside fenced code blocks", () => {
        const source = "# t\n\n```md\n[[not-a-link]] and [x](./x.md)\n```\n\n[[real]]\n";
        expect(parse(source).rawLinks).toEqual(["real"]);
    });

    it("keeps the id, path and mtime it was given", () => {
        const page = parse("# t\n");
        expect(page.id).toBe("business/money");
        expect(page.path).toBe("business/money.md");
        expect(page.mtimeMs).toBe(1000);
    });
});
