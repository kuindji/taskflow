import { describe, test, expect } from "bun:test";
import { blankCell, cellsEqual, ATTR_BOLD, ATTR_UNDERLINE, type Cell } from "./cells";
import { sgrDiff } from "./sgr";

function cell(patch: Partial<Cell>): Cell {
    return { ...blankCell(), ...patch };
}

describe("sgrDiff", () => {
    test("emits nothing when the attribute state is unchanged", () => {
        const a = cell({ fg: { kind: "palette", index: 4 } });
        expect(sgrDiff(a, cell({ fg: { kind: "palette", index: 4 } }))).toBe("");
    });

    test("emits an indexed foreground for a palette color, never rgb", () => {
        const out = sgrDiff(null, cell({ fg: { kind: "palette", index: 4 } }));
        expect(out).toBe("\x1b[0;38;5;4m");
        expect(out).not.toContain("38;2");
    });

    test("emits truecolor only for an rgb color", () => {
        const out = sgrDiff(null, cell({ fg: { kind: "rgb", r: 1, g: 2, b: 3 } }));
        expect(out).toBe("\x1b[0;38;2;1;2;3m");
    });

    test("resets to default when returning to a default color", () => {
        const from = cell({ fg: { kind: "palette", index: 4 } });
        expect(sgrDiff(from, blankCell())).toBe("\x1b[0m");
    });

    test("encodes attributes alongside color", () => {
        const out = sgrDiff(null, cell({ attrs: ATTR_BOLD | ATTR_UNDERLINE }));
        expect(out).toBe("\x1b[0;1;4m");
    });
});

describe("cellsEqual", () => {
    test("distinguishes palette index from rgb with the same number", () => {
        const a = cell({ fg: { kind: "palette", index: 1 } });
        const b = cell({ fg: { kind: "rgb", r: 1, g: 1, b: 1 } });
        expect(cellsEqual(a, b)).toBe(false);
    });

    test("treats identical cells as equal", () => {
        expect(cellsEqual(cell({ ch: "x" }), cell({ ch: "x" }))).toBe(true);
    });
});

describe("sgrDiff — glyph metrics are not attribute state", () => {
    test("emits nothing when only the character differs", () => {
        expect(sgrDiff(cell({ ch: "a" }), cell({ ch: "b" }))).toBe("");
    });

    test("emits nothing when only the width differs", () => {
        const from = cell({ ch: "漢", width: 2 });
        expect(sgrDiff(from, cell({ ch: "", width: 0 }))).toBe("");
    });

    test("still emits when the style differs alongside a width change", () => {
        const from = cell({ ch: "漢", width: 2 });
        expect(sgrDiff(from, cell({ ch: "", width: 0, attrs: ATTR_BOLD }))).toBe("\x1b[0;1m");
    });
});
