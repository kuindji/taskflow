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

    test("counts every East Asian Wide character as two columns, not just the CJK blocks", () => {
        // One sample per wide range that lives outside the big ideograph blocks:
        // trigrams, monograms, hexagrams, Kana Extended-B, Tai Xuan Jing,
        // counting rods, and the newer emoji. U+16FF0..U+16FF1 is the one wide
        // range with no eligible sample \u2014 every member is a spacing mark, which
        // the test below covers instead.
        const wide = [
            "\u2630",
            "\u268a",
            "\u4dc0",
            "\u{1aff0}",
            "\u{1d300}",
            "\u{1d360}",
            "\u{1f6dc}",
            "\u{1f7f0}",
        ];
        for (const ch of wide) {
            expect(fitToWidth(`${ch}x`, 2)).toBe(ch);
        }
    });

    test("leaves an ambiguous-width character narrow", () => {
        // U+3248 is East Asian Ambiguous, which a terminal draws in one column
        // unless it is told otherwise.
        expect(fitToWidth("\u3248x", 2)).toBe("\u3248x");
    });

    test("counts an emoji presentation sequence as two columns", () => {
        // U+26A0 alone is East Asian Neutral and stays narrow, but U+FE0F
        // promotes the cluster to emoji presentation and the terminal advances
        // two columns for it.
        expect(fitToWidth("\u26a0\ufe0fx", 2)).toBe("\u26a0\ufe0f");
        expect(fitToWidth("\u26a0x", 2)).toBe("\u26a0x");
    });

    test("counts a flag as two columns", () => {
        // A pair of regional indicators is one two-column glyph, and neither
        // half is East Asian Wide on its own.
        expect(fitToWidth("\u{1f1fa}\u{1f1f8}x", 2)).toBe("\u{1f1fa}\u{1f1f8}");
    });

    test("counts a keycap sequence as two columns", () => {
        expect(fitToWidth("1\ufe0f\u20e3x", 2)).toBe("1\ufe0f\u20e3");
    });

    test("drops a standalone zero-width cluster with no base to ride on", () => {
        // A leading combining mark has nothing to attach to inside the label.
        // Kept, it would attach to whatever the caller concatenates in front of
        // it, so `layoutText` drops it and `fitToWidth` must agree.
        expect(fitToWidth("\u0301A", 0)).toBe("");
        expect(fitToWidth("\u0301A", 1)).toBe("A");
    });

    test("drops a standalone spacing mark, which also has no base to ride on", () => {
        // U+093E DEVANAGARI VOWEL SIGN AA is `Mc`, not `Mn`, so it is not
        // zero-width, but the segmenter only ever hands it over alone when it
        // has nothing to attach to, and `Mc` binds to the preceding cluster.
        // Kept in the returned prefix, it would bind to the caller's own
        // padding once concatenated.
        expect(fitToWidth("\u093eA", 2)).toBe("A");
        expect(fitToWidth("\u0915\u093eA", 2)).toBe("\u0915\u093eA");
    });

    test("drops a baseless spacing mark even where the width table calls it wide", () => {
        // U+302E, U+302F, U+16FF0 and U+16FF1 are the only four East Asian Wide
        // code points that are also spacing marks. Being wide does not make a
        // baseless one safe to keep: it still binds to whatever the caller
        // concatenates ahead of it, so it is dropped like any other.
        for (const mark of ["\u302e", "\u302f", "\u{16ff0}", "\u{16ff1}"]) {
            expect(fitToWidth(`${mark}A`, 2)).toBe("A");
        }
    });

    test("keeps the printable base behind a format character that binds forwards", () => {
        // U+0600 ARABIC NUMBER SIGN is `Cf`, but its grapheme-cluster break is
        // `Prepend`: it attaches to what follows, so the segmenter hands back
        // one cluster whose real base sits behind it. Reading only the first
        // code point would throw the base away with the invisible sign.
        expect(fitToWidth("\u0600A", 2)).toBe("\u0600A");
        expect(fitToWidth("\u0600\u0661\u0662", 2)).toBe("\u0600\u0661\u0662");
        // The base still decides the width, so a wide one still costs two.
        expect(fitToWidth("\u0600\u6f22", 1)).toBe("");
        expect(fitToWidth("\u0600\u6f22", 2)).toBe("\u0600\u6f22");
    });

    test("still drops a cluster that is only marks and format characters", () => {
        // The forward-binding case above must not reopen the baseless rule: a
        // prepend with nothing printable behind it has no base either.
        expect(fitToWidth("\u0600\u0301", 2)).toBe("");
        expect(fitToWidth("\u0600", 2)).toBe("");
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

    test("gives an emoji presentation sequence a width-2 cell", () => {
        const cells = layoutText("\u26a0\ufe0fx", 3, 0);
        expect(cells.map((c) => c.ch)).toEqual(["\u26a0\ufe0f", "", "x"]);
        expect(cells.map((c) => c.width)).toEqual([2, 0, 1]);
    });

    test("clips a flag that would straddle the last column", () => {
        const cells = layoutText("\u{1f1fa}\u{1f1f8}", 1, 0);
        expect(cells.map((c) => c.ch)).toEqual([" "]);
        expect(cells.map((c) => c.width)).toEqual([1]);
    });

    test("drops a baseless spacing mark instead of giving it a cell", () => {
        // A cell holding a lone `Mc` writes a mark with no base into the frame,
        // and the terminal hangs it off whatever glyph the previous cell left
        // on screen.
        const cells = layoutText("\u093eA", 3, 0);
        expect(cells.map((c) => c.ch)).toEqual(["A", " ", " "]);
        expect(cells.map((c) => c.width)).toEqual([1, 1, 1]);
    });

    test("keeps a spacing mark in the cell of the base it belongs to", () => {
        const cells = layoutText("\u0915\u093eb", 3, 0);
        expect(cells.map((c) => c.ch)).toEqual(["\u0915\u093e", "b", " "]);
        expect(cells.map((c) => c.width)).toEqual([1, 1, 1]);
    });

    test("gives the base behind a forward-binding format character its own cell", () => {
        const cells = layoutText("؀A", 3, 0);
        expect(cells.map((c) => c.ch)).toEqual(["؀A", " ", " "]);
        expect(cells.map((c) => c.width)).toEqual([1, 1, 1]);
    });

    test("measures a forward-binding format character by the base behind it", () => {
        const cells = layoutText("؀漢", 3, 0);
        expect(cells.map((c) => c.ch)).toEqual(["؀漢", "", " "]);
        expect(cells.map((c) => c.width)).toEqual([2, 0, 1]);
    });

    test("returns a distinct cell object per column", () => {
        // ScreenBuffer.set takes ownership of the cell it is handed, so two
        // columns must never share one object.
        const cells = layoutText("aa", 2, 0);
        expect(cells[0]).not.toBe(cells[1]);
    });
});
