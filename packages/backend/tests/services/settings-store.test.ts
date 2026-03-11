import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
    DEFAULT_EDITOR_FONT_FAMILY,
    DEFAULT_EDITOR_FONT_SIZE,
    DEFAULT_TERMINAL_FONT_FAMILY,
} from "@taskflow/shared";
import { SettingsStore } from "../../src/services/settings-store";

describe("SettingsStore", () => {
    let tempDir: string;
    let settingsFile: string;
    let store: SettingsStore;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-settings-"));
        settingsFile = join(tempDir, "settings.json");
        store = new SettingsStore(settingsFile);
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("returns fresh defaults including editor settings", async () => {
        const first = await store.get();
        expect(first).toEqual({
            general: {
                fontFamily: "CaskaydiaCove Nerd Font Mono, monospace",
                fontSize: 13,
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: 13,
            },
            editor: {
                fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
                fontSize: DEFAULT_EDITOR_FONT_SIZE,
            },
        });

        first.editor.fontSize = 20;

        expect(await store.get()).toEqual({
            general: {
                fontFamily: "CaskaydiaCove Nerd Font Mono, monospace",
                fontSize: 13,
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: 13,
            },
            editor: {
                fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
                fontSize: DEFAULT_EDITOR_FONT_SIZE,
            },
        });
    });

    it("merges persisted and partial editor updates with defaults", async () => {
        await writeFile(
            settingsFile,
            JSON.stringify({
                general: { fontSize: 15 },
                editor: { fontFamily: "Fira Code" },
            }),
        );

        expect(await store.get()).toEqual({
            general: {
                fontFamily: "CaskaydiaCove Nerd Font Mono, monospace",
                fontSize: 15,
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: 13,
            },
            editor: {
                fontFamily: "Fira Code",
                fontSize: DEFAULT_EDITOR_FONT_SIZE,
            },
        });

        expect(await store.update({ editor: { fontSize: 16 } })).toEqual({
            general: {
                fontFamily: "CaskaydiaCove Nerd Font Mono, monospace",
                fontSize: 15,
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: 13,
            },
            editor: {
                fontFamily: "Fira Code",
                fontSize: 16,
            },
        });
    });
});
