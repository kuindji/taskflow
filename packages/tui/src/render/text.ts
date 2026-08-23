import { blankCell, type Cell } from "./cells";

/**
 * Code point ranges a terminal draws two columns wide: every code point Unicode
 * 16.0 gives East Asian Width `W` or `F`, which is also where the wide emoji
 * live. Generated from `unicodedata.east_asian_width` — do not hand-edit; ranges
 * are sorted and non-overlapping so `isWide` can stop at the first range that
 * starts past the code point.
 *
 * Ambiguous-width code points are deliberately absent: a terminal draws them in
 * one column unless it has been told the text is East Asian, and this table
 * describes the chrome the TUI itself draws.
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
    [0x2630, 0x2637],
    [0x2648, 0x2653],
    [0x267f, 0x267f],
    [0x268a, 0x268f],
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
    [0x2e80, 0x2e99],
    [0x2e9b, 0x2ef3],
    [0x2f00, 0x2fd5],
    [0x2ff0, 0x303e],
    [0x3041, 0x3096],
    [0x3099, 0x30ff],
    [0x3105, 0x312f],
    [0x3131, 0x318e],
    [0x3190, 0x31e5],
    [0x31ef, 0x321e],
    [0x3220, 0x3247],
    [0x3250, 0xa48c],
    [0xa490, 0xa4c6],
    [0xa960, 0xa97c],
    [0xac00, 0xd7a3],
    [0xf900, 0xfaff],
    [0xfe10, 0xfe19],
    [0xfe30, 0xfe52],
    [0xfe54, 0xfe66],
    [0xfe68, 0xfe6b],
    [0xff01, 0xff60],
    [0xffe0, 0xffe6],
    [0x16fe0, 0x16fe4],
    [0x16ff0, 0x16ff1],
    [0x17000, 0x187f7],
    [0x18800, 0x18cd5],
    [0x18cff, 0x18d08],
    [0x1aff0, 0x1aff3],
    [0x1aff5, 0x1affb],
    [0x1affd, 0x1affe],
    [0x1b000, 0x1b122],
    [0x1b132, 0x1b132],
    [0x1b150, 0x1b152],
    [0x1b155, 0x1b155],
    [0x1b164, 0x1b167],
    [0x1b170, 0x1b2fb],
    [0x1d300, 0x1d356],
    [0x1d360, 0x1d376],
    [0x1f004, 0x1f004],
    [0x1f0cf, 0x1f0cf],
    [0x1f18e, 0x1f18e],
    [0x1f191, 0x1f19a],
    [0x1f200, 0x1f202],
    [0x1f210, 0x1f23b],
    [0x1f240, 0x1f248],
    [0x1f250, 0x1f251],
    [0x1f260, 0x1f265],
    [0x1f300, 0x1f320],
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
    [0x1f6dc, 0x1f6df],
    [0x1f6eb, 0x1f6ec],
    [0x1f6f4, 0x1f6fc],
    [0x1f7e0, 0x1f7eb],
    [0x1f7f0, 0x1f7f0],
    [0x1f90c, 0x1f93a],
    [0x1f93c, 0x1f945],
    [0x1f947, 0x1f9ff],
    [0x1fa70, 0x1fa7c],
    [0x1fa80, 0x1fa89],
    [0x1fa8f, 0x1fac6],
    [0x1face, 0x1fadc],
    [0x1fadf, 0x1fae9],
    [0x1faf0, 0x1faf8],
    [0x20000, 0x2fffd],
    [0x30000, 0x3fffd],
];

/**
 * Code points that cannot begin a visible cluster: combining marks and format
 * characters. Tested against a cluster's *base*, so a mark only matches here
 * when the segmenter had nothing to attach it to — inside a normal cluster the
 * mark rides along in its base character's cell and never reaches this test.
 *
 * `Mc` spacing marks are included even though they are not zero-width. They
 * bind to the cluster in front of them, so a baseless one handed back to a
 * caller re-attaches to whatever that caller concatenates ahead of it and
 * repaints a cell the text does not own.
 */
