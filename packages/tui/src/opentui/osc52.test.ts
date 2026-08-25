import { describe, expect, it } from "bun:test";
import { MAX_OSC52_SEQUENCE_BYTES, Osc52Scanner } from "./osc52";

function fixture() {
    const copies: Array<{ text: string; target: string }> = [];
    const clears: string[] = [];
    const scanner = new Osc52Scanner({
        copy: (text, target) => copies.push({ text, target }),
        clear: (target) => clears.push(target),
    });
    return { scanner, copies, clears };
}

describe("Osc52Scanner", () => {
    it("recognizes BEL and ST sequences across arbitrary chunks", () => {
        const test = fixture();
        test.scanner.feed("before\x1b]5");
        test.scanner.feed("2;c;aGVs");
        test.scanner.feed("bG8=\x07after\x1b]52;p;5L2g5aW9\x1b");
        test.scanner.feed("\\");
        expect(test.copies).toEqual([
            { text: "hello", target: "clipboard" },
            { text: "你好", target: "primary" },
        ]);
    });

    it("maps select and clear targets", () => {
        const test = fixture();
        test.scanner.feed("\x1b]52;s;c2VsZWN0\x07\x1b]52;c;\x07");
        expect(test.copies).toEqual([{ text: "select", target: "select" }]);
        expect(test.clears).toEqual(["clipboard"]);
    });

    it("ignores queries, malformed base64, unknown targets, and oversized sequences", () => {
        const test = fixture();
        test.scanner.feed("\x1b]52;c;?\x07");
        test.scanner.feed("\x1b]52;c;%%%\x07");
        test.scanner.feed("\x1b]52;q;aGVsbG8=\x07");
        test.scanner.feed(`\x1b]52;c;${"a".repeat(MAX_OSC52_SEQUENCE_BYTES)}\x07`);
        test.scanner.feed("\x1b]52;c;b2s=\x07");
        expect(test.copies).toEqual([{ text: "ok", target: "clipboard" }]);
        expect(test.clears).toEqual([]);
    });

    it("drops a bounded partial sequence on reset", () => {
        const test = fixture();
        test.scanner.feed("\x1b]52;c;aGVs");
        test.scanner.reset();
        test.scanner.feed("bG8=\x07");
        expect(test.copies).toEqual([]);
    });
});
