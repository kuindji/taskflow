type Color =
    | { kind: "default" }
    | { kind: "palette"; index: number }
    | { kind: "rgb"; r: number; g: number; b: number };

interface Cell {
    ch: string;
    width: 0 | 1 | 2;
    fg: Color;
    bg: Color;
    attrs: number;
}

const ATTR_BOLD = 1;
const ATTR_DIM = 2;
const ATTR_ITALIC = 4;
const ATTR_UNDERLINE = 8;
const ATTR_INVERSE = 16;
const ATTR_STRIKE = 32;

const DEFAULT_COLOR: Color = { kind: "default" };

function blankCell(): Cell {
    return { ch: " ", width: 1, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, attrs: 0 };
}

function colorsEqual(a: Color, b: Color): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "palette" && b.kind === "palette") return a.index === b.index;
    if (a.kind === "rgb" && b.kind === "rgb") return a.r === b.r && a.g === b.g && a.b === b.b;
    return true;
}

/**
 * True when two cells would be drawn with the same SGR state. Deliberately
 * ignores `ch` and `width`, which are glyph properties rather than attributes.
 */
function stylesEqual(a: Cell, b: Cell): boolean {
    return a.attrs === b.attrs && colorsEqual(a.fg, b.fg) && colorsEqual(a.bg, b.bg);
}

function cellsEqual(a: Cell, b: Cell): boolean {
    return a.ch === b.ch && a.width === b.width && stylesEqual(a, b);
}

class ScreenBuffer {
    private cells: Cell[];

    constructor(
        public readonly cols: number,
        public readonly rows: number,
    ) {
        this.cells = Array.from({ length: cols * rows }, () => blankCell());
    }

    get(x: number, y: number): Cell {
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) {
            throw new RangeError(`Cell out of range: ${String(x)},${String(y)}`);
        }
        const cell = this.cells[y * this.cols + x];
        if (!cell) throw new RangeError(`Cell out of range: ${String(x)},${String(y)}`);
        return cell;
    }

    set(x: number, y: number, cell: Cell): void {
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
        this.cells[y * this.cols + x] = cell;
    }

    clear(): void {
        for (let i = 0; i < this.cells.length; i++) this.cells[i] = blankCell();
    }
}

export { ScreenBuffer, blankCell, cellsEqual, stylesEqual, DEFAULT_COLOR };
export { ATTR_BOLD, ATTR_DIM, ATTR_ITALIC, ATTR_UNDERLINE, ATTR_INVERSE, ATTR_STRIKE };
export type { Cell, Color };
