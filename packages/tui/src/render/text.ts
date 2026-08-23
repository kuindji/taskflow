import { blankCell, type Cell } from "./cells";

/**
 * Code point ranges a terminal draws two columns wide: the East Asian Wide and
 * Fullwidth blocks plus the emoji that Unicode gives Wide east-asian width.
 * Sorted and non-overlapping, scanned linearly.
 *
 * Session panes take their widths from xterm's own unicode service via
 * `term/blit.ts`; this table exists for the chrome the TUI draws itself, whose
 * text never passes through an xterm buffer.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
    [0x1100, 0x115f],
    [0x231a, 0x231b],
    [0x2329, 0x232a],
    [0x23e9, 0x23ec],
    [0x23f0, 0x23f0],
    [0x23f3, 0x23f3],
    [0x25fd, 0x25fe],
    [0x2614, 0x2615],
    [0x2648, 0x2653],
    [0x267f, 0x267f],
    [0x2693, 0x2693],
    [0x26a1, 0x26a1],
    [0x26aa, 0x26ab],
    [0x26bd, 0x26be],
    [0x26c4, 0x26c5],
    [0x26ce, 0x26ce],
    [0x26d4, 0x26d4],
    [0x26ea, 0x26ea],
    [0x26f2, 0x26f3],
    [0x26f5, 0x26f5],
    [0x26fa, 0x26fa],
    [0x26fd, 0x26fd],
    [0x2705, 0x2705],
    [0x270a, 0x270b],
    [0x2728, 0x2728],
    [0x274c, 0x274c],
    [0x274e, 0x274e],
    [0x2753, 0x2755],
    [0x2757, 0x2757],
    [0x2795, 0x2797],
    [0x27b0, 0x27b0],
    [0x27bf, 0x27bf],
    [0x2b1b, 0x2b1c],
    [0x2b50, 0x2b50],
    [0x2b55, 0x2b55],
    [0x2e80, 0x303e],
    [0x3041, 0x33ff],
    [0x3400, 0x4dbf],
    [0x4e00, 0x9fff],
    [0xa000, 0xa4cf],
    [0xa960, 0xa97f],
    [0xac00, 0xd7a3],
    [0xf900, 0xfaff],
    [0xfe10, 0xfe19],
    [0xfe30, 0xfe6f],
    [0xff00, 0xff60],
    [0xffe0, 0xffe6],
    [0x16fe0, 0x16fe4],
    [0x17000, 0x18d08],
    [0x1b000, 0x1b2fb],
    [0x1f004, 0x1f004],
    [0x1f0cf, 0x1f0cf],
    [0x1f18e, 0x1f18e],
    [0x1f191, 0x1f19a],
    [0x1f200, 0x1f320],
    [0x1f32d, 0x1f335],
    [0x1f337, 0x1f37c],
    [0x1f37e, 0x1f393],
    [0x1f3a0, 0x1f3ca],
    [0x1f3cf, 0x1f3d3],
    [0x1f3e0, 0x1f3f0],
    [0x1f3f4, 0x1f3f4],
    [0x1f3f8, 0x1f43e],
    [0x1f440, 0x1f440],
    [0x1f442, 0x1f4fc],
    [0x1f4ff, 0x1f53d],
    [0x1f54b, 0x1f54e],
    [0x1f550, 0x1f567],
    [0x1f57a, 0x1f57a],
    [0x1f595, 0x1f596],
    [0x1f5a4, 0x1f5a4],
    [0x1f5fb, 0x1f64f],
    [0x1f680, 0x1f6c5],
    [0x1f6cc, 0x1f6cc],
    [0x1f6d0, 0x1f6d2],
    [0x1f6d5, 0x1f6d7],
    [0x1f6eb, 0x1f6ec],
    [0x1f6f4, 0x1f6fc],
    [0x1f7e0, 0x1f7eb],
    [0x1f90c, 0x1f93a],
    [0x1f93c, 0x1f945],
    [0x1f947, 0x1f9ff],
    [0x1fa70, 0x1faff],
    [0x20000, 0x2fffd],
    [0x30000, 0x3fffd],
];

/** Combining marks and format characters occupy no column of their own. */
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u;

const CONTROL = /^[\p{Cc}]$/u;

function isWide(cp: number): boolean {
    for (const [lo, hi] of WIDE_RANGES) {
        if (cp < lo) return false;
        if (cp <= hi) return true;
    }
    return false;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemes(text: string): string[] {
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
}

/**
 * Columns `grapheme` occupies. The base character decides: any combining marks
 * the segmenter folded into the same grapheme ride along in the same cell.
 */
function graphemeWidth(grapheme: string): 0 | 1 | 2 {
    const cp = grapheme.codePointAt(0);
    if (cp === undefined) return 0;
    const base = String.fromCodePoint(cp);
    if (ZERO_WIDTH.test(base)) return 0;
    return isWide(cp) ? 2 : 1;
}

function cell(ch: string, width: 0 | 1 | 2, attrs: number): Cell {
    return { ...blankCell(), ch, width, attrs };
}

/**
 * The longest prefix of `text` that fits in `cols` display columns without
 * splitting a grapheme. Use before appending anything that must stay visible.
 */
function fitToWidth(text: string, cols: number): string {
    let used = 0;
    let out = "";
    for (const grapheme of graphemes(text)) {
        const width = graphemeWidth(grapheme);
        if (used + width > cols) break;
        used += width;
        out += grapheme;
    }
    return out;
}

/**
 * Exactly `cols` cells for `text`, all carrying `attrs`: a wide glyph takes a
 * width-2 cell plus a width-0 continuation, a control character is blanked so
 * it cannot move the cursor, a wide glyph that would straddle the last column
 * is clipped to a space, and the rest is padded with blanks so a caller that
 * writes the whole row leaves no stale cell behind.
 */
function layoutText(text: string, cols: number, attrs: number): Cell[] {
    const cells: Cell[] = [];
    for (const grapheme of graphemes(text)) {
        if (cells.length >= cols) break;
        const width = graphemeWidth(grapheme);
        if (width === 0) continue;
        if (CONTROL.test(grapheme)) {
            cells.push(cell(" ", 1, attrs));
        } else if (width === 2) {
            if (cells.length + 2 > cols) {
                cells.push(cell(" ", 1, attrs));
                break;
            }
            cells.push(cell(grapheme, 2, attrs), cell("", 0, attrs));
        } else {
            cells.push(cell(grapheme, 1, attrs));
        }
    }
    while (cells.length < cols) cells.push(cell(" ", 1, attrs));
    return cells;
}

export { fitToWidth, layoutText };
