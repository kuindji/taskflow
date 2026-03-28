import type { AgentType, CodexSandboxMode, CodexApprovalPolicy } from "./agent";

export interface GeneralSettings {
    fontFamily: string;
    fontSize: number;
    defaultAgent: AgentType;
    defaultRuntime: string;
    favoriteAgents: AgentType[];
}

export interface ClaudeSettings {
    defaultModel: "default" | "opus" | "sonnet" | "haiku";
    fullAccess: boolean;
    dontAskQuestions: boolean;
}

export interface CodexSettings {
    defaultModel: string;
    sandbox: CodexSandboxMode;
    approvalPolicy: CodexApprovalPolicy;
    fullAuto: boolean;
}

export interface OpenCodeSettings {
    defaultModel: string;
    fullAccess: boolean;
    dontAskQuestions: boolean;
}

export interface GeminiSettings {
    defaultModel: "default" | "auto" | "pro" | "flash" | "flash-lite";
    fullAccess: boolean;
    dontAskQuestions: boolean;
}

export interface CursorSettings {
    defaultModel: string;
    fullAccess: boolean;
    dontAskQuestions: boolean;
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
    gemini: GeminiSettings;
    cursor: CursorSettings;
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
    gemini?: NullablePartial<GeminiSettings>;
    cursor?: NullablePartial<CursorSettings>;
    appearance?: NullablePartial<AppearanceSettings>;
    remoteAgent?: NullablePartial<RemoteAgentSettings>;
}
