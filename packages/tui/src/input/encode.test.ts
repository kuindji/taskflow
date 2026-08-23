import { describe, test, expect } from "bun:test";
import { encodeForChild, encodeMouseForChild, encodePaste, type ChildModes } from "./encode";
import { noMods, type KeyEvent } from "./keys";
import type { MouseReport } from "./mouse";

const legacy: ChildModes = {
    applicationCursorKeys: false,
    bracketedPaste: false,
    kittyFlags: null,
    mouseTracking: "none",
    mouseEncoding: "x10",
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

    test("round-trips ctrl plus digit chords to their C0 bytes", () => {
        // A kitty terminal reports Ctrl+6 as `CSI 54;5u`, so the decoder hands
        // us the digit itself; xterm's table is what a legacy child expects.
        const ctrl = (char: string): KeyEvent =>
            key({ name: "char", char, mods: { ...noMods(), ctrl: true } });
        expect(encodeForChild(ctrl("2"), legacy)).toBe("\x00");
        expect(encodeForChild(ctrl("3"), legacy)).toBe("\x1b");
        expect(encodeForChild(ctrl("4"), legacy)).toBe("\x1c");
        expect(encodeForChild(ctrl("5"), legacy)).toBe("\x1d");
        expect(encodeForChild(ctrl("6"), legacy)).toBe("\x1e");
        expect(encodeForChild(ctrl("7"), legacy)).toBe("\x1f");
        expect(encodeForChild(ctrl("8"), legacy)).toBe("\x7f");
        expect(encodeForChild(ctrl("/"), legacy)).toBe("\x1f");
        expect(encodeForChild(ctrl("?"), legacy)).toBe("\x7f");
        // Unmodified digits are still text.
        expect(encodeForChild(key({ name: "char", char: "6" }), legacy)).toBe("6");
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

const press: MouseReport = {
    kind: "mouse",
    action: "press",
    button: "left",
    col: 11,
    row: 4,
    mods: noMods(),
};

function modes(patch: Partial<ChildModes>): ChildModes {
    return { ...legacy, ...patch };
}

describe("encodeMouseForChild", () => {
    test("a child that never asked for the mouse receives nothing", () => {
        expect(encodeMouseForChild(press, modes({ mouseTracking: "none" }))).toBe("");
    });

    test("SGR encoding is one-based and keeps the button on release", () => {
        expect(
            encodeMouseForChild(press, modes({ mouseTracking: "vt200", mouseEncoding: "sgr" })),
        ).toBe("\x1b[<0;12;5M");
        expect(
            encodeMouseForChild(
                { ...press, action: "release", button: "right" },
                modes({ mouseTracking: "vt200", mouseEncoding: "sgr" }),
            ),
        ).toBe("\x1b[<2;12;5m");
    });

    test("X10 encoding offsets by 32 and spells a release as button 3", () => {
        expect(
            encodeMouseForChild(press, modes({ mouseTracking: "vt200", mouseEncoding: "x10" })),
        ).toBe("\x1b[M\x20\x2c\x25");
        expect(
            encodeMouseForChild(
                { ...press, action: "release" },
                modes({ mouseTracking: "vt200", mouseEncoding: "x10" }),
            ),
        ).toBe("\x1b[M\x23\x2c\x25");
    });

    test("X10 encoding drops a report whose bytes would not survive the transport", () => {
        const x10 = modes({ mouseTracking: "vt200", mouseEncoding: "x10" });
        // Zero-based 94 is one-based 95 is byte 127 — the last one that stays a
        // single byte through pty.write's UTF-8 encoding.
        expect(encodeMouseForChild({ ...press, col: 94 }, x10)).not.toBe("");
        // 95 is byte 128, which arrives as two bytes and desyncs the child's parser.
        expect(encodeMouseForChild({ ...press, col: 95 }, x10)).toBe("");
        expect(encodeMouseForChild({ ...press, row: 95 }, x10)).toBe("");
        expect(encodeMouseForChild({ ...press, col: 300 }, x10)).toBe("");
    });

    test("X10 encoding drops a report whose button byte alone is over the cap", () => {
        // wheel-right (67) + drag (32) + shift/alt/ctrl (28) is 127, and 127 + 32
        // is 159 — a button field that would arrive as two bytes even though both
        // coordinates are tiny.
        const wide: MouseReport = {
            ...press,
            action: "drag",
            button: "wheel-right",
            col: 0,
            row: 0,
            mods: { shift: true, alt: true, ctrl: true, super: false },
        };
        expect(encodeMouseForChild(wide, modes({ mouseTracking: "drag", mouseEncoding: "x10" }))).toBe(
            "",
        );
    });

    test("UTF-8 encoding is not capped, because the transport is the encoding", () => {
        // ?1005 asks for the coordinates as UTF-8, which is exactly what
        // pty.write does to the string — so a wide column survives intact.
        expect(
            encodeMouseForChild(
                { ...press, col: 200 },
                modes({ mouseTracking: "vt200", mouseEncoding: "utf8" }),
            ),
        ).toBe(`\x1b[M\x20${String.fromCharCode(233)}\x25`);
    });

    test("urxvt encoding is decimal with the offset applied to the button", () => {
        expect(
            encodeMouseForChild(press, modes({ mouseTracking: "vt200", mouseEncoding: "urxvt" })),
        ).toBe("\x1b[32;12;5M");
    });

    test("vt200 tracking drops a drag but keeps press and release", () => {
        expect(encodeMouseForChild({ ...press, action: "drag" }, modes({ mouseTracking: "vt200" }))).toBe(
            "",
        );
        expect(
            encodeMouseForChild({ ...press, action: "release" }, modes({ mouseTracking: "vt200" })),
        ).not.toBe("");
    });

    test("drag tracking forwards all three actions", () => {
        const m = modes({ mouseTracking: "drag", mouseEncoding: "sgr" });
        expect(encodeMouseForChild({ ...press, action: "drag" }, m)).toBe("\x1b[<32;12;5M");
        expect(encodeMouseForChild({ ...press, action: "release" }, m)).toBe("\x1b[<0;12;5m");
        expect(encodeMouseForChild(press, m)).toBe("\x1b[<0;12;5M");
    });

    test("any tracking behaves the same as drag", () => {
        const m = modes({ mouseTracking: "any", mouseEncoding: "sgr" });
        expect(encodeMouseForChild({ ...press, action: "drag" }, m)).toBe("\x1b[<32;12;5M");
        expect(encodeMouseForChild({ ...press, action: "release" }, m)).toBe("\x1b[<0;12;5m");
    });

    test("x10 tracking drops release and drag, and reports no modifiers", () => {
        const m = modes({ mouseTracking: "x10", mouseEncoding: "sgr" });
        expect(encodeMouseForChild({ ...press, action: "release" }, m)).toBe("");
        expect(encodeMouseForChild({ ...press, action: "drag" }, m)).toBe("");
        expect(encodeMouseForChild({ ...press, mods: { ...noMods(), ctrl: true } }, m)).toBe(
            "\x1b[<0;12;5M",
        );
    });

    test("modifier bits ride the button under vt200", () => {
        expect(
            encodeMouseForChild(
                { ...press, mods: { ...noMods(), ctrl: true } },
                modes({ mouseTracking: "vt200", mouseEncoding: "sgr" }),
            ),
        ).toBe("\x1b[<16;12;5M");
        expect(
            encodeMouseForChild(
                { ...press, mods: { shift: true, alt: true, ctrl: false, super: false } },
                modes({ mouseTracking: "vt200", mouseEncoding: "sgr" }),
            ),
        ).toBe("\x1b[<12;12;5M");
    });

    test("a drag sets bit 32", () => {
        expect(
            encodeMouseForChild(
                { ...press, action: "drag" },
                modes({ mouseTracking: "drag", mouseEncoding: "sgr" }),
            ),
        ).toBe("\x1b[<32;12;5M");
    });

    test("the wheel is a press", () => {
        expect(
            encodeMouseForChild(
                { ...press, button: "wheel-up" },
                modes({ mouseTracking: "vt200", mouseEncoding: "sgr" }),
            ),
        ).toBe("\x1b[<64;12;5M");
        expect(
            encodeMouseForChild(
                { ...press, button: "wheel-down" },
                modes({ mouseTracking: "vt200", mouseEncoding: "sgr" }),
            ),
        ).toBe("\x1b[<65;12;5M");
    });

    test("a button that cannot be named is not sent as a left click", () => {
        // An extra button (8-11) decodes as "none": there is no button number for it.
        expect(
            encodeMouseForChild(
                { ...press, button: "none" },
                modes({ mouseTracking: "vt200", mouseEncoding: "sgr" }),
            ),
        ).toBe("");
    });

    test("an unnamed release is button 3 everywhere except SGR", () => {
        const release = { ...press, action: "release" as const, button: "none" as const };
        expect(
            encodeMouseForChild(release, modes({ mouseTracking: "vt200", mouseEncoding: "x10" })),
        ).toBe("\x1b[M\x23\x2c\x25");
        expect(
            encodeMouseForChild(release, modes({ mouseTracking: "vt200", mouseEncoding: "urxvt" })),
        ).toBe("\x1b[35;12;5M");
        expect(
            encodeMouseForChild(release, modes({ mouseTracking: "vt200", mouseEncoding: "sgr" })),
        ).toBe("");
    });

    test("pixel mouse mode is refused rather than answered in cells", () => {
        expect(
            encodeMouseForChild(press, modes({ mouseTracking: "drag", mouseEncoding: "sgr-pixels" })),
        ).toBe("");
    });
});
