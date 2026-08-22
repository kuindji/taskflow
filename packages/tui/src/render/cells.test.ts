import { describe, test, expect } from "bun:test";
import { ScreenBuffer, blankCell, cellsEqual, stylesEqual, type Cell } from "./cells";

function cell(patch: Partial<Cell>): Cell {
    return { ...blankCell(), ...patch };
}

describe("ScreenBuffer", () => {
    test("get throws instead of wrapping when x runs past the right edge", () => {
        const buf = new ScreenBuffer(3, 2);
        buf.set(0, 1, cell({ ch: "X" }));
        expect(() => buf.get(3, 0)).toThrow(RangeError);
    });

    test("get throws instead of wrapping when x is negative", () => {
        const buf = new ScreenBuffer(3, 2);
        buf.set(2, 0, cell({ ch: "Y" }));
        expect(() => buf.get(-1, 1)).toThrow(RangeError);
    });

    test("get throws when y is out of range", () => {
        const buf = new ScreenBuffer(3, 2);
        expect(() => buf.get(0, 2)).toThrow(RangeError);
        expect(() => buf.get(0, -1)).toThrow(RangeError);
    });

    test("get returns the cell that set stored", () => {
        const buf = new ScreenBuffer(3, 2);
        buf.set(2, 1, cell({ ch: "Z" }));
        expect(buf.get(2, 1).ch).toBe("Z");
    });

    test("set silently ignores writes outside the grid", () => {
        const buf = new ScreenBuffer(3, 2);
        buf.set(3, 0, cell({ ch: "X" }));
        buf.set(0, 2, cell({ ch: "X" }));
        expect(buf.get(0, 1).ch).toBe(" ");
    });

    test("clear restores every cell to blank", () => {
        const buf = new ScreenBuffer(2, 2);
        buf.set(1, 1, cell({ ch: "Q", attrs: 1 }));
        buf.clear();
        expect(cellsEqual(buf.get(1, 1), blankCell())).toBe(true);
    });
});

describe("blankCell", () => {
    test("the shared default color cannot be mutated in place", () => {
        const a = blankCell();
        const b = blankCell();
        expect(() => Object.assign(a.fg, { kind: "palette", index: 2 })).toThrow(TypeError);
        // What the throw prevents: fg and bg of every blank cell in the
        // process are the same object, so a successful mutation would
        // recolour cells nothing ever touched.
        expect(b.fg).toEqual({ kind: "default" });
        expect(a.bg).toEqual({ kind: "default" });
    });
});

describe("stylesEqual", () => {
    test("ignores ch and width", () => {
        expect(stylesEqual(cell({ ch: "a", width: 1 }), cell({ ch: "", width: 0 }))).toBe(true);
    });

    test("still distinguishes attributes and colors", () => {
        expect(stylesEqual(cell({ attrs: 1 }), cell({ attrs: 0 }))).toBe(false);
        expect(stylesEqual(cell({ bg: { kind: "palette", index: 2 } }), blankCell())).toBe(false);
    });
});
