export interface GeneralSettings {
    fontFamily: string;
    fontSize: number;
    externalEditor: string;
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
}

export interface LayoutSettings {
    window: WindowSettings;
    panels: PanelSettings;
}

export interface AppSettings {
    general: GeneralSettings;
    terminal: TerminalSettings;
    editor: EditorSettings;
    layout: LayoutSettings;
}

export interface SettingsUpdatePayload {
    general?: Partial<GeneralSettings>;
    terminal?: Partial<TerminalSettings>;
    editor?: Partial<EditorSettings>;
    layout?: {
        window?: Partial<WindowSettings>;
        panels?: Partial<PanelSettings>;
    };
}
