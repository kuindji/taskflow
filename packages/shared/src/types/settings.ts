import type { AgentType } from "./agent";

export interface GeneralSettings {
    fontFamily: string;
    fontSize: number;
    externalEditor: string;
    defaultAgent: AgentType;
    defaultRuntime: string;
}

export interface ClaudeSettings {
    defaultModel: "default" | "opus" | "sonnet" | "haiku";
    fullAccess: boolean;
}

export interface CodexSettings {
    fullAccess: boolean;
}

export interface TerminalSettings {
    fontFamily: string;
    fontSize: number;
    defaultShell: string;
}

export interface EditorSettings {
    fontFamily: string;
    fontSize: number;
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
    compactSidebar: boolean;
}

export interface LayoutSettings {
    window: WindowSettings;
    panels: PanelSettings;
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
    appearance: AppearanceSettings;
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
    appearance?: Partial<AppearanceSettings>;
}
