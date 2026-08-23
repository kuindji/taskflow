/**
 * The frame geometry, computed in one place so that what was drawn and what a
 * mouse report is tested against can never be two different rectangles.
 *
 * It is derived fresh from `cols`, `rows` and `zoomed` on every use rather
 * than cached from the last render: all three are owned by `App` and free to
 * read, and caching would leave one frame in which a resize had happened but
 * a click was still hit-tested against the old columns.
 */
interface Layout {
    cols: number;
    rows: number;
    /** Zero while zoomed, in which case the pane owns every column. */
    sidebarWidth: number;
    /** The row the tab strip owns; the pane starts beneath it. */
    tabRow: number;
    paneX: number;
    paneY: number;
    paneWidth: number;
    paneHeight: number;
}

/**
 * A third of the terminal, so a narrow window is not all sidebar, but never
 * more than this — a very wide window does not need a wider task list.
 */
const SIDEBAR_WIDTH = 30;

function computeLayout(cols: number, rows: number, zoomed: boolean): Layout {
    const sidebarWidth = zoomed ? 0 : Math.min(SIDEBAR_WIDTH, Math.floor(cols / 3));
    return {
        cols,
        rows,
        sidebarWidth,
        tabRow: 0,
        paneX: sidebarWidth,
        paneY: 1,
        paneWidth: cols - sidebarWidth,
        // A terminal one row tall is all tab strip. Clamped rather than left
        // negative so the pane rect stays a rect the blitter can loop over.
        paneHeight: Math.max(0, rows - 1),
    };
}

export { computeLayout };
export type { Layout };
