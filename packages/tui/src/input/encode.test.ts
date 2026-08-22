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
