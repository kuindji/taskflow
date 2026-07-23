import { describe, expect, it } from "bun:test";
import { parseFrontmatter } from "./frontmatter";

const PAGE = `---
title: Currency
parents:
  - business/money
children:
  - business/money/currency/rates
related_pages:
  - business/glossary
last_updated: 2026-05-04
owner: finance
---

# Currency

Body text.
`;

describe("parseFrontmatter", () => {
    it("reads the known wiki fields", () => {
        const fm = parseFrontmatter(PAGE);
        expect(fm?.title).toBe("Currency");
        expect(fm?.parents).toEqual(["business/money"]);
        expect(fm?.children).toEqual(["business/money/currency/rates"]);
        expect(fm?.relatedPages).toEqual(["business/glossary"]);
        expect(fm?.lastUpdated).toBe("2026-05-04");
    });

    it("keeps unrecognised scalar fields in extra", () => {
        expect(parseFrontmatter(PAGE)?.extra).toEqual({ owner: "finance" });
    });

    it("accepts an inline-sequence list", () => {
        const fm = parseFrontmatter("---\nparents: [a/b, c/d]\n---\n# t\n");
        expect(fm?.parents).toEqual(["a/b", "c/d"]);
    });

    it("returns null when there is no frontmatter", () => {
        expect(parseFrontmatter("# Heading\n\ntext")).toBeNull();
    });

    it("returns null for a horizontal rule that only looks like a fence", () => {
        expect(parseFrontmatter("---\n\nnot frontmatter\n")).toBeNull();
    });

    it("returns null when the YAML is malformed rather than throwing", () => {
        expect(parseFrontmatter("---\ntitle: [unclosed\n---\n# t\n")).toBeNull();
    });

    it("coerces a single string where a list is expected", () => {
        const fm = parseFrontmatter("---\nparents: business/money\n---\n# t\n");
        expect(fm?.parents).toEqual(["business/money"]);
    });
});
