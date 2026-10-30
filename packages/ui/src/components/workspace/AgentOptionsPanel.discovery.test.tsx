import { afterEach, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CodexModelsResponse, CodexModelsPayload, CodexModelInfo } from "@taskflow/shared";
import { AgentOptionsPanel } from "./AgentOptionsPanel";
import { useBackendStore } from "@/stores/backend-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useProjectStore } from "@/stores/project-store";
import type { AgentLaunchOptions, AppSettings } from "@taskflow/shared";

// @ts-expect-error React test environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement;
function render(node: ReactNode) {
    if (!root) {
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    }
    const target = root;
    act(() => target.render(node));
}
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
});
async function flush() {
    await act(async () => {
        await Promise.resolve();
    });
}
const response = (models: CodexModelInfo[]): CodexModelsResponse => ({
    models,
    account: { state: "unknown" },
});

function seed() {
    const backend = useBackendStore.getState();
    const settings = useSettingsStore.getState();
    const projects = useProjectStore.getState();
    useBackendStore.setState({ primaryId: "primary" });
    const config: AppSettings = {
        general: {
            fontFamily: "sans",
            fontSize: 13,
            defaultAgent: "codex",
            defaultRuntime: "",
            favoriteAgents: [],
            confirmBeforeExit: false,
        },
        terminal: { fontFamily: "mono", fontSize: 13, defaultShell: "" },
        editor: {
            fontFamily: "mono",
            fontSize: 13,
            wordWrap: false,
            internalEditor: "",
            externalEditor: "",
            markdownWidth: "full",
        },
        layout: {
            window: { width: 1000, height: 800, isMaximized: false },
            panels: {
                sidebarWidth: 200,
                fileExplorerWidth: 200,
                taskInfoWidth: 200,
                flowPanelWidth: 200,
                compactSidebar: false,
                collapsedProjectIds: [],
                wikiRailOpen: false,
                wikiRailWidth: 200,
            },
        },
        claude: {
            accounts: [],
            defaultAccount: "default",
            defaultModel: "default",
            defaultEffort: "default",
            permissionMode: "default",
        },
        codex: {
            accounts: [{ id: "work", name: "remote work", homeDir: "/remote/home" }],
            defaultAccount: "work",
            defaultModel: "",
            defaultReasoningEffort: "default",
            sandbox: "workspace-write",
            approvalPolicy: "on-request",
            dangerouslyBypassApprovalsAndSandbox: false,
        },
        opencode: { defaultModel: "", autoApprove: false },
        pi: { defaultModel: "", thinking: "off", tools: "" },
        kimi: { defaultModel: "", permissionMode: "manual" },
        appearance: { theme: "dark" },
        remoteAgent: { autoStart: false, appName: "", headless: false, permissionMode: "default" },
        network: { discoverable: false, displayName: "" },
    };
    useSettingsStore.setState({
        settings: { ...config, codex: { ...config.codex, accounts: [] } },
        byBackend: { remote: config },
    });
    useProjectStore.setState({ projects: [] });
    return () => {
        useBackendStore.setState(backend);
        useSettingsStore.setState(settings);
        useProjectStore.setState(projects);
    };
}
test("Codex launch options query the selected account on the launch backend", async () => {
    const restore = seed();
    const calls: [string, CodexModelsPayload][] = [];
    try {
        render(
            <AgentOptionsPanel
                backendId="remote"
                projectId="project"
                agentType="codex"
                value={{ type: "codex", account: "work" }}
                loadDiscovery={async (backend, payload) => {
                    calls.push([backend, payload]);
                    return response([]);
                }}
            />,
        );
        await flush();
        expect(calls).toEqual([["remote", { account: "work", projectId: "project" }]]);
        expect(container.textContent).toContain("remote work");
    } finally {
        act(() => root?.unmount());
        root = null;
        container.remove();
        restore();
    }
});
test("Codex inherited launch discovery carries projectId without pinning an account", async () => {
    const restore = seed();
    const calls: [string, CodexModelsPayload][] = [];
    const changes: AgentLaunchOptions[] = [];
    try {
        render(
            <AgentOptionsPanel
                backendId="remote"
                projectId="project"
                agentType="codex"
                emitOnMount
                onChange={(value) => changes.push(value)}
                loadDiscovery={async (backend, payload) => {
                    calls.push([backend, payload]);
                    return response([]);
                }}
            />,
        );
        await flush();
        expect(calls).toEqual([["remote", { projectId: "project" }]]);
        expect(changes.length).toBeGreaterThan(0);
        expect(
            changes.every((value) => value.type === "codex" && value.account === undefined),
        ).toBe(true);
    } finally {
        act(() => root?.unmount());
        root = null;
        container.remove();
        restore();
    }
});
