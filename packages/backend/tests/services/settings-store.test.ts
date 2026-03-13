import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
    DEFAULT_EDITOR_FONT_FAMILY,
    DEFAULT_EDITOR_FONT_SIZE,
    DEFAULT_TERMINAL_FONT_FAMILY,
    DEFAULT_TERMINAL_SHELL,
} from "@taskflow/shared";
import { SettingsStore } from "../../src/services/settings-store";

const DEFAULT_LAYOUT = {
    window: { width: 1400, height: 900, isMaximized: false },
    panels: { sidebarWidth: 220, fileExplorerWidth: 220, taskInfoWidth: 220, compactSidebar: false },
};

const DEFAULT_CLAUDE = { defaultModel: "default" as const, fullAccess: false };
const DEFAULT_CODEX = { fullAccess: false };

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
                externalEditor: "system",
                defaultAgent: "claude",
                defaultRuntime: "bun",
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: 13,
                defaultShell: DEFAULT_TERMINAL_SHELL,
            },
            editor: {
                fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
                fontSize: DEFAULT_EDITOR_FONT_SIZE,
            },
            layout: DEFAULT_LAYOUT,
            claude: DEFAULT_CLAUDE,
            codex: DEFAULT_CODEX,
        });

        first.editor.fontSize = 20;

        expect(await store.get()).toEqual({
            general: {
                fontFamily: "CaskaydiaCove Nerd Font Mono, monospace",
                fontSize: 13,
                externalEditor: "system",
                defaultAgent: "claude",
                defaultRuntime: "bun",
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: 13,
                defaultShell: DEFAULT_TERMINAL_SHELL,
            },
            editor: {
                fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
                fontSize: DEFAULT_EDITOR_FONT_SIZE,
            },
            layout: DEFAULT_LAYOUT,
            claude: DEFAULT_CLAUDE,
            codex: DEFAULT_CODEX,
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
                externalEditor: "system",
                defaultAgent: "claude",
                defaultRuntime: "bun",
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: 13,
                defaultShell: DEFAULT_TERMINAL_SHELL,
            },
            editor: {
                fontFamily: "Fira Code",
                fontSize: DEFAULT_EDITOR_FONT_SIZE,
            },
            layout: DEFAULT_LAYOUT,
            claude: DEFAULT_CLAUDE,
            codex: DEFAULT_CODEX,
        });

        expect(await store.update({ editor: { fontSize: 16 } })).toEqual({
            general: {
                fontFamily: "CaskaydiaCove Nerd Font Mono, monospace",
                fontSize: 15,
                externalEditor: "system",
                defaultAgent: "claude",
                defaultRuntime: "bun",
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: 13,
                defaultShell: DEFAULT_TERMINAL_SHELL,
            },
            editor: {
                fontFamily: "Fira Code",
                fontSize: 16,
            },
            layout: DEFAULT_LAYOUT,
            claude: DEFAULT_CLAUDE,
            codex: DEFAULT_CODEX,
        });
    });

    it("returns layout defaults when no file exists", async () => {
        const settings = await store.get();
        expect(settings.layout).toEqual({
            window: { width: 1400, height: 900, isMaximized: false },
            panels: { sidebarWidth: 220, fileExplorerWidth: 220, taskInfoWidth: 220, compactSidebar: false },
        });
    });

    it("persists the configured default terminal shell", async () => {
        const result = await store.update({
            terminal: { defaultShell: "/bin/bash" },
        });

        expect(result.terminal.defaultShell).toBe("/bin/bash");
        expect((await store.get()).terminal.defaultShell).toBe("/bin/bash");
    });

    it("merges partial layout.window with defaults", async () => {
        await writeFile(
            settingsFile,
            JSON.stringify({
                layout: { window: { width: 1600, height: 1000 } },
            }),
        );

        const settings = await store.get();
        expect(settings.layout.window).toEqual({
            width: 1600,
            height: 1000,
            isMaximized: false,
        });
        expect(settings.layout.panels).toEqual({
            sidebarWidth: 220,
            fileExplorerWidth: 220,
            taskInfoWidth: 220,
            compactSidebar: false,
        });
    });

    it("updates layout.panels without clobbering layout.window", async () => {
        await store.update({
            layout: { window: { x: 100, y: 200, width: 1600, height: 1000, isMaximized: false } },
        });

        const result = await store.update({
            layout: { panels: { sidebarWidth: 280 } },
        });

        expect(result.layout.window).toEqual({
            x: 100,
            y: 200,
            width: 1600,
            height: 1000,
            isMaximized: false,
        });
        expect(result.layout.panels).toEqual({
            sidebarWidth: 280,
            fileExplorerWidth: 220,
            taskInfoWidth: 220,
            compactSidebar: false,
        });
    });

    it("updates individual window fields without clobbering others", async () => {
        await store.update({
            layout: { window: { x: 50, y: 75, width: 1200, height: 800, isMaximized: false } },
        });

        const result = await store.update({
            layout: { window: { isMaximized: true } },
        });

        expect(result.layout.window).toEqual({
            x: 50,
            y: 75,
            width: 1200,
            height: 800,
            isMaximized: true,
        });
    });

    it("persists defaultAgent and defaultRuntime settings", async () => {
        const result = await store.update({
            general: { defaultAgent: "codex", defaultRuntime: "node" },
        });

        expect(result.general.defaultAgent).toBe("codex");
        expect(result.general.defaultRuntime).toBe("node");
        expect((await store.get()).general.defaultAgent).toBe("codex");
        expect((await store.get()).general.defaultRuntime).toBe("node");
    });
});
