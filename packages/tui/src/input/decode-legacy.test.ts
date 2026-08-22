import { describe, test, expect } from "bun:test";
import { decodeLegacy, flushCarry } from "./decode-legacy";
import { noMods } from "./keys";

describe("decodeLegacy", () => {
    test("decodes a plain character", () => {
        const { events, carry } = decodeLegacy("a", "");
        expect(events).toEqual([{ name: "char", char: "a", mods: noMods(), kind: "press" }]);
        expect(carry).toBe("");
    });

    test("decodes a control character as ctrl plus letter", () => {
        const { events } = decodeLegacy("\x01", "");
        expect(events[0]).toEqual({
            name: "char",
            char: "a",
            mods: { ...noMods(), ctrl: true },
            kind: "press",
        });
    });

    test("decodes enter, tab and backspace", () => {
        expect(decodeLegacy("\r", "").events[0]?.name).toBe("enter");
        expect(decodeLegacy("\t", "").events[0]?.name).toBe("tab");
        expect(decodeLegacy("\x7f", "").events[0]?.name).toBe("backspace");
    });

    test("decodes a CSI arrow key", () => {
        const { events } = decodeLegacy("\x1b[A", "");
        expect(events[0]).toEqual({ name: "up", mods: noMods(), kind: "press" });
    });

    test("decodes an SS3 arrow key", () => {
        expect(decodeLegacy("\x1bOB", "").events[0]?.name).toBe("down");
    });

    test("decodes a modified CSI arrow key", () => {
        const { events } = decodeLegacy("\x1b[1;5C", "");
        expect(events[0]).toEqual({
            name: "right",
            mods: { ...noMods(), ctrl: true },
            kind: "press",
        });
    });

    test("carries a lone escape rather than emitting it", () => {
        const { events, carry } = decodeLegacy("\x1b", "");
        expect(events).toEqual([]);
        expect(carry).toBe("\x1b");
    });

    test("a carried escape still completes a split sequence", () => {
        const first = decodeLegacy("\x1b", "");
        expect(decodeLegacy("[A", first.carry).events[0]?.name).toBe("up");
    });

    test("flushCarry releases a stranded escape as a real Escape press", () => {
        expect(flushCarry("\x1b")[0]?.name).toBe("escape");
    });

    test("flushCarry drops an incomplete CSI rather than emitting garbage", () => {
        expect(flushCarry("\x1b[1;")).toEqual([]);
    });

    test("decodes alt plus character", () => {
        const { events } = decodeLegacy("\x1bx", "");
        expect(events[0]).toEqual({
            name: "char",
            char: "x",
            mods: { ...noMods(), alt: true },
            kind: "press",
        });
    });

    test("carries an incomplete sequence to the next call", () => {
        const first = decodeLegacy("\x1b[", "");
        expect(first.events).toEqual([]);
        expect(first.carry).toBe("\x1b[");
        const second = decodeLegacy("A", first.carry);
        expect(second.events[0]?.name).toBe("up");
        expect(second.carry).toBe("");
    });

    test("decodes several keys from one chunk", () => {
        const { events } = decodeLegacy("ab\r", "");
        expect(events.map((e) => e.name)).toEqual(["char", "char", "enter"]);
    });

    test("decodes the tilde-final navigation keys with modifiers", () => {
        expect(decodeLegacy("\x1b[3~", "").events[0]?.name).toBe("delete");
        expect(decodeLegacy("\x1b[5;2~", "").events[0]).toEqual({
            name: "pageup",
            mods: { ...noMods(), shift: true },
            kind: "press",
        });
    });

    test("consumes a private CSI reply instead of stalling on it", () => {
        // A late kitty-protocol reply (CSI ? 1 u) reaches the decoder after
        // negotiation has already given up. Its `?` is a private-parameter
        // prefix, so the sequence must be consumed and dropped, not carried.
        const { events, carry } = decodeLegacy("\x1b[?1u", "");
        expect(events).toEqual([]);
        expect(carry).toBe("");
    });

    test("keeps decoding keys typed after an unrecognized CSI sequence", () => {
        const { events, carry } = decodeLegacy("\x1b[?1ua", "");
        expect(events.map((e) => e.char)).toEqual(["a"]);
        expect(carry).toBe("");
    });

    test("carries a private CSI sequence that is still incomplete", () => {
        const first = decodeLegacy("\x1b[?1", "");
        expect(first.events).toEqual([]);
        expect(first.carry).toBe("\x1b[?1");
        expect(decodeLegacy("ua", first.carry).events.map((e) => e.char)).toEqual(["a"]);
    });

    test("does not carry a tail that can never complete a CSI sequence", () => {
        // `ESC [ CR` cannot become a CSI sequence: CR is neither a parameter,
        // an intermediate nor a final byte. Reading it back as Escape, then the
        // literal `[`, then Enter keeps the decoder moving; carrying it would
        // stall every later read behind a tail that can never complete.
        const { events, carry } = decodeLegacy("\x1b[\r", "");
        expect(events.map((e) => e.name)).toEqual(["escape", "char", "enter"]);
        expect(carry).toBe("");
    });

    test("keeps an astral character whole", () => {
        const { events } = decodeLegacy("\u{1F680}", "");
        expect(events).toEqual([
            { name: "char", char: "\u{1F680}", mods: noMods(), kind: "press" },
        ]);
    });

    test("decodes back-tab as shift plus tab", () => {
        // `CSI Z` is what every legacy terminal sends for Shift+Tab. Dropping
        // it would make the key unreachable both in the TUI and in any child
        // session the events are forwarded to.
        expect(decodeLegacy("\x1b[Z", "").events).toEqual([
            { name: "tab", mods: { ...noMods(), shift: true }, kind: "press" },
        ]);
    });

    test("decodes the non-letter control characters by their real key", () => {
        // C0 codes map to ASCII `code + 64`: NUL is Ctrl+@ (what Ctrl+Space
        // sends), and 0x1c-0x1f are Ctrl+\, Ctrl+], Ctrl+^ and Ctrl+_. Only
        // 0x01-0x1a are the Ctrl+letter range.
        const ctrl = { ...noMods(), ctrl: true };
        expect(decodeLegacy("\x00", "").events[0]).toEqual({
            name: "char",
            char: "@",
            mods: ctrl,
            kind: "press",
        });
        expect(decodeLegacy("\x1c\x1d\x1e\x1f", "").events.map((e) => e.char)).toEqual([
            "\\",
            "]",
            "^",
            "_",
        ]);
    });

    test("treats an out-of-range modifier parameter as no modifiers", () => {
        expect(decodeLegacy("\x1b[1;0C", "").events[0]).toEqual({
            name: "right",
            mods: noMods(),
            kind: "press",
        });
    });
});
