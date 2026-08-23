import type { IBufferCell } from "@xterm/headless";
import {
    ScreenBuffer,
    blankCell,
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

/**
 * `clipWide` marks the last column being copied: a wide glyph there has its
 * continuation cell outside the copied region, so it cannot be drawn as a wide
 * glyph. `Screen.flush` suppresses only width 0, so it would emit the character
 * and the real terminal would advance two columns — painting over the first
 * column of whatever sits to the right of this rect.
 */
function toCell(cell: IBufferCell, clipWide: boolean): Cell {
    const width = cell.getWidth();
    const style = { fg: foreground(cell), bg: background(cell), attrs: attributes(cell) };
    if (width === 0) return { ch: "", width: 0, ...style };
    // Colours are kept on the clipped stand-in so the pane edge does not tear.
    if (width === 2) return clipWide ? { ch: " ", width: 1, ...style } : { ch: cell.getChars(), width: 2, ...style };
    const chars = cell.getChars();
    return { ch: chars === "" ? " " : chars, width: 1, ...style };
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
    // The rect is the pane, which is not necessarily the size the child
    // terminal has been resized to — a resize round-trips to the backend, so
    // the two are out of step for at least a frame. Read only cells the source
    // actually shows: past its own width a wide glyph would be mis-paired, and
    // past its own height `getLine` keeps returning scrollback the child is not
    // displaying. The rest of the rect is blanked rather than left stale.
    const srcCols = Math.min(cols, source.terminal.cols);
    const srcRows = Math.min(rows, source.terminal.rows);

    for (let row = 0; row < rows; row++) {
        const line = row < srcRows ? active.getLine(active.viewportY + row) : undefined;
        for (let col = 0; col < cols; col++) {
            const cell = col < srcCols ? line?.getCell(col) : undefined;
            buf.set(
                x0 + col,
                y0 + row,
                cell === undefined ? blankCell() : toCell(cell, col === srcCols - 1),
            );
        }
    }

    if (source.cursorHidden) return null;
    // cursorY counts from baseY while the rows copied above start at viewportY,
    // so a scrolled-back viewport needs the cursor translated into the same
    // frame before it can be tested against the rect — otherwise it lands on
    // whichever scrollback line happens to share its index.
    const cursorRow = active.baseY + active.cursorY - active.viewportY;
    // cursorX may equal the source terminal's width ("after last cell of the
    // row"), a column this rect never copied; parking the real cursor there
    // would bleed into whatever is drawn to the right.
    if (active.cursorX >= srcCols || cursorRow < 0 || cursorRow >= srcRows) return null;
    return { x: x0 + active.cursorX, y: y0 + cursorRow };
}

export { blitTerminal };