const NO_BASE = /^[\p{Mn}\p{Me}\p{Mc}\p{Cf}]$/u;

/**
 * VARIATION SELECTOR-16. It asks for the emoji presentation of the character
 * before it, which a terminal draws in two columns even when that character's
 * East Asian Width is Neutral — U+26A0 U+FE0F and the keycap sequences are the
 * common cases in a task title.
 */
const EMOJI_PRESENTATION = "\ufe0f";

/** A pair of these is one flag, drawn as a single two-column glyph. */
function isRegionalIndicator(cp: number): boolean {
    return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

/**
 * Clusters that must never reach the terminal, blanked instead of drawn.
 * Unanchored: `Intl.Segmenter` keeps CRLF as one grapheme, so a cluster can
 * carry such a code point alongside another character.
 *
 * `Screen.flush` writes every cell whose width is not zero, so a raw control
 * byte would move the cursor in the middle of a frame, and an unpaired
 * surrogate (`\p{Cs}` matches only unpaired ones under `u`; a well-formed pair
 * is a single astral code point) encodes to U+FFFD on the way out and draws as
 * mojibake.
 */
const UNPRINTABLE = /[\p{Cc}\p{Cs}]/u;

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
 * Columns `grapheme` occupies. The base character usually decides, and any
 * combining marks the segmenter folded into the same grapheme ride along in the
 * same cell — but two cluster shapes are wider than their base and have to be
 * read whole: an emoji presentation sequence and a flag.
 *
 * Guessing too wide costs a blank column; guessing too narrow lets the row run
 * past the pane it was laid out for, so an ambiguous cluster is counted wide.
 *
 * Known limit: U+302E, U+302F, U+16FF0 and U+16FF1 are spacing marks that the
 * width table calls wide, so a base carrying one can advance three columns
 * where this returns 2. A cell holds at most two columns, so counting it
 * honestly is not expressible here; the four are rare enough in a task title to
 * leave. A baseless one is dropped by `NO_BASE` before this matters.
 */
function graphemeWidth(grapheme: string): 0 | 1 | 2 {
    const cp = grapheme.codePointAt(0);
    if (cp === undefined) return 0;
    const base = String.fromCodePoint(cp);
    if (NO_BASE.test(base)) return 0;
    if (isWide(cp)) return 2;
    if (grapheme.includes(EMOJI_PRESENTATION)) return 2;
    return isRegionalIndicator(cp) ? 2 : 1;
}

function cell(ch: string, width: 0 | 1 | 2, attrs: number): Cell {
    return { ...blankCell(), ch, width, attrs };
}

/**
 * The longest prefix of `text` that fits in `cols` display columns without
 * splitting a grapheme. Use before appending anything that must stay visible.
 *
 * A baseless cluster — a combining mark with no base of its own, which
 * `Intl.Segmenter` yields only at the start of a string or after another such
 * cluster — is dropped rather than kept. `layoutText` drops it too, and a
 * caller that concatenates this result after a prefix would otherwise hand the
 * segmenter a mark that attaches to the prefix's last character and repaints a
 * cell the label does not own. See `NO_BASE`.
 */
function fitToWidth(text: string, cols: number): string {
    let used = 0;
    let out = "";
    for (const grapheme of graphemes(text)) {
        const width = graphemeWidth(grapheme);
        if (width === 0) continue;
        if (used + width > cols) break;
        used += width;
        out += grapheme;
    }
    return out;
}

/**
 * Exactly `cols` cells for `text`, all carrying `attrs`: a wide glyph takes a
 * width-2 cell plus a width-0 continuation, an unprintable cluster is blanked
 * so it cannot corrupt the frame, a wide glyph that would straddle the last column
 * is clipped to a space, and the rest is padded with blanks so a caller that
 * writes the whole row leaves no stale cell behind.
 */
function layoutText(text: string, cols: number, attrs: number): Cell[] {
    const cells: Cell[] = [];
    for (const grapheme of graphemes(text)) {
        if (cells.length >= cols) break;
        const width = graphemeWidth(grapheme);
        if (width === 0) continue;
        if (UNPRINTABLE.test(grapheme)) {
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
