import { ScreenBuffer, blankCell, ATTR_INVERSE } from "../render/cells";
import { fitToWidth, layoutText, textWidth } from "../render/text";
import { blitTerminal } from "../term/blit";
import type { SessionTerminal } from "../term/session-terminal";

interface TabSpec {
    label: string;
    active: boolean;
}

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * One tab is its label with a padding column on each side, so the active tab's
 * inverse block reads as a tab rather than as highlighted text.
 */
const PADDING_COLS = 2;

/**
 * Draw the tab strip into row `y0`, columns `x0` to `x0 + width`.
 *
 * The strip is cleared first, so a frame with fewer tabs than the last leaves
 * nothing of the old one behind — including its attributes, which would
 * otherwise keep a stale inverse block on the row.
 *
 * Labels are session names and can hold anything a task title can, so they go
 * through `fitToWidth`/`layoutText` rather than being written code point by
 * code point: a wide glyph gets its continuation cell, a glyph that would
 * straddle the last column is dropped whole instead of tearing into whatever
 * is drawn to the right, and a control character never reaches the frame.
 */
function drawTabs(
    buf: ScreenBuffer,
    x0: number,
    y0: number,
    width: number,
    tabs: TabSpec[],
): void {
    for (let x = 0; x < width; x++) buf.set(x0 + x, y0, blankCell());

    let cursor = 0;
    for (const tab of tabs) {
        const room = width - cursor;
        if (room <= 0) return;
        const attrs = tab.active ? ATTR_INVERSE : 0;
        const label = fitToWidth(tab.label, room - PADDING_COLS);
        // `layoutText` pads to the width it is given, so it is given the tab's
        // own columns and not the rest of the strip — padding to `room` would
        // stretch this tab's attributes over every column after it.
        const cols = Math.min(room, PADDING_COLS + textWidth(label));
        for (const cell of layoutText(` ${label} `, cols, attrs)) {
            buf.set(x0 + cursor, y0, cell);
            cursor++;
        }
    }
}

/**
 * Draw the focused session into `rect`, returning where the real cursor should
 * be parked, or null when there is nothing to park it on.
 */
function drawSessionPane(
    buf: ScreenBuffer,
    session: SessionTerminal | null,
    rect: Rect,
): { x: number; y: number } | null {
    if (session === null) {
        for (let y = 0; y < rect.height; y++) {
            for (let x = 0; x < rect.width; x++) buf.set(rect.x + x, rect.y + y, blankCell());
        }
        return null;
    }
    return blitTerminal(session, buf, rect.x, rect.y, rect.width, rect.height);
}

export { drawTabs, drawSessionPane };
export type { TabSpec };
