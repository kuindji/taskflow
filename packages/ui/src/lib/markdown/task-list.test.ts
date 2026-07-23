import { describe, expect, it } from "bun:test";
import { relocateTaskLine, toggleTaskListItemAtLine } from "./task-list";

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

describe("relocateTaskLine", () => {
    it("returns the same line when the bytes are unchanged", () => {
        expect(relocateTaskLine(DOC, DOC, 3)).toBe(3);
    });

    it("follows the item when lines are inserted above it", () => {
        const current = ["# Plan", "", "intro", ...DOC.split("\n").slice(2)].join("\n");
        expect(relocateTaskLine(DOC, current, 3)).toBe(4);
    });

    it("follows the item when lines are removed above it", () => {
        const current = DOC.split("\n").slice(1).join("\n");
        expect(relocateTaskLine(DOC, current, 3)).toBe(2);
    });

    it("gives up when the item itself was edited", () => {
        const current = DOC.replace("- [ ] first", "- [ ] first thing");
        expect(relocateTaskLine(DOC, current, 3)).toBeNull();
    });

    it("gives up when the item was already checked by someone else", () => {
        const current = DOC.replace("- [ ] first", "- [x] first");
        expect(relocateTaskLine(DOC, current, 3)).toBeNull();
    });

    it("gives up when the item was deleted", () => {
        const current = DOC.split("\n")
            .filter((l) => l !== "- [ ] first")
            .join("\n");
        expect(relocateTaskLine(DOC, current, 3)).toBeNull();
    });

    it("gives up when an identical twin item appeared", () => {
        const current = DOC.replace("- [ ] first", "- [ ] first\n- [ ] first");
        expect(relocateTaskLine(DOC, current, 3)).toBeNull();
    });

    it("gives up on items that already have an identical twin", () => {
        // Which "- [ ] dup" the click meant cannot be recovered from the bytes
        // once anything moves — a reorder is indistinguishable from an insert.
        const snapshot = ["- [ ] dup", "- [ ] other", "- [ ] dup"].join("\n");
        const current = ["header", "", ...snapshot.split("\n")].join("\n");
        expect(relocateTaskLine(snapshot, current, 1)).toBeNull();
        expect(relocateTaskLine(snapshot, current, 3)).toBeNull();
    });

    it("does not follow a reordered duplicate into the wrong section", () => {
        const snapshot = ["# A", "- [ ] done", "# B", "- [ ] done"].join("\n");
        const current = ["# B", "- [ ] done", "# A", "- [ ] done"].join("\n");
        expect(relocateTaskLine(snapshot, current, 2)).toBeNull();
    });

    it("relocates in a CRLF document without mangling the endings", () => {
        const snapshot = "- [ ] a\r\n- [ ] b\r\n";
        const current = "# added\r\n\r\n- [ ] a\r\n- [ ] b\r\n";
        const line = relocateTaskLine(snapshot, current, 2);
        expect(line).toBe(4);
        expect(toggleTaskListItemAtLine(current, line ?? 0)).toBe(
            "# added\r\n\r\n- [ ] a\r\n- [x] b\r\n",
        );
    });

    it("refuses a line that is not a task item", () => {
        expect(relocateTaskLine(DOC, DOC, 13)).toBeNull();
    });

    it("refuses an out-of-range line", () => {
        expect(relocateTaskLine(DOC, DOC, 0)).toBeNull();
        expect(relocateTaskLine(DOC, DOC, 999)).toBeNull();
    });
});
