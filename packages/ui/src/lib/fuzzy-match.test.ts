import { describe, expect, it } from "bun:test";
import { fuzzyMatch } from "./fuzzy-match";

/** Asserts a match and narrows away the null so callers can read `.score`. */
function expectMatch(
    query: string,
    text: string,
): NonNullable<ReturnType<typeof fuzzyMatch>> {
    const result = fuzzyMatch(query, text);
    if (result === null) {
        throw new Error(`expected "${query}" to match "${text}"`);
    }
    return result;
}

describe("fuzzyMatch", () => {
    it("matches a subsequence and returns its indices", () => {
        const result = fuzzyMatch("dpl", "deploy");
        expect(result).not.toBeNull();
        expect(result?.indices).toEqual([0, 2, 3]);
    });

    it("returns null when the query is not a subsequence", () => {
        expect(fuzzyMatch("xyz", "deploy")).toBeNull();
        expect(fuzzyMatch("deployx", "deploy")).toBeNull();
        expect(fuzzyMatch("a", "")).toBeNull();
    });

    it("matches everything with an empty query", () => {
        expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
    });

    it("is case-insensitive but reports indices of the original text", () => {
        // Greedy: matches the lowercase "d" in "Build", not the "D" in "Dev"
        const result = fuzzyMatch("BD", "Build: Dev");
        expect(result).not.toBeNull();
        expect(result?.indices).toEqual([0, 4]);
    });

    it("keeps indices aligned with the original text for unicode that changes length under toLowerCase", () => {
        // "İ".toLowerCase() is 2 code units; indices must still point into the original string
        const result = fuzzyMatch("b", "AİB");
        expect(result).not.toBeNull();
        expect(result?.indices).toEqual([2]);
        expect("AİB"[2]).toBe("B");
    });

    it("scores an exact contiguous match above a scattered match", () => {
        const exact = expectMatch("dev", "dev");
        const scattered = expectMatch("dev", "deploy:verify");
        expect(exact.score).toBeGreaterThan(scattered.score);
    });

    it("scores word-start matches above mid-word matches", () => {
        const wordStart = expectMatch("lf", "lint:fix");
        const midWord = expectMatch("lf", "wolfram");
        expect(wordStart.score).toBeGreaterThan(midWord.score);
    });

    it("prefers the shorter candidate when bonuses are equal", () => {
        const short = expectMatch("build", "build");
        const long = expectMatch("build", "build:backend");
        expect(short.score).toBeGreaterThan(long.score);
    });
});
