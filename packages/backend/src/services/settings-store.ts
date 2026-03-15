import { readFile, writeFile } from "fs/promises";
import {
    DEFAULT_EDITOR_FONT_FAMILY,
    DEFAULT_EDITOR_FONT_SIZE,
    DEFAULT_EDITOR_WORD_WRAP,
    DEFAULT_TERMINAL_FONT_FAMILY,
    DEFAULT_TERMINAL_SHELL,
    DEFAULT_THEME_ID,
} from "@taskflow/shared";
import type { AppSettings, SettingsUpdatePayload } from "@taskflow/shared";

const DEFAULTS: AppSettings = {
    general: {
        fontFamily: "CaskaydiaCove Nerd Font Mono, monospace",
        fontSize: 13,
        externalEditor: "system",
        defaultAgent: "claude",
        defaultRuntime: "bun",
    },
    terminal: {
        fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
        fontSize: 13,
        defaultShell: DEFAULT_TERMINAL_SHELL,
    },
    editor: {
        fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
        fontSize: DEFAULT_EDITOR_FONT_SIZE,
        wordWrap: DEFAULT_EDITOR_WORD_WRAP,
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
        },
    },
    claude: {
        defaultModel: "default",
        fullAccess: false,
    },
    codex: {
        fullAccess: false,
    },
    appearance: {
        theme: DEFAULT_THEME_ID,
    },
};

function createDefaultSettings(): AppSettings {
    return {
        general: { ...DEFAULTS.general },
        terminal: { ...DEFAULTS.terminal },
        editor: { ...DEFAULTS.editor },
        layout: {
            window: { ...DEFAULTS.layout.window },
            panels: { ...DEFAULTS.layout.panels },
        },
        claude: { ...DEFAULTS.claude },
        codex: { ...DEFAULTS.codex },
        appearance: { ...DEFAULTS.appearance },
    };
}

export class SettingsStore {
    constructor(private filePath: string) {}

    async get(): Promise<AppSettings> {
        try {
            const raw = await readFile(this.filePath, "utf-8");
            const parsed = JSON.parse(raw) as Partial<AppSettings>;
            const defaults = createDefaultSettings();
            return {
                general: { ...defaults.general, ...parsed.general },
                terminal: { ...defaults.terminal, ...parsed.terminal },
                editor: { ...defaults.editor, ...parsed.editor },
                layout: {
                    window: { ...defaults.layout.window, ...parsed.layout?.window },
                    panels: { ...defaults.layout.panels, ...parsed.layout?.panels },
                },
                claude: { ...defaults.claude, ...parsed.claude },
                codex: { ...defaults.codex, ...parsed.codex },
                appearance: { ...defaults.appearance, ...parsed.appearance },
            };
        } catch {
            return createDefaultSettings();
        }
    }

    async update(partial: SettingsUpdatePayload): Promise<AppSettings> {
        const current = await this.get();
        if (partial.general) {
            Object.assign(current.general, partial.general);
        }
        if (partial.terminal) {
            Object.assign(current.terminal, partial.terminal);
        }
        if (partial.editor) {
            Object.assign(current.editor, partial.editor);
        }
        if (partial.layout?.window) {
            Object.assign(current.layout.window, partial.layout.window);
        }
        if (partial.layout?.panels) {
            Object.assign(current.layout.panels, partial.layout.panels);
        }
        if (partial.claude) {
            Object.assign(current.claude, partial.claude);
        }
        if (partial.codex) {
            Object.assign(current.codex, partial.codex);
        }
        if (partial.appearance) {
            Object.assign(current.appearance, partial.appearance);
        }
        await writeFile(this.filePath, JSON.stringify(current, null, 2));
        return current;
    }
}
