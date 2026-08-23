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
            const indent = prefix.length + badgeCols <= width ? prefix : "";
            const available = width - indent.length - badgeCols;
            text = `${indent}${fitToWidth(row.label, available)}${badgeCols > 0 ? badge : ""}`;
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
