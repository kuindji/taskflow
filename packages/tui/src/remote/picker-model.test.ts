import { describe, expect, it } from "bun:test";
import type { MenuEntry } from "@taskflow/shared";
import { LOCAL_MACHINE_ID } from "./machines";
import { buildPickerRows, findMachineByName, initialIndex } from "./picker-model";

function entry(id: string, overrides: Partial<MenuEntry> = {}): MenuEntry {
    return {
        id,
        displayName: `name-${id}`,
        instanceId: `inst-${id}`,
        host: `${id}.local`,
        attached: false,
        saved: true,
        seen: true,
        ...overrides,
    };
}

const entries: MenuEntry[] = [
    entry("unsaved-a", { saved: false }),
    entry("saved-unseen-a", { seen: false }),
    entry("saved-seen-a"),
    entry("unsaved-b", { saved: false }),
    entry("saved-unseen-b", { seen: false }),
    entry("saved-seen-b"),
];

function rowIds(rows: ReturnType<typeof buildPickerRows>): string[] {
    return rows.map((row) => (row.kind === "machine" ? row.entry.id : row.kind));
}

describe("buildPickerRows", () => {
    it("lists local, saved seen, saved unseen, unsaved discovered, then add", () => {
        expect(rowIds(buildPickerRows(entries))).toEqual([
            "local",
            "saved-seen-a",
            "saved-seen-b",
            "saved-unseen-a",
            "saved-unseen-b",
            "unsaved-a",
            "unsaved-b",
            "add",
        ]);
    });

    it("still offers local and add with no entries", () => {
        expect(rowIds(buildPickerRows([]))).toEqual(["local", "add"]);
    });
});

describe("initialIndex", () => {
    const rows = buildPickerRows(entries);

    it("selects local for the local machine id", () => {
        expect(initialIndex(rows, LOCAL_MACHINE_ID)).toBe(0);
    });

    it("selects the row of a saved machine", () => {
        expect(initialIndex(rows, "saved-unseen-b")).toBe(4);
    });

    it("falls back to the first row for a missing or absent id", () => {
        expect(initialIndex(rows, "gone")).toBe(0);
        expect(initialIndex(rows, null)).toBe(0);
    });
});

describe("findMachineByName", () => {
    it("matches the display name before the id", () => {
        const byName = entry("x", { displayName: "y" });
        const byId = entry("y", { displayName: "other" });
        expect(findMachineByName([byId, byName], "y")).toBe(byName);
    });

    it("falls back to an exact id", () => {
        expect(findMachineByName(entries, "saved-seen-b")?.id).toBe("saved-seen-b");
    });

    it("ignores unsaved discovered entries", () => {
        expect(findMachineByName(entries, "name-unsaved-a")).toBeNull();
        expect(findMachineByName(entries, "unsaved-b")).toBeNull();
    });

    it("does not match partially or case-insensitively", () => {
        expect(findMachineByName(entries, "NAME-SAVED-SEEN-A")).toBeNull();
        expect(findMachineByName(entries, "saved-seen")).toBeNull();
    });
});
