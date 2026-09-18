import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
    ALL_AGENT_TYPES,
    DEFAULT_EDITOR_FONT_FAMILY,
    DEFAULT_EDITOR_FONT_SIZE,
    DEFAULT_EDITOR_MARKDOWN_WIDTH,
    DEFAULT_EDITOR_WORD_WRAP,
    DEFAULT_GENERAL_FONT_FAMILY,
    DEFAULT_GENERAL_FONT_SIZE,
    DEFAULT_TERMINAL_FONT_FAMILY,
    DEFAULT_TERMINAL_FONT_SIZE,
    DEFAULT_TERMINAL_SHELL,
} from "@taskflow/shared";
import type { AppSettings } from "@taskflow/shared";
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
        wikiRailOpen: true,
        wikiRailWidth: 220,
    },
};

const DEFAULT_CLAUDE = {
    defaultModel: "default" as const,
    defaultEffort: "default" as const,
    permissionMode: "default" as const,
    accounts: [],
    defaultAccount: "default",
};
const DEFAULT_CODEX = {
    defaultModel: "",
    defaultReasoningEffort: "default" as const,
    sandbox: "workspace-write" as const,
    approvalPolicy: "on-request" as const,
    dangerouslyBypassApprovalsAndSandbox: false,
    accounts: [],
    defaultAccount: "default",
};
const DEFAULT_OPENCODE = {
    defaultModel: "",
    autoApprove: false,
};
const DEFAULT_PI = {
    defaultModel: "",
    thinking: "off" as const,
    tools: "read,bash,edit,write,grep,find,ls",
};
const DEFAULT_KIMI = {
    defaultModel: "",
    permissionMode: "manual" as const,
};
const DEFAULT_APPEARANCE = { theme: "catppuccin-mocha" };
const DEFAULT_NETWORK = { discoverable: true, displayName: "" };
const DEFAULT_REMOTE_AGENT = {
    autoStart: false,
    appName: "",
    headless: false,
    permissionMode: "default" as const,
};

