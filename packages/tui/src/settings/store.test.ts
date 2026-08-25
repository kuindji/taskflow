import { describe, expect, test } from "bun:test";
import { MSG, type AppSettings } from "@taskflow/shared";
import type { NetLike } from "../net/client";
import { SettingsStore } from "./store";

function settings(): AppSettings {
    return {
        general: {
            fontFamily: "system",
            fontSize: 14,
            defaultAgent: "codex",
            defaultRuntime: "bun",
            favoriteAgents: [],
            confirmBeforeExit: false,
        },
        terminal: { fontFamily: "system", fontSize: 14, defaultShell: "system" },
        editor: {
            fontFamily: "system",
            fontSize: 14,
            wordWrap: true,
            internalEditor: "default",
            externalEditor: "system",
            markdownWidth: "medium",
        },
        layout: {
            window: { width: 1000, height: 700, isMaximized: false },
            panels: {
                sidebarWidth: 240,
                fileExplorerWidth: 240,
                taskInfoWidth: 300,
                flowPanelWidth: 300,
                compactSidebar: false,
                collapsedProjectIds: [],
                wikiRailOpen: false,
                wikiRailWidth: 300,
            },
        },
        claude: { defaultModel: "default", defaultEffort: "default", permissionMode: "default" },
        codex: {
            defaultModel: "gpt-current",
            defaultReasoningEffort: "default",
            sandbox: "workspace-write",
            approvalPolicy: "on-request",
            dangerouslyBypassApprovalsAndSandbox: false,
        },
        opencode: { defaultModel: "", autoApprove: false },
        pi: { defaultModel: "", thinking: "off", tools: "" },
        kimi: { defaultModel: "", permissionMode: "manual" },
        appearance: { theme: "default" },
        remoteAgent: { autoStart: false, appName: "", headless: false, permissionMode: "default" },
    };
}

function fakeNet(): NetLike & { requests: Array<{ type: string; payload: unknown }> } {
    const requests: Array<{ type: string; payload: unknown }> = [];
    const current = settings();
    return {
        requests,
        async request<T>(type: string, payload?: unknown): Promise<T> {
            requests.push({ type, payload });
            if (type === MSG.SETTINGS_GET) return current as T;
            if (type === MSG.SETTINGS_UPDATE) {
                const update = payload as { editor?: { externalEditor?: string } };
                return {
                    ...current,
                    editor: { ...current.editor, ...update.editor },
                } as T;
            }
            if (type === MSG.AGENTS_LIST) {
                return {
                    agents: [
                        { type: "codex", available: true, path: "/codex", version: "1" },
                        { type: "claude", available: false, path: "", version: "" },
                    ],
                } as T;
            }
            if (type === MSG.RUNTIMES_LIST) {
                return { runtimes: [{ name: "bun", path: "/bun", version: "1.4" }] } as T;
            }
            if (type === MSG.SHELLS_LIST) {
                return {
                    shells: [{ name: "zsh", path: "/bin/zsh" }],
                    systemShellPath: "/bin/zsh",
                } as T;
            }
            if (type === MSG.SYSTEM_INFO) {
                return {
                    editors: [
                        { id: "vim", name: "Vim", command: "vim", type: "external" },
                    ],
                    homedir: "/tmp",
                    schedulerEnabled: true,
                } as T;
            }
            if (type === MSG.CODEX_MODELS) {
                return {
                    models: [
                        {
                            id: "gpt-current",
                            model: "gpt-current",
                            displayName: "GPT Current",
                            description: "",
                            hidden: false,
                            supportedReasoningEfforts: [],
                            defaultReasoningEffort: "medium",
                            inputModalities: ["text"],
                            isDefault: true,
                        },
                    ],
                } as T;
            }
            if (
                type === MSG.OPENCODE_MODELS ||
                type === MSG.PI_MODELS ||
                type === MSG.KIMI_MODELS
            ) {
                return { models: [] } as T;
            }
            throw new Error(`Unexpected request: ${type}`);
        },
        on: () => () => undefined,
        onStatusChange: () => () => undefined,
    };
}

describe("SettingsStore", () => {
    test("loads settings and installed choices in parallel", async () => {
        const net = fakeNet();
        const store = new SettingsStore(net);
        await store.load();
        expect(store.settings?.general.defaultAgent).toBe("codex");
        expect(store.choices.agents).toEqual([{ value: "codex", label: "Codex" }]);
        expect(store.choices.runtimes[0]?.value).toBe("bun");
        expect(store.choices.editors[1]).toEqual({ value: "vim", label: "Vim" });
        expect(store.choices.models.codex).toEqual([
            { value: "gpt-current", label: "GPT Current" },
        ]);
        expect(net.requests.map((request) => request.type)).toContain(MSG.KIMI_MODELS);
        store.dispose();
    });

    test("saves one partial payload without replacing unrelated settings", async () => {
        const net = fakeNet();
        const store = new SettingsStore(net);
        await store.loadSettings();
        await store.update({ editor: { externalEditor: "vim" } });
        expect(net.requests.at(-1)).toEqual({
            type: MSG.SETTINGS_UPDATE,
            payload: { editor: { externalEditor: "vim" } },
        });
        expect(store.settings?.general.defaultRuntime).toBe("bun");
        expect(store.settings?.editor.externalEditor).toBe("vim");
        store.dispose();
    });
});
