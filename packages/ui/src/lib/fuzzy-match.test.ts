import { describe, expect, it } from "bun:test";
import { fuzzyMatch } from "./fuzzy-match";

describe("fuzzyMatch", () => {
    it("matches a subsequence and returns its indices", () => {
        const result = fuzzyMatch("dpl", "deploy");
        expect(result).not.toBeNull();
        expect(result?.indices).toEqual([0, 2, 3]);
    });

    it("returns null when the query is not a subsequence", () => {
        expect(fuzzyMatch("xyz", "deploy")).toBeNull();
        expect(fuzzyMatch("deployx", "deploy")).toBeNull();
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

    it("scores an exact contiguous match above a scattered match", () => {
        const exact = fuzzyMatch("dev", "dev");
        const scattered = fuzzyMatch("dev", "deploy:verify");
        expect(exact).not.toBeNull();
        expect(scattered).not.toBeNull();
        expect(exact!.score).toBeGreaterThan(scattered!.score);
    });

    it("scores word-start matches above mid-word matches", () => {
        const wordStart = fuzzyMatch("lf", "lint:fix");
        const midWord = fuzzyMatch("lf", "wolfram");
        expect(wordStart).not.toBeNull();
        expect(midWord).not.toBeNull();
        expect(wordStart!.score).toBeGreaterThan(midWord!.score);
    });

    it("prefers the shorter candidate when bonuses are equal", () => {
        const short = fuzzyMatch("build", "build");
        const long = fuzzyMatch("build", "build:backend");
        expect(short!.score).toBeGreaterThan(long!.score);
    });
});
