import { ScreenBuffer, ATTR_BOLD, ATTR_INVERSE } from "../render/cells";
import { fitToWidth, layoutText } from "../render/text";
import type { Store } from "../state/store";

interface SidebarRow {
    kind: "project" | "task";
    id: string;
    label: string;
    sessionCount: number;
}

function buildRows(store: Store): SidebarRow[] {
    const rows: SidebarRow[] = [];
    for (const project of store.projects) {
        rows.push({
            kind: "project",
            id: project.id,
            label: project.name,
            sessionCount: project.sessions.length,
        });
        for (const task of store.tasksFor(project.id)) {
            rows.push({
                kind: "task",
                id: task.id,
                label: task.title,
                sessionCount: task.sessions.length,
            });
        }
    }
    return rows;
}

/**
 * Code points a fitted label can carry that put no ink on the row: whitespace,
 * format characters, the rest of Unicode's default-ignorable set — and U+2800,
 * the braille cell with no dots raised, the one graphic character whose glyph is
 * defined as empty.
 *
 * Trimming alone is not enough. It strips the blanks but leaves an invisible
 * code point riding on one, and the cluster then reads back as text: a space
 * followed by a zero-width joiner, or an Arabic number sign binding forwards
 * onto a space, both survive `trim` and both draw an empty cell.
 */
const INVISIBLE = /[\s\p{Cf}\p{Default_Ignorable_Code_Point}⠀]/gu;

/** Whether a fitted label puts anything visible on the row. */
function shows(label: string): boolean {
    return label.replace(INVISIBLE, "") !== "";
}

function drawSidebar(
    buf: ScreenBuffer,
    rows: SidebarRow[],
    selected: number,
    width: number,
    height: number,
): void {
    for (let y = 0; y < height; y++) {
        const row = rows[y];
        // A row past the end of the list is padding, never the selection, even
        // when `selected` still points at where a row used to be.
        const attrs =
            row === undefined
                ? 0
                : (y === selected ? ATTR_INVERSE : 0) | (row.kind === "project" ? ATTR_BOLD : 0);

        let text = "";
        if (row !== undefined) {
            const badge = row.sessionCount > 0 ? ` ${String(row.sessionCount)}` : "";
            const prefix = row.kind === "project" ? "" : "  ";
            // `layoutText` clips from the right, so whatever is appended after
            // the label is the first thing lost — and a badge cut short reads as
            // a smaller session count than the row has. Give the badge its
            // columns before the indent, and drop it whole rather than render a
            // count that lies. The badge is ASCII, so its length is its width.
            const badgeCols = badge.length <= width ? badge.length : 0;
            // The badge outranks the label and the label outranks the indent,
            // which is only decoration. So the indent goes whenever keeping it
            // would starve the label of every column it could otherwise have
            // shown — including the case where one column is left and the
            // label's first glyph is two wide. Spending those columns on the
            // indent regardless made a wider pane show less: a task read
            // `A 12` at width 4 and `   12` at width 5.
            const roomWithout = width - badgeCols;
            const roomWith = roomWithout - prefix.length;
            const fitsIndent = prefix.length + badgeCols <= width;
            const withIndent = fitsIndent ? fitToWidth(row.label, roomWith) : "";
            const withoutIndent = fitToWidth(row.label, roomWithout);
            // What counts is what the label will *show*, not what `fitToWidth`
            // hands back: a title that starts with a space fits as a space,
            // which is a non-empty string that draws as nothing. Ranking the
            // indent above that blanked the row — a task titled ` A` read as
            // ` A` at width 2 and as an empty row at width 3.
            const keepIndent = fitsIndent && (shows(withIndent) || !shows(withoutIndent));
            const label = keepIndent ? withIndent : withoutIndent;
            text = `${keepIndent ? prefix : ""}${label}${badgeCols > 0 ? badge : ""}`;
        }

        const cells = layoutText(text, width, attrs);
        for (let x = 0; x < width; x++) {
            const cell = cells[x];
            if (cell !== undefined) buf.set(x, y, cell);
        }
    }
}

export { buildRows, drawSidebar };
export type { SidebarRow };
