import { describe, test, expect } from "bun:test";
import { ATTR_BOLD } from "./cells";
import { fitToWidth, layoutText } from "./text";

describe("fitToWidth", () => {
    test("keeps a string that already fits", () => {
        expect(fitToWidth("Alpha", 10)).toBe("Alpha");
    });

    test("truncates an ascii string to the column count", () => {
        expect(fitToWidth("AnExtremelyLongTitle", 5)).toBe("AnExt");
    });

    test("counts a wide glyph as two columns", () => {
        expect(fitToWidth("你好", 3)).toBe("你");
        expect(fitToWidth("你好", 4)).toBe("你好");
    });

    test("counts an astral emoji as two columns and never splits it", () => {
        expect(fitToWidth("🚀x", 2)).toBe("🚀");
        expect(fitToWidth("🚀x", 1)).toBe("");
    });

    test("keeps a combining mark attached to its base character", () => {
        expect(fitToWidth("éx", 1)).toBe("é");
    });

    test("returns an empty string for a non-positive column count", () => {
        expect(fitToWidth("Alpha", 0)).toBe("");
        expect(fitToWidth("Alpha", -3)).toBe("");
    });

    test("drops a standalone zero-width cluster with no base to ride on", () => {
        // A leading combining mark has nothing to attach to inside the label.
        // Kept, it would attach to whatever the caller concatenates in front of
        // it, so `layoutText` drops it and `fitToWidth` must agree.
        expect(fitToWidth("\u0301A", 0)).toBe("");
        expect(fitToWidth("\u0301A", 1)).toBe("A");
    });
});

describe("layoutText", () => {
    test("returns exactly the requested number of cells", () => {
        expect(layoutText("ab", 5, 0)).toHaveLength(5);
        expect(layoutText("abcdef", 3, 0)).toHaveLength(3);
        expect(layoutText("ab", 0, 0)).toHaveLength(0);
        expect(layoutText("ab", -2, 0)).toHaveLength(0);
    });

    test("pads with blanks that carry the row attributes", () => {
        const cells = layoutText("a", 3, ATTR_BOLD);
        expect(cells.map((c) => c.ch)).toEqual(["a", " ", " "]);
        expect(cells.every((c) => c.attrs === ATTR_BOLD)).toBe(true);
    });

    test("gives a wide glyph one width-2 cell and a width-0 continuation", () => {
        const cells = layoutText("你a", 4, 0);
        expect(cells[0]?.ch).toBe("你");
        expect(cells[0]?.width).toBe(2);
        expect(cells[1]?.ch).toBe("");
        expect(cells[1]?.width).toBe(0);
        expect(cells[2]?.ch).toBe("a");
        expect(cells[2]?.width).toBe(1);
    });

    test("keeps an astral emoji in one cell instead of splitting its code units", () => {
        const cells = layoutText("🚀", 4, 0);
        expect(cells[0]?.ch).toBe("🚀");
        expect(cells[0]?.width).toBe(2);
        expect(cells[1]?.width).toBe(0);
    });

    test("clips a wide glyph that would straddle the last column to a space", () => {
        const cells = layoutText("a你", 2, 0);
        expect(cells.map((c) => c.ch)).toEqual(["a", " "]);
        expect(cells.map((c) => c.width)).toEqual([1, 1]);
    });

    test("keeps a combining mark in the cell of its base character", () => {
        const cells = layoutText("éb", 3, 0);
        expect(cells[0]?.ch).toBe("é");
        expect(cells[0]?.width).toBe(1);
        expect(cells[1]?.ch).toBe("b");
    });

    test("replaces a control character with a blank so it cannot move the cursor", () => {
        const cells = layoutText("a\nb", 3, 0);
        expect(cells.map((c) => c.ch)).toEqual(["a", " ", "b"]);
        expect(cells.every((c) => c.width === 1)).toBe(true);
    });

    test("blanks a control sequence the segmenter kept as one grapheme", () => {
        // `Intl.Segmenter` groups CRLF into a single grapheme, so a per-grapheme
        // control test has to look inside the cluster: `Screen.flush` writes any
        // cell whose width is not zero, and a raw "\r\n" would carry the cursor
        // to the start of the next line in the middle of a frame.
        const cells = layoutText("a\r\nb", 4, 0);
        expect(cells.map((c) => c.ch)).toEqual(["a", " ", "b", " "]);
        expect(cells.every((c) => c.width === 1)).toBe(true);
    });

    test("blanks an unpaired surrogate", () => {
        // A lone surrogate is not a printable character: `Screen.flush` writes
        // `cell.ch` for every cell whose width is not zero, and encoding a half
        // surrogate pair to the stream emits U+FFFD, so the frame shows
        // mojibake where a blank belongs.
        const high = layoutText("a\uD83Db", 4, 0);
        expect(high.map((c) => c.ch)).toEqual(["a", " ", "b", " "]);
        const low = layoutText("\uDE80", 1, 0);
        expect(low.map((c) => c.ch)).toEqual([" "]);
        expect(low.every((c) => c.width === 1)).toBe(true);
    });

    test("keeps a well-formed surrogate pair as one wide glyph", () => {
        // The blanking rule must not catch a paired astral character.
        const cells = layoutText("\u{1F680}", 3, 0);
        expect(cells.map((c) => c.ch)).toEqual(["\u{1F680}", "", " "]);
        expect(cells.map((c) => c.width)).toEqual([2, 0, 1]);
    });

    test("returns a distinct cell object per column", () => {
        // ScreenBuffer.set takes ownership of the cell it is handed, so two
        // columns must never share one object.
        const cells = layoutText("aa", 2, 0);
        expect(cells[0]).not.toBe(cells[1]);
    });
});
