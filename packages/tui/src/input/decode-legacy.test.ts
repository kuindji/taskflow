import { describe, test, expect } from "bun:test";
import { decodeLegacy, flushCarry, isPartialMouseReport } from "./decode-legacy";
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

    test("an X10 header owed payload is held rather than flushed as keystrokes", () => {
        // The idle timer can fire between the header and its payload. Releasing
        // the carry there strips the header and leaves the payload to decode as
        // typed characters: this one is `Q`, which quits, followed by `!`.
        const first = decodeLegacy("\x1b[M\x20", "");
        expect(first.carry).toBe("\x1b[M\x20");
        expect(isPartialMouseReport(first.carry)).toBe(true);
        expect(flushCarry(first.carry)).toEqual([]);
        expect(decodeLegacy("\x51\x21", first.carry).events).toEqual([
            { kind: "mouse", action: "press", button: "left", col: 48, row: 0, mods: noMods() },
        ]);
        // What the flush would have produced from the stranded payload alone.
        expect(keysOf(decodeLegacy("\x51\x21", "").events).map((e) => e.char)).toEqual(["Q", "!"]);
    });

    test("a half-written SGR report is held rather than orphaned by the idle flush", () => {
        // The SGR form is the one the TUI actually asks for; X10 is only the
        // fallback. Split by the idle timer its carry is dropped — `flushCarry`
        // has no key to make of it — and the tail arrives with no `ESC [ <` in
        // front of it, so the parameter digits decode as typed characters: `1`
        // through `9` switch session tabs, and under session focus the whole
        // run is forwarded to the child as if the user had typed it.
        const first = decodeLegacy("\x1b[<0;50;10", "");
        expect(first.events).toEqual([]);
        expect(first.carry).toBe("\x1b[<0;50;10");
        expect(flushCarry(first.carry)).toEqual([]);
        // What the tail decodes as once the carry has been thrown away.
        expect(keysOf(decodeLegacy("M", "").events).map((e) => e.char)).toEqual(["M"]);
        expect(keysOf(decodeLegacy("0;10M", "").events).map((e) => e.char)).toEqual([
            "0",
            ";",
            "1",
            "0",
            "M",
        ]);
        // Held instead, the tail completes the click it belongs to.
        expect(isPartialMouseReport(first.carry)).toBe(true);
        expect(decodeLegacy("M", first.carry).events).toEqual([
            { kind: "mouse", action: "press", button: "left", col: 49, row: 9, mods: noMods() },
        ]);
    });

    test("isPartialMouseReport is false for a header that already has its payload", () => {
        // Only a header still owed bytes may be held; anything else has to stay
        // flushable or a stale carry would wedge the decoder.
        expect(isPartialMouseReport("\x1b[M\x20\x51\x21")).toBe(false);
        expect(isPartialMouseReport("\x1b")).toBe(false);
        expect(isPartialMouseReport("\x1b[1;5")).toBe(false);
        expect(isPartialMouseReport("\x1b[M")).toBe(true);
        expect(isPartialMouseReport("\x1b[M\x20\x51")).toBe(true);
    });

    test("an out-of-range SGR button does not become a left click", () => {
        // 256 truncates to button 0 under ToInt32. Reaching routing that is a
        // real click at the reported cell, invented out of a corrupt frame.
        const result = decodeLegacy("\x1b[<256;1;1M", "");
        expect(result.events).toEqual([]);
        expect(result.carry).toBe("");
    });

    test("a stranded SGR prefix is discarded when the next byte rules it out", () => {
        // The tail of the first click is lost and the next one arrives before
        // the drop window expires. The ESC that starts it makes the held run an
        // invalid CSI, and the generic recovery for that emits Escape and walks
        // the rest out one character at a time — so the parameters of the dead
        // report land on the keymap while the live click is still delivered.
        const first = decodeLegacy("\x1b[<0;50;10", "");
        expect(first.carry).toBe("\x1b[<0;50;10");
        const second = decodeLegacy("\x1b[<0;1;1M", first.carry);
        expect(second.events).toEqual([
            { kind: "mouse", action: "press", button: "left", col: 0, row: 0, mods: noMods() },
        ]);
        expect(second.carry).toBe("");
    });

    test("a stranded SGR prefix does not swallow the key that follows it", () => {
        // Ctrl+C is not a CSI byte, so it ends the held run the same way an ESC
        // does. Discarding the run must resume on it rather than consume it.
        const result = decodeLegacy("\x03", "\x1b[<0;50;10");
        expect(result.events).toEqual([
            { name: "char", char: "c", mods: { ...noMods(), ctrl: true }, kind: "press" },
        ]);
        expect(result.carry).toBe("");
    });

    test("an ordinary invalid CSI still reports a real Escape press", () => {
        // Only a `CSI <` run is known to be report parameters. Anything else
        // keeps the recovery that treats the ESC as a keypress.
        const result = decodeLegacy("\x1b[1;5\x03", "");
        expect(keysOf(result.events).map((e) => e.name)).toEqual([
            "escape",
            "char",
            "char",
            "char",
            "char",
            "char",
        ]);
    });

    test("a malformed SGR report is consumed without emitting keystrokes", () => {
        // The sequence is still a complete CSI, so it must not fall through to
        // the key branches or be left in the buffer.
        const result = decodeLegacy("\x1b[<0;0;1M", "");
        expect(result.events).toEqual([]);
        expect(result.carry).toBe("");
    });

    test("a CSI carrying intermediate bytes is not read as an SGR mouse report", () => {
        // `CSI <0;1;1 M` — an intermediate byte (0x20) sits between the
        // parameters and the final, so this is not the SGR mouse form however
        // much its parameters look like one. Read as one it fabricates a left
        // click on the origin, which moves the sidebar selection. The X10
        // branch above already refuses a sequence with intermediates; this is
        // the same rule on the SGR side.
        const result = decodeLegacy("\x1b[<0;1;1\x20M", "");
        expect(result.events).toEqual([]);
        expect(result.carry).toBe("");
    });
});
