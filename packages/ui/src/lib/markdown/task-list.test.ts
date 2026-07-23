import { describe, expect, it } from "bun:test";
import { toggleTaskListItemAtLine } from "./task-list";

const DOC = [
    "# Plan", // 1
    "", // 2
    "- [ ] first", // 3
    "- [x] second", // 4
    "  - [ ] nested", // 5
    "", // 6
    "> - [ ] quoted", // 7
    "", // 8
    "1. [ ] ordered", // 9
    "", // 10
    "* [ ] star bullet", // 11
    "", // 12
    "prose", // 13
].join("\n");

describe("toggleTaskListItemAtLine", () => {
    it("checks an unchecked item", () => {
        expect(toggleTaskListItemAtLine(DOC, 3)).toContain("- [x] first");
    });

    it("unchecks a checked item", () => {
        expect(toggleTaskListItemAtLine(DOC, 4)).toContain("- [ ] second");
    });

    it("handles a nested item", () => {
        expect(toggleTaskListItemAtLine(DOC, 5)).toContain("  - [x] nested");
    });

    it("handles an item inside a blockquote", () => {
        expect(toggleTaskListItemAtLine(DOC, 7)).toContain("> - [x] quoted");
    });

    it("handles an ordered-list item", () => {
        expect(toggleTaskListItemAtLine(DOC, 9)).toContain("1. [x] ordered");
    });

    it("handles a star bullet", () => {
        expect(toggleTaskListItemAtLine(DOC, 11)).toContain("* [x] star bullet");
    });

    it("returns the source unchanged for a line with no checkbox", () => {
        expect(toggleTaskListItemAtLine(DOC, 13)).toBe(DOC);
    });

    it("returns the source unchanged for an out-of-range line", () => {
        expect(toggleTaskListItemAtLine(DOC, 0)).toBe(DOC);
        expect(toggleTaskListItemAtLine(DOC, 999)).toBe(DOC);
    });

    it("preserves CRLF line endings", () => {
        const crlf = "- [ ] a\r\n- [ ] b\r\n";
        expect(toggleTaskListItemAtLine(crlf, 2)).toBe("- [ ] a\r\n- [x] b\r\n");
    });

    it("leaves every other byte identical", () => {
        const out = toggleTaskListItemAtLine(DOC, 3);
        expect(out.replace("- [x] first", "- [ ] first")).toBe(DOC);
    });
});
