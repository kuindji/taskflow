import type { MenuEntry } from "@taskflow/shared";
import { LOCAL_MACHINE_ID } from "./machines";

type PickerRow = { kind: "local" } | { kind: "machine"; entry: MenuEntry } | { kind: "add" };

/**
 * Local first, then saved machines (seen before unseen), then unsaved
 * discovered backends, then the add row. Each group keeps `listBackends` order.
 */
function buildPickerRows(entries: MenuEntry[]): PickerRow[] {
    const saved = entries.filter((e) => e.saved);
    const ordered = [
        ...saved.filter((e) => e.seen),
        ...saved.filter((e) => !e.seen),
        ...entries.filter((e) => !e.saved),
    ];
    return [
        { kind: "local" },
        ...ordered.map((entry): PickerRow => ({ kind: "machine", entry })),
        { kind: "add" },
    ];
}

/** The row for the last machine used, or the first row when it is gone. */
function initialIndex(rows: PickerRow[], lastMachineId: string | null): number {
    if (lastMachineId === null) return 0;
    const index = rows.findIndex((row) =>
        lastMachineId === LOCAL_MACHINE_ID
            ? row.kind === "local"
            : row.kind === "machine" && row.entry.id === lastMachineId,
    );
    return index === -1 ? 0 : index;
}

/** A saved machine by exact display name, then by exact id. */
function findMachineByName(entries: MenuEntry[], name: string): MenuEntry | null {
    const saved = entries.filter((e) => e.saved);
    return saved.find((e) => e.displayName === name) ?? saved.find((e) => e.id === name) ?? null;
}

export { buildPickerRows, findMachineByName, initialIndex };
export type { PickerRow };
