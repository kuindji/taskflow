import { describe, expect, it } from "bun:test";
import { parseWikiLinks, resolveWikiTarget } from "./wiki-link";

describe("parseWikiLinks", () => {
    it("finds a plain path link", () => {
        // "see " is 4 chars; "[[business/money/currency]]" is 27, so end is 31.
        expect(parseWikiLinks("see [[business/money/currency]] now")).toEqual([
            { start: 4, end: 31, target: "business/money/currency" },
        ]);
    });

    it("splits an alias", () => {
        const [link] = parseWikiLinks("[[business/money|the money page]]");
        expect(link.target).toBe("business/money");
        expect(link.alias).toBe("the money page");
    });

    it("splits a heading fragment", () => {
        const [link] = parseWikiLinks("[[business/money#exchange rates]]");
        expect(link.target).toBe("business/money");
        expect(link.hash).toBe("exchange rates");
    });

    it("splits a fragment and an alias together", () => {
        const [link] = parseWikiLinks("[[a/b#c|D]]");
        expect(link).toMatchObject({ target: "a/b", hash: "c", alias: "D" });
    });

    it("finds several links on one line", () => {
        expect(parseWikiLinks("[[a]] and [[b]]").map((l) => l.target)).toEqual(["a", "b"]);
    });

    it("trims surrounding whitespace inside the brackets", () => {
        expect(parseWikiLinks("[[  a/b  ]]")[0].target).toBe("a/b");
    });

    it("ignores empty and unterminated brackets", () => {
        expect(parseWikiLinks("[[]] and [[ ]] and [[unterminated")).toEqual([]);
    });

    it("ignores a normal markdown link", () => {
        expect(parseWikiLinks("[label](./a.md)")).toEqual([]);
    });

    it("reports offsets that slice back to the original text", () => {
        const source = "x [[a/b|c]] y";
        const [link] = parseWikiLinks(source);
        expect(source.slice(link.start, link.end)).toBe("[[a/b|c]]");
    });
});

describe("resolveWikiTarget", () => {
    const has = (ids: string[]) => (id: string) => ids.includes(id);

    it("returns an exact page id", () => {
        expect(resolveWikiTarget("business/money", has(["business/money"]))).toBe("business/money");
    });

    it("falls back to a folder's index page", () => {
        expect(resolveWikiTarget("business", has(["business/index"]))).toBe("business/index");
        expect(resolveWikiTarget("business", has(["business/README"]))).toBe("business/README");
    });

    it("ignores a leading ./ and a trailing slash", () => {
        expect(resolveWikiTarget("./business/", has(["business/index"]))).toBe("business/index");
    });

    it("returns null when nothing matches", () => {
        expect(resolveWikiTarget("nope", has(["business/money"]))).toBeNull();
    });
});
