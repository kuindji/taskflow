import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
    ALL_AGENT_TYPES,
    DEFAULT_EDITOR_FONT_FAMILY,
    DEFAULT_EDITOR_FONT_SIZE,
    DEFAULT_EDITOR_WORD_WRAP,
    DEFAULT_TERMINAL_FONT_FAMILY,
    DEFAULT_TERMINAL_SHELL,
} from "@taskflow/shared";
import { SettingsStore } from "../../src/services/settings-store";

const DEFAULT_LAYOUT = {
    window: { width: 1400, height: 900, isMaximized: false },
    panels: {
        sidebarWidth: 220,
        fileExplorerWidth: 220,
        taskInfoWidth: 220,
        flowPanelWidth: 220,
        compactSidebar: false,
        collapsedProjectIds: [],
    },
};

const DEFAULT_CLAUDE = { defaultModel: "default" as const, fullAccess: false, dontAskQuestions: false };
const DEFAULT_CODEX = { fullAccess: false, dontAskQuestions: false };
const DEFAULT_OPENCODE = { defaultModel: "", fullAccess: false, dontAskQuestions: false };
const DEFAULT_GEMINI = { defaultModel: "default" as const, fullAccess: false, dontAskQuestions: false };
const DEFAULT_CURSOR = { defaultModel: "default", fullAccess: false, dontAskQuestions: false };
const DEFAULT_APPEARANCE = { theme: "catppuccin-mocha" };
const DEFAULT_REMOTE_AGENT = { autoStart: false, appName: "", headless: false };

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
                defaultAgent: "claude",
                defaultRuntime: "bun",
                favoriteAgents: [...ALL_AGENT_TYPES],
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: 13,
                defaultShell: DEFAULT_TERMINAL_SHELL,
            },
            editor: {
                fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
                fontSize: DEFAULT_EDITOR_FONT_SIZE,
                wordWrap: DEFAULT_EDITOR_WORD_WRAP,
                internalEditor: "monaco",
                externalEditor: "system",
            },
            layout: DEFAULT_LAYOUT,
            claude: DEFAULT_CLAUDE,
            codex: DEFAULT_CODEX,
            opencode: DEFAULT_OPENCODE,
            gemini: DEFAULT_GEMINI,
            cursor: DEFAULT_CURSOR,
            appearance: DEFAULT_APPEARANCE,
            remoteAgent: DEFAULT_REMOTE_AGENT,
        });

        first.editor.fontSize = 20;

        expect(await store.get()).toEqual({
            general: {
                fontFamily: "CaskaydiaCove Nerd Font Mono, monospace",
                fontSize: 13,
                defaultAgent: "claude",
                defaultRuntime: "bun",
                favoriteAgents: [...ALL_AGENT_TYPES],
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: 13,
                defaultShell: DEFAULT_TERMINAL_SHELL,
            },
            editor: {
                fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
                fontSize: DEFAULT_EDITOR_FONT_SIZE,
                wordWrap: DEFAULT_EDITOR_WORD_WRAP,
                internalEditor: "monaco",
                externalEditor: "system",
            },
            layout: DEFAULT_LAYOUT,
            claude: DEFAULT_CLAUDE,
            codex: DEFAULT_CODEX,
            opencode: DEFAULT_OPENCODE,
            gemini: DEFAULT_GEMINI,
            cursor: DEFAULT_CURSOR,
            appearance: DEFAULT_APPEARANCE,
            remoteAgent: DEFAULT_REMOTE_AGENT,
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
                defaultAgent: "claude",
                defaultRuntime: "bun",
                favoriteAgents: [...ALL_AGENT_TYPES],
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: 13,
                defaultShell: DEFAULT_TERMINAL_SHELL,
            },
            editor: {
                fontFamily: "Fira Code",
                fontSize: DEFAULT_EDITOR_FONT_SIZE,
                wordWrap: DEFAULT_EDITOR_WORD_WRAP,
                internalEditor: "monaco",
                externalEditor: "system",
            },
            layout: DEFAULT_LAYOUT,
            claude: DEFAULT_CLAUDE,
            codex: DEFAULT_CODEX,
            opencode: DEFAULT_OPENCODE,
            gemini: DEFAULT_GEMINI,
            cursor: DEFAULT_CURSOR,
            appearance: DEFAULT_APPEARANCE,
            remoteAgent: DEFAULT_REMOTE_AGENT,
        });

        expect(await store.update({ editor: { fontSize: 16 } })).toEqual({
            general: {
                fontFamily: "CaskaydiaCove Nerd Font Mono, monospace",
                fontSize: 15,
                defaultAgent: "claude",
                defaultRuntime: "bun",
                favoriteAgents: [...ALL_AGENT_TYPES],
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: 13,
                defaultShell: DEFAULT_TERMINAL_SHELL,
            },
            editor: {
                fontFamily: "Fira Code",
                fontSize: 16,
                wordWrap: DEFAULT_EDITOR_WORD_WRAP,
                internalEditor: "monaco",
                externalEditor: "system",
            },
            layout: DEFAULT_LAYOUT,
            claude: DEFAULT_CLAUDE,
            codex: DEFAULT_CODEX,
            opencode: DEFAULT_OPENCODE,
            gemini: DEFAULT_GEMINI,
            cursor: DEFAULT_CURSOR,
            appearance: DEFAULT_APPEARANCE,
            remoteAgent: DEFAULT_REMOTE_AGENT,
        });
    });

    it("returns layout defaults when no file exists", async () => {
        const settings = await store.get();
        expect(settings.layout).toEqual({
            window: { width: 1400, height: 900, isMaximized: false },
            panels: {
                sidebarWidth: 220,
                fileExplorerWidth: 220,
                taskInfoWidth: 220,
                flowPanelWidth: 220,
                compactSidebar: false,
                collapsedProjectIds: [],
            },
        });
    });

    it("persists the configured default terminal shell", async () => {
        const result = await store.update({
            terminal: { defaultShell: "/bin/bash" },
        });

        expect(result.terminal.defaultShell).toBe("/bin/bash");
        expect((await store.get()).terminal.defaultShell).toBe("/bin/bash");
    });

    it("persists appearance.theme setting", async () => {
        const result = await store.update({
            appearance: { theme: "dracula" },
        });

        expect(result.appearance.theme).toBe("dracula");
        expect((await store.get()).appearance.theme).toBe("dracula");
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
            flowPanelWidth: 220,
            compactSidebar: false,
            collapsedProjectIds: [],
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
            flowPanelWidth: 220,
            compactSidebar: false,
            collapsedProjectIds: [],
        });
    });

    it("merges persisted collapsed project ids with panel defaults", async () => {
        await writeFile(
            settingsFile,
            JSON.stringify({
                layout: { panels: { collapsedProjectIds: ["project-a", "project-b"] } },
            }),
        );

        const settings = await store.get();

        expect(settings.layout.panels).toEqual({
            sidebarWidth: 220,
            fileExplorerWidth: 220,
            taskInfoWidth: 220,
            flowPanelWidth: 220,
            compactSidebar: false,
            collapsedProjectIds: ["project-a", "project-b"],
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
