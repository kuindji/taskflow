export interface GeneralSettings {
    fontFamily: string;
    fontSize: number;
}

export interface TerminalSettings {
    fontFamily: string;
    fontSize: number;
}

export interface AppSettings {
    general: GeneralSettings;
    terminal: TerminalSettings;
}

export interface SettingsUpdatePayload {
    general?: Partial<GeneralSettings>;
    terminal?: Partial<TerminalSettings>;
}
