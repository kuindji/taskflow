import { describe, expect, it } from "bun:test";
import { EmbeddedTerminalOutputFilter } from "./terminal-output";

describe("EmbeddedTerminalOutputFilter", () => {
    it("removes OSC 1 sequences terminated by BEL or ST across chunks", () => {
        const filter = new EmbeddedTerminalOutputFilter();

        expect(filter.feed("before\x1b]")).toBe("before");
        expect(filter.feed("1;first title")).toBe("");
        expect(filter.feed("\x07middle\x1b]1;second title\x1b")).toBe("middle");
        expect(filter.feed("\\after")).toBe("after");
    });

    it("preserves other OSC sequences and partial prefix mismatches", () => {
        const filter = new EmbeddedTerminalOutputFilter();

        expect(filter.feed("\x1b]2;window title\x07")).toBe("\x1b]2;window title\x07");
        expect(filter.feed("\x1b]10;rgb:ffff/ffff/ffff\x1b\\")).toBe(
            "\x1b]10;rgb:ffff/ffff/ffff\x1b\\",
        );
        expect(filter.feed("x\x1b")).toBe("x");
        expect(filter.feed("\x1b]52;c;b2s=\x07")).toBe("\x1b\x1b]52;c;b2s=\x07");
    });

    it("drops partial OSC 1 state on reset", () => {
        const filter = new EmbeddedTerminalOutputFilter();

        expect(filter.feed("before\x1b]1;title")).toBe("before");
        filter.reset();
        expect(filter.feed("after")).toBe("after");
    });
});
