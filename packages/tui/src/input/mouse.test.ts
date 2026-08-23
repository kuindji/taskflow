import { describe, test, expect } from "bun:test";
import { parseSgrMouse, parseX10Mouse } from "./mouse";
import { noMods } from "./keys";

describe("parseSgrMouse", () => {
    test("a left press reports zero-based coordinates", () => {
        expect(parseSgrMouse("<0;12;5", "M")).toEqual({
            kind: "mouse",
            action: "press",
            button: "left",
            col: 11,
            row: 4,
            mods: noMods(),
        });
    });

    test("the m final is a release and keeps the button", () => {
        expect(parseSgrMouse("<2;1;1", "m")?.action).toBe("release");
        expect(parseSgrMouse("<2;1;1", "m")?.button).toBe("right");
    });

    test("bit 32 is a drag", () => {
        expect(parseSgrMouse("<32;3;3", "M")?.action).toBe("drag");
        expect(parseSgrMouse("<32;3;3", "M")?.button).toBe("left");
    });

    test("bit 64 is the wheel", () => {
        expect(parseSgrMouse("<64;1;1", "M")?.button).toBe("wheel-up");
        expect(parseSgrMouse("<65;1;1", "M")?.button).toBe("wheel-down");
    });

    test("bit 128 is an extra button and is not mistaken for a left click", () => {
        // xterm encodes buttons 8-11 as 128 + (n - 8). Without a bit-128 check
        // these fall through to PLAIN_BUTTONS[b & 3] and read as left/middle/right.
        expect(parseSgrMouse("<128;6;8", "M")?.button).toBe("none");
        expect(parseSgrMouse("<129;6;8", "M")?.button).toBe("none");
        expect(parseSgrMouse("<130;6;8", "M")?.button).toBe("none");
    });

    test("modifier bits are read", () => {
        expect(parseSgrMouse("<28;1;1", "M")?.mods).toEqual({
            shift: true,
            alt: true,
            ctrl: true,
            super: false,
        });
    });

    test("a malformed report is dropped rather than decoded as position 0,0", () => {
        expect(parseSgrMouse("<0;12", "M")).toBeUndefined();
        expect(parseSgrMouse("<;;", "M")).toBeUndefined();
        expect(parseSgrMouse("<0;0;1", "M")).toBeUndefined(); // 1-based, so 0 is invalid
    });

    test("parameters that are not an SGR report are dropped", () => {
        // `CSI 0;12;5 M` without the `<` is not the SGR mouse form at all.
        expect(parseSgrMouse("0;12;5", "M")).toBeUndefined();
    });
});

describe("parseX10Mouse", () => {
    test("a left press at 1,1 is the origin", () => {
        expect(parseX10Mouse("\x20\x21\x21")).toEqual({
            kind: "mouse",
            action: "press",
            button: "left",
            col: 0,
            row: 0,
            mods: noMods(),
        });
    });

    test("button 3 is a release with no known button", () => {
        const report = parseX10Mouse("\x23\x21\x21");
        expect(report?.action).toBe("release");
        expect(report?.button).toBe("none");
    });

    test("a wheel notch keeps its direction rather than reading as a release", () => {
        // 64 + 3 has `b & 3 === 3`, which is the release value in the plain
        // form. Bit 64 means the low bits name a wheel direction instead.
        const report = parseX10Mouse(String.fromCharCode(32 + 67, 0x21, 0x21));
        expect(report?.action).toBe("press");
        expect(report?.button).toBe("wheel-right");
    });

    test("an extra button is a press, not the release sentinel", () => {
        // Button 11 is `128 + 3`, so `b & 3` is the plain form's release value
        // by coincidence. Bit 128 has to be excluded from the release test the
        // same way `buttonOf` tests it first.
        const report = parseX10Mouse(String.fromCharCode(32 + 131, 0x21, 0x21));
        expect(report?.action).toBe("press");
        expect(report?.button).toBe("none");
    });

    test("a payload shorter than three code units is dropped", () => {
        expect(parseX10Mouse("\x20\x21")).toBeUndefined();
    });

    test("a payload byte below the 32 bias is dropped", () => {
        expect(parseX10Mouse("\x01\x21\x21")).toBeUndefined();
    });
});
