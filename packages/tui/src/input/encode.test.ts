import { describe, test, expect } from "bun:test";
import { encodeForChild, encodePaste, type ChildModes } from "./encode";
import { noMods, type KeyEvent } from "./keys";

const legacy: ChildModes = {
    applicationCursorKeys: false,
    bracketedPaste: false,
    kittyFlags: null,
};

function key(patch: Partial<KeyEvent>): KeyEvent {
    return { name: "char", mods: noMods(), kind: "press", ...patch };
}

describe("encodeForChild", () => {
    test("encodes a plain character as itself", () => {
        expect(encodeForChild(key({ name: "char", char: "a" }), legacy)).toBe("a");
    });

    test("encodes ctrl plus letter as a control byte", () => {
        const ev = key({ name: "char", char: "c", mods: { ...noMods(), ctrl: true } });
        expect(encodeForChild(ev, legacy)).toBe("\x03");
    });

    test("encodes alt plus character with an escape prefix", () => {
        const ev = key({ name: "char", char: "b", mods: { ...noMods(), alt: true } });
        expect(encodeForChild(ev, legacy)).toBe("\x1bb");
    });

    test("encodes arrows as CSI by default", () => {
        expect(encodeForChild(key({ name: "up" }), legacy)).toBe("\x1b[A");
    });

    test("encodes arrows as SS3 under application cursor keys mode", () => {
        const modes = { ...legacy, applicationCursorKeys: true };
        expect(encodeForChild(key({ name: "up" }), modes)).toBe("\x1bOA");
    });

    test("keeps CSI form for a modified arrow even in application mode", () => {
        const modes = { ...legacy, applicationCursorKeys: true };
        const ev = key({ name: "right", mods: { ...noMods(), ctrl: true } });
        expect(encodeForChild(ev, modes)).toBe("\x1b[1;5C");
    });

    test("encodes enter, tab, backspace and escape", () => {
        expect(encodeForChild(key({ name: "enter" }), legacy)).toBe("\r");
        expect(encodeForChild(key({ name: "tab" }), legacy)).toBe("\t");
        expect(encodeForChild(key({ name: "backspace" }), legacy)).toBe("\x7f");
        expect(encodeForChild(key({ name: "escape" }), legacy)).toBe("\x1b");
    });

    test("encodes CSI u when the child pushed the kitty protocol", () => {
        const modes = { ...legacy, kittyFlags: 1 };
        const ev = key({ name: "enter", mods: { ...noMods(), shift: true } });
        expect(encodeForChild(ev, modes)).toBe("\x1b[13;2u");
    });

    test("keeps plain text literal under flag 1", () => {
        const modes = { ...legacy, kittyFlags: 1 };
        expect(encodeForChild(key({ name: "char", char: "a" }), modes)).toBe("a");
    });

    test("sends Ctrl+C as CSI u under flag 1, not as an interrupt byte", () => {
        // Per the kitty spec, flag 1 means "ctrl+c will no longer generate the
        // SIGINT signal, but instead be delivered as a CSI u escape code".
        const modes = { ...legacy, kittyFlags: 1 };
        const ev = key({ name: "char", char: "c", mods: { ...noMods(), ctrl: true } });
        expect(encodeForChild(ev, modes)).toBe("\x1b[99;5u");
    });

    test("sends Alt+key and Escape as CSI u under flag 1", () => {
        const modes = { ...legacy, kittyFlags: 1 };
        const alt = key({ name: "char", char: "a", mods: { ...noMods(), alt: true } });
        expect(encodeForChild(alt, modes)).toBe("\x1b[97;3u");
        expect(encodeForChild(key({ name: "escape" }), modes)).toBe("\x1b[27u");
    });

    test("keeps Enter legacy under flag 1, for shell compatibility", () => {
        const modes = { ...legacy, kittyFlags: 1 };
        expect(encodeForChild(key({ name: "enter" }), modes)).toBe("\r");
    });

    test("uses CSI u under flag 8, which asks for all keys as escape codes", () => {
        const modes = { ...legacy, kittyFlags: 8 };
        expect(encodeForChild(key({ name: "char", char: "a" }), modes)).toBe("\x1b[97u");
    });

    test("drops a release when the child did not request event types", () => {
        const modes = { ...legacy, kittyFlags: 1 };
        const ev = key({ name: "char", char: "a", kind: "release" });
        expect(encodeForChild(ev, modes)).toBe("");
    });

    test("drops release events for a child that did not ask for them", () => {
        expect(encodeForChild(key({ name: "char", char: "a", kind: "release" }), legacy)).toBe("");
    });

    test("round-trips Shift+Tab as back-tab for a legacy child", () => {
        // decodeLegacy turns `CSI Z` into tab with shift; a plain \t would lose
        // the reverse direction.
        const ev = key({ name: "tab", mods: { ...noMods(), shift: true } });
        expect(encodeForChild(ev, legacy)).toBe("\x1b[Z");
    });

    test("round-trips non-letter ctrl chords to their C0 bytes", () => {
        // decodeControl reports NUL as Ctrl+@ and 0x1d as Ctrl+]; sending the
        // printable character back would not reach the child as a control key.
        const ctrl = (char: string): KeyEvent =>
            key({ name: "char", char, mods: { ...noMods(), ctrl: true } });
        expect(encodeForChild(ctrl("@"), legacy)).toBe("\x00");
        expect(encodeForChild(ctrl("]"), legacy)).toBe("\x1d");
        expect(encodeForChild(ctrl("\\"), legacy)).toBe("\x1c");
        expect(encodeForChild(ctrl("_"), legacy)).toBe("\x1f");
    });

    test("round-trips Ctrl+Space to NUL for a legacy child", () => {
        // The kitty decoder reports `CSI 32;5u` as a space char with ctrl held,
        // not as an `@`, so the C0 mapping has to cover it or the chord reaches
        // the child as an ordinary space.
        const ev = key({ name: "char", char: " ", mods: { ...noMods(), ctrl: true } });
        expect(encodeForChild(ev, legacy)).toBe("\x00");
        expect(encodeForChild(key({ name: "space", mods: { ...noMods(), ctrl: true } }), legacy)).toBe(
            "\x00",
        );
    });

    test("treats a repeat as a press for a child that does not report events", () => {
        // Per the kitty spec, without the report-event-types flag "key repeat
        // events are treated as key press events" — dropping them would stop
        // auto-repeat from reaching the child.
        expect(encodeForChild(key({ name: "char", char: "a", kind: "repeat" }), legacy)).toBe("a");
        const modes = { ...legacy, kittyFlags: 1 };
        expect(encodeForChild(key({ name: "char", char: "a", kind: "repeat" }), modes)).toBe("a");
    });

    test("reports no release for a text key under flags 1 and 2", () => {
        // The spec only reports release events for keys that are sent as escape
        // codes; emitting the legacy bytes would look like a second keypress.
        const modes = { ...legacy, kittyFlags: 1 | 2 };
        expect(encodeForChild(key({ name: "char", char: "a", kind: "release" }), modes)).toBe("");
        expect(encodeForChild(key({ name: "enter", kind: "release" }), modes)).toBe("");
    });

    test("keeps Ctrl+C legacy for a child that asked only for event types", () => {
        // Flag 1 is what moves ctrl/alt/escape to CSI u. A child that pushed
        // only flag 2 never asked for that, so Ctrl+C must still be the
        // interrupt byte rather than an escape code it will not understand.
        const modes = { ...legacy, kittyFlags: 2 };
        const ev = key({ name: "char", char: "c", mods: { ...noMods(), ctrl: true } });
        expect(encodeForChild(ev, modes)).toBe("\x03");
    });

    test("treats a repeat as a press when the key has no escape code to tag", () => {
        // Flag 2 is ignored for keys that stay legacy: there is nowhere to put
        // the event subparameter, so a repeat has to look like another press or
        // auto-repeat stops reaching the child.
        const modes = { ...legacy, kittyFlags: 1 | 2 };
        expect(encodeForChild(key({ name: "char", char: "a", kind: "repeat" }), modes)).toBe("a");
        expect(encodeForChild(key({ name: "enter", kind: "repeat" }), modes)).toBe("\r");
    });

    test("tags a functional-key release with the kitty event type", () => {
        const modes = { ...legacy, kittyFlags: 1 | 2 };
        expect(encodeForChild(key({ name: "up", kind: "release" }), modes)).toBe("\x1b[1;1:3A");
        expect(encodeForChild(key({ name: "delete", kind: "repeat" }), modes)).toBe("\x1b[3;1:2~");
    });
});

describe("encodePaste", () => {
    test("wraps the text when bracketed paste is enabled", () => {
        const modes = { ...legacy, bracketedPaste: true };
        expect(encodePaste("hi", modes)).toBe("\x1b[200~hi\x1b[201~");
    });

    test("sends the text bare when bracketed paste is disabled", () => {
        expect(encodePaste("hi", legacy)).toBe("hi");
    });
});
