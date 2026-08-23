import { ScreenBuffer, blankCell, ATTR_BOLD, ATTR_INVERSE, type Cell } from "../render/cells";
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

function styled(ch: string, attrs: number): Cell {
    return { ...blankCell(), ch, attrs };
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
        const attrs =
            (y === selected ? ATTR_INVERSE : 0) | (row?.kind === "project" ? ATTR_BOLD : 0);

        const badge = row && row.sessionCount > 0 ? ` ${String(row.sessionCount)}` : "";
        const prefix = row === undefined ? "" : row.kind === "project" ? "" : "  ";
        const available = Math.max(0, width - prefix.length - badge.length);
        const label = (row?.label ?? "").slice(0, available);
        const text = row === undefined ? "" : `${prefix}${label}${badge}`;

        for (let x = 0; x < width; x++) {
            buf.set(x, y, styled(text[x] ?? " ", attrs));
        }
    }
}

export { buildRows, drawSidebar };
export type { SidebarRow };
