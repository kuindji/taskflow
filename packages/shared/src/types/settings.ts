import type { AgentType } from "./agent";

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
    fullAccess: boolean;
    dontAskQuestions: boolean;
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

export interface SettingsUpdatePayload {
    general?: Partial<GeneralSettings>;
    terminal?: Partial<TerminalSettings>;
    editor?: Partial<EditorSettings>;
    layout?: {
        window?: Partial<WindowSettings>;
        panels?: Partial<PanelSettings>;
    };
    claude?: Partial<ClaudeSettings>;
    codex?: Partial<CodexSettings>;
    opencode?: Partial<OpenCodeSettings>;
    gemini?: Partial<GeminiSettings>;
    cursor?: Partial<CursorSettings>;
    appearance?: Partial<AppearanceSettings>;
    remoteAgent?: Partial<RemoteAgentSettings>;
}
