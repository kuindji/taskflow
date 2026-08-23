import { describe, test, expect } from "bun:test";
import { decodeLegacy, flushCarry } from "./decode-legacy";
import { noMods } from "./keys";
import type { InputEvent } from "./decode-legacy";
import type { KeyEvent } from "./keys";

/** The event at `index`, asserted to be a key. Mouse reports carry no `name`. */
function keyAt(events: InputEvent[], index: number): KeyEvent {
    const ev = events[index];
    if (ev === undefined || ev.kind === "mouse") throw new Error(`not a key at ${String(index)}`);
    return ev;
}

/** All of `events`, asserted to be keys, for the whole-stream assertions. */
function keysOf(events: InputEvent[]): KeyEvent[] {
    return events.map((_, i) => keyAt(events, i));
}


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
        expect(keyAt(decodeLegacy("\r", "").events, 0).name).toBe("enter");
        expect(keyAt(decodeLegacy("\t", "").events, 0).name).toBe("tab");
        expect(keyAt(decodeLegacy("\x7f", "").events, 0).name).toBe("backspace");
    });

    test("decodes a CSI arrow key", () => {
        const { events } = decodeLegacy("\x1b[A", "");
        expect(events[0]).toEqual({ name: "up", mods: noMods(), kind: "press" });
    });

    test("decodes an SS3 arrow key", () => {
        expect(keyAt(decodeLegacy("\x1bOB", "").events, 0).name).toBe("down");
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
        expect(keyAt(decodeLegacy("[A", first.carry).events, 0).name).toBe("up");
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
        expect(keyAt(second.events, 0).name).toBe("up");
        expect(second.carry).toBe("");
    });

    test("decodes several keys from one chunk", () => {
        const { events } = decodeLegacy("ab\r", "");
        expect(keysOf(events).map((e) => e.name)).toEqual(["char", "char", "enter"]);
    });

    test("decodes the tilde-final navigation keys with modifiers", () => {
        expect(keyAt(decodeLegacy("\x1b[3~", "").events, 0).name).toBe("delete");
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
        expect(keysOf(events).map((e) => e.char)).toEqual(["a"]);
        expect(carry).toBe("");
    });

    test("carries a private CSI sequence that is still incomplete", () => {
        const first = decodeLegacy("\x1b[?1", "");
        expect(first.events).toEqual([]);
        expect(first.carry).toBe("\x1b[?1");
        expect(keysOf(decodeLegacy("ua", first.carry).events).map((e) => e.char)).toEqual(["a"]);
    });

    test("does not carry a tail that can never complete a CSI sequence", () => {
        // `ESC [ CR` cannot become a CSI sequence: CR is neither a parameter,
        // an intermediate nor a final byte. Reading it back as Escape, then the
        // literal `[`, then Enter keeps the decoder moving; carrying it would
        // stall every later read behind a tail that can never complete.
        const { events, carry } = decodeLegacy("\x1b[\r", "");
        expect(keysOf(events).map((e) => e.name)).toEqual(["escape", "char", "enter"]);
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
        expect(keysOf(decodeLegacy("\x1c\x1d\x1e\x1f", "").events).map((e) => e.char)).toEqual([
            "\\",
            "]",
            "^",
            "_",
        ]);
    });

    test("decodes the rxvt home and end tilde sequences", () => {
        expect(decodeLegacy("\x1b[7~", "").events[0]).toEqual({
            name: "home",
            mods: noMods(),
            kind: "press",
        });
        expect(decodeLegacy("\x1b[8~", "").events[0]).toEqual({
            name: "end",
            mods: noMods(),
            kind: "press",
        });
        expect(decodeLegacy("\x1b[8;5~", "").events[0]).toEqual({
            name: "end",
            mods: { ...noMods(), ctrl: true },
            kind: "press",
        });
    });

    test("flushCarry releases an ambiguous alt prefix as an alt chord", () => {
        // Alt+[ and Alt+O send exactly `ESC [` and `ESC O`, which are also the
        // openings of a CSI and an SS3 sequence. decodeLegacy has to carry them
        // in case the rest is still in flight; once the idle timer says nothing
        // is coming, the chord is all they can have been.
        const bracket = decodeLegacy("\x1b[", "");
        expect(bracket.carry).toBe("\x1b[");
        expect(flushCarry(bracket.carry)).toEqual([
            { name: "char", char: "[", mods: { ...noMods(), alt: true }, kind: "press" },
        ]);

        const ss3 = decodeLegacy("\x1bO", "");
        expect(ss3.carry).toBe("\x1bO");
        expect(flushCarry(ss3.carry)).toEqual([
            { name: "char", char: "O", mods: { ...noMods(), alt: true }, kind: "press" },
        ]);
    });

    test("treats an out-of-range modifier parameter as no modifiers", () => {
        expect(decodeLegacy("\x1b[1;0C", "").events[0]).toEqual({
            name: "right",
            mods: noMods(),
            kind: "press",
        });
    });
    test("an SGR mouse report decodes to a mouse event, not keys", () => {
        const result = decodeLegacy("\x1b[<0;12;5M", "");
        expect(result.events).toEqual([
            { kind: "mouse", action: "press", button: "left", col: 11, row: 4, mods: noMods() },
        ]);
    });

    test("an X10 mouse report does not leak its payload as keystrokes", () => {
        // 32+49 = 81 = "Q", which is the quit binding.
        const result = decodeLegacy("\x1b[M\x20\x51\x21", "");
        expect(result.events).toEqual([
            { kind: "mouse", action: "press", button: "left", col: 48, row: 0, mods: noMods() },
        ]);
        expect(result.carry).toBe("");
    });

    test("a mouse report split across two reads survives the carry", () => {
        const first = decodeLegacy("\x1b[<0;12", "");
        expect(first.events).toEqual([]);
        const second = decodeLegacy(";5M", first.carry);
        expect(second.events).toHaveLength(1);
    });

    test("an X10 report split before its payload survives the carry", () => {
        const first = decodeLegacy("\x1b[M\x20", "");
        expect(first.events).toEqual([]);
        expect(first.carry).toBe("\x1b[M\x20");
        expect(decodeLegacy("\x51\x21", first.carry).events).toHaveLength(1);
    });

    test("keys around a mouse report are still decoded, in order", () => {
        const result = decodeLegacy("a\x1b[<0;1;1Mb", "");
        expect(result.events.map((e) => e.kind)).toEqual(["press", "mouse", "press"]);
    });

    test("a malformed SGR report is consumed without emitting keystrokes", () => {
        // The sequence is still a complete CSI, so it must not fall through to
        // the key branches or be left in the buffer.
        const result = decodeLegacy("\x1b[<0;0;1M", "");
        expect(result.events).toEqual([]);
        expect(result.carry).toBe("");
    });
});
