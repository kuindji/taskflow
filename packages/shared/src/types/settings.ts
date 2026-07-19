import type {
    AgentType,
    ClaudePermissionMode,
    ClaudeEffortLevel,
    CodexSandboxMode,
    CodexApprovalPolicy,
    CodexReasoningEffort,
    PiThinkingLevel,
    KimiPermissionMode,
} from "./agent";

export interface GeneralSettings {
    fontFamily: string;
    fontSize: number;
    defaultAgent: AgentType;
    defaultRuntime: string;
    favoriteAgents: AgentType[];
    confirmBeforeExit: boolean;
}

export interface ClaudeSettings {
    defaultModel: string;
    defaultEffort: ClaudeEffortLevel | "default";
    permissionMode: ClaudePermissionMode | "default";
}

export interface CodexSettings {
    defaultModel: string;
    defaultReasoningEffort: CodexReasoningEffort | "default";
    sandbox: CodexSandboxMode;
    approvalPolicy: CodexApprovalPolicy;
    dangerouslyBypassApprovalsAndSandbox: boolean;
}

export interface OpenCodeSettings {
    defaultModel: string;
    autoApprove: boolean;
}

export interface PiSettings {
    defaultModel: string;
    thinking: PiThinkingLevel;
    tools: string;
}

export interface KimiSettings {
    defaultModel: string;
    permissionMode: KimiPermissionMode;
}

export interface TerminalSettings {
    fontFamily: string;
    fontSize: number;
    defaultShell: string;
}

export interface EditorSettings {
    fontFamily: string;
    fontSize: number;
    wordWrap: boolean;
    internalEditor: string;
    externalEditor: string;
}

export interface WindowSettings {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized: boolean;
}

export interface PanelSettings {
    sidebarWidth: number;
    fileExplorerWidth: number;
    taskInfoWidth: number;
    flowPanelWidth: number;
    compactSidebar: boolean;
    collapsedProjectIds: string[];
    markdownEditorPosition?: { x: number; y: number };
    markdownEditorSize?: { width: number; height: number };
}

export interface LayoutSettings {
    window: WindowSettings;
    panels: PanelSettings;
}

export interface RemoteAgentSettings {
    autoStart: boolean;
    appName: string;
    headless: boolean;
    permissionMode: ClaudePermissionMode | "default";
}

export interface AppearanceSettings {
    theme: string;
}

export interface AppSettings {
    general: GeneralSettings;
    terminal: TerminalSettings;
    editor: EditorSettings;
    layout: LayoutSettings;
    claude: ClaudeSettings;
    codex: CodexSettings;
    opencode: OpenCodeSettings;
    pi: PiSettings;
    kimi: KimiSettings;
    appearance: AppearanceSettings;
    remoteAgent: RemoteAgentSettings;
}

type NullablePartial<T> = { [K in keyof T]?: T[K] | null };

export interface SettingsUpdatePayload {
    general?: NullablePartial<GeneralSettings>;
    terminal?: NullablePartial<TerminalSettings>;
    editor?: NullablePartial<EditorSettings>;
    layout?: {
        window?: NullablePartial<WindowSettings>;
        panels?: NullablePartial<PanelSettings>;
    };
    claude?: NullablePartial<ClaudeSettings>;
    codex?: NullablePartial<CodexSettings>;
    opencode?: NullablePartial<OpenCodeSettings>;
    pi?: NullablePartial<PiSettings>;
    kimi?: NullablePartial<KimiSettings>;
    appearance?: NullablePartial<AppearanceSettings>;
    remoteAgent?: NullablePartial<RemoteAgentSettings>;
}
