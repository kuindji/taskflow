import type { IBufferCell } from "@xterm/headless";
import {
    ScreenBuffer,
    DEFAULT_COLOR,
    ATTR_BOLD,
    ATTR_DIM,
    ATTR_ITALIC,
    ATTR_UNDERLINE,
    ATTR_INVERSE,
    ATTR_STRIKE,
    type Cell,
    type Color,
} from "../render/cells";
import type { SessionTerminal } from "./session-terminal";

function foreground(cell: IBufferCell): Color {
    if (cell.isFgDefault()) return DEFAULT_COLOR;
    if (cell.isFgPalette()) return { kind: "palette", index: cell.getFgColor() };
    const packed = cell.getFgColor();
    return { kind: "rgb", r: (packed >> 16) & 0xff, g: (packed >> 8) & 0xff, b: packed & 0xff };
}

function background(cell: IBufferCell): Color {
    if (cell.isBgDefault()) return DEFAULT_COLOR;
    if (cell.isBgPalette()) return { kind: "palette", index: cell.getBgColor() };
    const packed = cell.getBgColor();
    return { kind: "rgb", r: (packed >> 16) & 0xff, g: (packed >> 8) & 0xff, b: packed & 0xff };
}

function attributes(cell: IBufferCell): number {
    return (
        (cell.isBold() ? ATTR_BOLD : 0) |
        (cell.isDim() ? ATTR_DIM : 0) |
        (cell.isItalic() ? ATTR_ITALIC : 0) |
        (cell.isUnderline() ? ATTR_UNDERLINE : 0) |
        (cell.isInverse() ? ATTR_INVERSE : 0) |
        (cell.isStrikethrough() ? ATTR_STRIKE : 0)
    );
}

function toCell(cell: IBufferCell): Cell {
    const width = cell.getWidth();
    const chars = cell.getChars();
    return {
        ch: width === 0 ? "" : chars === "" ? " " : chars,
        width: width === 0 ? 0 : width === 2 ? 2 : 1,
        fg: foreground(cell),
        bg: background(cell),
        attrs: attributes(cell),
    };
}

/**
 * Copy the visible viewport of a session's terminal into `buf` at (x0, y0).
 * Returns the cursor position in screen coordinates, or null when hidden.
 */
function blitTerminal(
    source: SessionTerminal,
    buf: ScreenBuffer,
    x0: number,
    y0: number,
    cols: number,
    rows: number,
): { x: number; y: number } | null {
    const active = source.terminal.buffer.active;

    for (let row = 0; row < rows; row++) {
        const line = active.getLine(active.viewportY + row);
        for (let col = 0; col < cols; col++) {
            const cell = line?.getCell(col);
            buf.set(
                x0 + col,
                y0 + row,
                cell === undefined
                    ? { ch: " ", width: 1, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, attrs: 0 }
                    : toCell(cell),
            );
        }
    }

    if (source.cursorHidden) return null;
    // cursorY counts from baseY while the rows copied above start at viewportY,
    // so a scrolled-back viewport needs the cursor translated into the same
    // frame before it can be tested against the rect — otherwise it lands on
    // whichever scrollback line happens to share its index.
    const cursorRow = active.baseY + active.cursorY - active.viewportY;
    // cursorX may equal cols ("after last cell of the row"), which is outside
    // the rect; parking the real cursor there would bleed into the next pane.
    if (active.cursorX >= cols || cursorRow < 0 || cursorRow >= rows) return null;
    return { x: x0 + active.cursorX, y: y0 + cursorRow };
}

export { blitTerminal };