describe("SettingsStore network settings", () => {
    let tempDir: string;
    let store: SettingsStore;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-settings-network-"));
        store = new SettingsStore(join(tempDir, "settings.json"));
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("persists a network update and tells update listeners the re-read settings", async () => {
        const seen: AppSettings["network"][] = [];
        store.onUpdated((settings) => seen.push(settings.network));

        await store.update({ network: { discoverable: false, displayName: "studio" } });
        expect((await store.get()).network).toEqual({
            discoverable: false,
            displayName: "studio",
        });

        // A null deletes the key, so the listener must see the default filled back in.
        await store.update({ network: { displayName: null } });
        expect(seen).toEqual([
            { discoverable: false, displayName: "studio" },
            { discoverable: false, displayName: "" },
        ]);
    });

    it("replaces hand-edited network values of the wrong type with defaults", async () => {
        // The advertiser calls `displayName.trim()` on every announce; a number
        // here would throw inside the bind callback and take the backend down.
        await writeFile(
            join(tempDir, "settings.json"),
            JSON.stringify({ network: { discoverable: "no", displayName: 5 } }),
        );
        expect((await store.get()).network).toEqual(DEFAULT_NETWORK);
    });
});

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
                fontFamily: DEFAULT_GENERAL_FONT_FAMILY,
                fontSize: DEFAULT_GENERAL_FONT_SIZE,
                defaultAgent: "claude",
                defaultRuntime: "bun",
                favoriteAgents: [...ALL_AGENT_TYPES],
                confirmBeforeExit: false,
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: DEFAULT_TERMINAL_FONT_SIZE,
                defaultShell: DEFAULT_TERMINAL_SHELL,
            },
            editor: {
                fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
                fontSize: DEFAULT_EDITOR_FONT_SIZE,
                wordWrap: DEFAULT_EDITOR_WORD_WRAP,
                internalEditor: "monaco",
                externalEditor: "system",
                markdownWidth: DEFAULT_EDITOR_MARKDOWN_WIDTH,
            },
            layout: DEFAULT_LAYOUT,
            claude: DEFAULT_CLAUDE,
            codex: DEFAULT_CODEX,
            opencode: DEFAULT_OPENCODE,
            pi: DEFAULT_PI,
            kimi: DEFAULT_KIMI,
            appearance: DEFAULT_APPEARANCE,
            remoteAgent: DEFAULT_REMOTE_AGENT,
            network: DEFAULT_NETWORK,
        });

        first.editor.fontSize = 20;

        expect(await store.get()).toEqual({
            general: {
                fontFamily: DEFAULT_GENERAL_FONT_FAMILY,
                fontSize: DEFAULT_GENERAL_FONT_SIZE,
                defaultAgent: "claude",
                defaultRuntime: "bun",
                favoriteAgents: [...ALL_AGENT_TYPES],
                confirmBeforeExit: false,
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: DEFAULT_TERMINAL_FONT_SIZE,
                defaultShell: DEFAULT_TERMINAL_SHELL,
            },
            editor: {
                fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
                fontSize: DEFAULT_EDITOR_FONT_SIZE,
                wordWrap: DEFAULT_EDITOR_WORD_WRAP,
                internalEditor: "monaco",
                externalEditor: "system",
                markdownWidth: DEFAULT_EDITOR_MARKDOWN_WIDTH,
            },
            layout: DEFAULT_LAYOUT,
            claude: DEFAULT_CLAUDE,
            codex: DEFAULT_CODEX,
            opencode: DEFAULT_OPENCODE,
            pi: DEFAULT_PI,
            kimi: DEFAULT_KIMI,
            appearance: DEFAULT_APPEARANCE,
            remoteAgent: DEFAULT_REMOTE_AGENT,
            network: DEFAULT_NETWORK,
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
                fontFamily: DEFAULT_GENERAL_FONT_FAMILY,
                fontSize: 15,
                defaultAgent: "claude",
                defaultRuntime: "bun",
                favoriteAgents: [...ALL_AGENT_TYPES],
                confirmBeforeExit: false,
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: DEFAULT_TERMINAL_FONT_SIZE,
                defaultShell: DEFAULT_TERMINAL_SHELL,
            },
            editor: {
                fontFamily: "Fira Code",
                fontSize: DEFAULT_EDITOR_FONT_SIZE,
                wordWrap: DEFAULT_EDITOR_WORD_WRAP,
                internalEditor: "monaco",
                externalEditor: "system",
                markdownWidth: DEFAULT_EDITOR_MARKDOWN_WIDTH,
            },
            layout: DEFAULT_LAYOUT,
            claude: DEFAULT_CLAUDE,
            codex: DEFAULT_CODEX,
            opencode: DEFAULT_OPENCODE,
            pi: DEFAULT_PI,
            kimi: DEFAULT_KIMI,
            appearance: DEFAULT_APPEARANCE,
            remoteAgent: DEFAULT_REMOTE_AGENT,
            network: DEFAULT_NETWORK,
        });

        expect(await store.update({ editor: { fontSize: 16 } })).toEqual({
            general: {
                fontFamily: DEFAULT_GENERAL_FONT_FAMILY,
                fontSize: 15,
                defaultAgent: "claude",
                defaultRuntime: "bun",
                favoriteAgents: [...ALL_AGENT_TYPES],
                confirmBeforeExit: false,
            },
            terminal: {
                fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
                fontSize: DEFAULT_TERMINAL_FONT_SIZE,
                defaultShell: DEFAULT_TERMINAL_SHELL,
            },
            editor: {
                fontFamily: "Fira Code",
                fontSize: 16,
                wordWrap: DEFAULT_EDITOR_WORD_WRAP,
                internalEditor: "monaco",
                externalEditor: "system",
                markdownWidth: DEFAULT_EDITOR_MARKDOWN_WIDTH,
            },
            layout: DEFAULT_LAYOUT,
            claude: DEFAULT_CLAUDE,
            codex: DEFAULT_CODEX,
            opencode: DEFAULT_OPENCODE,
            pi: DEFAULT_PI,
            kimi: DEFAULT_KIMI,
            appearance: DEFAULT_APPEARANCE,
            remoteAgent: DEFAULT_REMOTE_AGENT,
            network: DEFAULT_NETWORK,
        });
    });

    it("drops legacy gemini/cursor blocks and the retired opencode variant", async () => {
        await writeFile(
            settingsFile,
            JSON.stringify({
                general: { defaultAgent: "gemini", favoriteAgents: ["claude", "cursor", "pi"] },
                opencode: { defaultModel: "opencode/big-pickle", defaultVariant: "high" },
                gemini: { defaultModel: "pro", approvalMode: "yolo", sandbox: true },
                cursor: { defaultModel: "sonnet-4", yolo: true },
            }),
        );

        const settings = await store.get();
        expect(settings.general.defaultAgent).toBe("claude");
        expect(settings.general.favoriteAgents).toEqual(["claude", "pi"]);
        expect(settings.opencode).toEqual({
            defaultModel: "opencode/big-pickle",
            autoApprove: false,
        });
        expect("gemini" in settings).toBe(false);
        expect("cursor" in settings).toBe(false);

        // The cleanup migration persists: the rewritten file has no legacy keys.
        const raw = JSON.parse(await readFile(settingsFile, "utf8")) as Record<string, unknown>;
        expect("defaultVariant" in (raw.opencode as Record<string, unknown>)).toBe(false);
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
                wikiRailOpen: true,
                wikiRailWidth: 220,
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
            wikiRailOpen: true,
            wikiRailWidth: 220,
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
            wikiRailOpen: true,
            wikiRailWidth: 220,
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
            wikiRailOpen: true,
            wikiRailWidth: 220,
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

    it("drops unknown agent values from defaultAgent and favoriteAgents", async () => {
        await writeFile(
            settingsFile,
            JSON.stringify({
                general: {
                    defaultAgent: "futureagent",
                    favoriteAgents: ["claude", "futureagent", "codex"],
                },
            }),
        );

        const settings = await store.get();

        expect(settings.general.defaultAgent).toBe("claude");
        expect(settings.general.favoriteAgents).toEqual(["claude", "codex"]);
    });

    it("does not rewrite the settings file when sanitizing unknown agents", async () => {
        const onDisk = JSON.stringify({
            general: {
                defaultAgent: "futureagent",
                favoriteAgents: ["claude", "futureagent"],
            },
        });
        await writeFile(settingsFile, onDisk);

        await store.get();

        const after = await readFile(settingsFile, "utf-8");
        expect(after).toBe(onDisk);
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

    it("migrates legacy Codex fullAuto and approval settings safely", async () => {
        await writeFile(
            settingsFile,
            JSON.stringify({
                codex: {
                    defaultModel: "legacy-model",
                    sandbox: "read-only",
                    approvalPolicy: "always",
                    fullAuto: true,
                },
            }),
        );

        const settings = await store.get();
        expect(settings.codex).toEqual({
            defaultModel: "legacy-model",
            defaultReasoningEffort: "default",
            sandbox: "workspace-write",
            approvalPolicy: "on-request",
            dangerouslyBypassApprovalsAndSandbox: false,
            accounts: [],
            defaultAccount: "default",
        });

        const persisted = JSON.parse(await readFile(settingsFile, "utf-8")) as {
            codex: Record<string, unknown>;
        };
        expect(persisted.codex.fullAuto).toBeUndefined();
    });

    it("maps the legacy allow-list approval policy to untrusted", async () => {
        await writeFile(
            settingsFile,
            JSON.stringify({ codex: { approvalPolicy: "unless-allow-listed" } }),
        );

        expect((await store.get()).codex.approvalPolicy).toBe("untrusted");
    });

    it("migrates the legacy Claude skip-permissions toggle to bypassPermissions", async () => {
        await writeFile(
            settingsFile,
            JSON.stringify({ claude: { dangerouslySkipPermissions: true } }),
        );

        expect((await store.get()).claude.permissionMode).toBe("bypassPermissions");
        const persisted = JSON.parse(await readFile(settingsFile, "utf-8")) as {
            claude: Record<string, unknown>;
        };
        expect(persisted.claude.dangerouslySkipPermissions).toBeUndefined();
    });

    it("normalizes invalid Claude and Remote Agent settings", async () => {
        await writeFile(
            settingsFile,
            JSON.stringify({
                claude: {
                    defaultModel: 42,
                    defaultEffort: "turbo",
                    permissionMode: "reckless",
                },
                remoteAgent: { permissionMode: "reckless" },
            }),
        );

        const settings = await store.get();
        expect(settings.claude).toEqual(DEFAULT_CLAUDE);
        expect(settings.remoteAgent).toEqual(DEFAULT_REMOTE_AGENT);
    });

    it("accepts current Claude manual and ultracode settings", async () => {
        const settings = await store.update({
            claude: { permissionMode: "manual", defaultEffort: "ultracode" },
            remoteAgent: { permissionMode: "manual" },
        });

        expect(settings.claude.permissionMode).toBe("manual");
        expect(settings.claude.defaultEffort).toBe("ultracode");
        expect(settings.remoteAgent.permissionMode).toBe("manual");
    });
});

describe("agent accounts settings", () => {
    let dir: string;
    let store: SettingsStore;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "taskflow-settings-accounts-"));
        store = new SettingsStore(join(dir, "settings.json"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("fills account defaults for files written before accounts existed", async () => {
        await writeFile(
            join(dir, "settings.json"),
            JSON.stringify({ claude: { defaultModel: "opus" }, codex: {} }),
        );
        const settings = await store.get();
        expect(settings.claude.accounts).toEqual([]);
        expect(settings.claude.defaultAccount).toBe("default");
        expect(settings.codex.accounts).toEqual([]);
        expect(settings.codex.defaultAccount).toBe("default");
    });

    it("does not share the accounts array between default settings objects", async () => {
        const first = await store.get();
        first.claude.accounts.push({ id: "x", name: "x", homeDir: "/x" });
        const second = await store.get();
        expect(second.claude.accounts).toEqual([]);
    });

    it("stores valid accounts and a default pointing at one of them", async () => {
        const settings = await store.update({
            claude: {
                accounts: [{ id: "a1", name: "work", homeDir: "/Users/me/.claude-work" }],
                defaultAccount: "a1",
            },
        });
        expect(settings.claude.accounts).toEqual([
            { id: "a1", name: "work", homeDir: "/Users/me/.claude-work" },
        ]);
        expect(settings.claude.defaultAccount).toBe("a1");
    });

    it("rejects duplicate names, reserved names, bad ids and relative paths", async () => {
        const bad = [
            [
                { id: "a1", name: "work", homeDir: "/a" },
                { id: "a2", name: "Work", homeDir: "/b" },
            ],
            [{ id: "a1", name: "default", homeDir: "/a" }],
            [{ id: "a1", name: "Inherit", homeDir: "/a" }],
            [{ id: "default", name: "work", homeDir: "/a" }],
            [{ id: "inherit", name: "work", homeDir: "/a" }],
            [
                { id: "a1", name: "one", homeDir: "/a" },
                { id: "a1", name: "two", homeDir: "/b" },
            ],
            [{ id: "a1", name: "work", homeDir: "relative/dir" }],
            [{ id: "a1", name: "  ", homeDir: "/a" }],
        ];
        for (const accounts of bad) {
            // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test .rejects.toThrow() returns a Promise at runtime
            await expect(store.update({ codex: { accounts } })).rejects.toThrow();
        }
        expect((await store.get()).codex.accounts).toEqual([]);
    });

    it("normalizes account home dirs so two spellings of one directory match", async () => {
        const settings = await store.update({
            codex: {
                accounts: [
                    { id: "a1", name: "one", homeDir: "/homes/x" },
                    { id: "a2", name: "two", homeDir: "/homes/x/" },
                ],
            },
        });
        expect(settings.codex.accounts.map((account) => account.homeDir)).toEqual([
            "/homes/x",
            "/homes/x",
        ]);
        const reloaded = await store.get();
        expect(reloaded.codex.accounts.map((account) => account.homeDir)).toEqual([
            "/homes/x",
            "/homes/x",
        ]);
    });

    it("rejects deleting the account that is the global default", async () => {
        await store.update({
            claude: {
                accounts: [{ id: "a1", name: "work", homeDir: "/a" }],
                defaultAccount: "a1",
            },
        });
        // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test .rejects.toThrow() returns a Promise at runtime
        await expect(store.update({ claude: { accounts: [] } })).rejects.toThrow(
            /default account/i,
        );
        expect((await store.get()).claude.accounts).toHaveLength(1);
    });

    it("allows switching the default back to the built-in account", async () => {
        await store.update({
            claude: {
                accounts: [{ id: "a1", name: "work", homeDir: "/a" }],
                defaultAccount: "a1",
            },
        });
        const settings = await store.update({
            claude: { defaultAccount: "default", accounts: [] },
        });
        expect(settings.claude.defaultAccount).toBe("default");
        expect(settings.claude.accounts).toEqual([]);
    });
});
