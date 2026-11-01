import type { AppSettings } from "@taskflow/shared";

/** Complete settings for tests, with `internalEditor` as the configured editor. */
export function settingsWith(internalEditor: string): AppSettings {
    return {
        general: {
            fontFamily: "",
            fontSize: 13,
            defaultAgent: "claude",
            defaultRuntime: "bun",
            favoriteAgents: [],
            confirmBeforeExit: false,
        },
        terminal: { fontFamily: "", fontSize: 13, defaultShell: "" },
        editor: {
            fontFamily: "",
            fontSize: 13,
            wordWrap: false,
            internalEditor,
            externalEditor: "system",
            markdownWidth: "medium",
        },
        layout: {
            window: { width: 1400, height: 900, isMaximized: false },
            panels: {
                sidebarWidth: 220,
                fileExplorerWidth: 220,
                taskInfoWidth: 220,
                flowPanelWidth: 220,
                compactSidebar: false,
                collapsedProjectIds: [],
                wikiRailOpen: false,
                wikiRailWidth: 220,
            },
        },
        claude: {
            defaultModel: "default",
            defaultEffort: "default",
            permissionMode: "default",
            accounts: [],
            defaultAccount: "default",
        },
        codex: {
            defaultModel: "",
            defaultReasoningEffort: "default",
            sandbox: "workspace-write",
            approvalPolicy: "on-request",
            dangerouslyBypassApprovalsAndSandbox: false,
            accounts: [],
            defaultAccount: "default",
        },
        opencode: { defaultModel: "", autoApprove: false },
        pi: { defaultModel: "", thinking: "off", tools: "" },
        kimi: { defaultModel: "", permissionMode: "manual" },
        appearance: { theme: "" },
        remoteAgent: { autoStart: false, appName: "", headless: false, permissionMode: "default" },
        network: { discoverable: false, displayName: "" },
    };
}
