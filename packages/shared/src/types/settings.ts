export interface GeneralSettings {
    fontFamily: string;
    fontSize: number;
}

export interface TerminalSettings {
    fontFamily: string;
    fontSize: number;
}

export interface EditorSettings {
    fontFamily: string;
    fontSize: number;
}

export interface AppSettings {
    general: GeneralSettings;
    terminal: TerminalSettings;
    editor: EditorSettings;
}

export interface SettingsUpdatePayload {
    general?: Partial<GeneralSettings>;
    terminal?: Partial<TerminalSettings>;
    editor?: Partial<EditorSettings>;
}
