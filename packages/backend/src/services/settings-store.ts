import { readFile, writeFile } from "fs/promises";
import {
    ALL_AGENT_TYPES,
    DEFAULT_EDITOR_FONT_FAMILY,
    DEFAULT_EDITOR_FONT_SIZE,
    DEFAULT_EDITOR_WORD_WRAP,
    DEFAULT_GENERAL_FONT_FAMILY,
    DEFAULT_GENERAL_FONT_SIZE,
    DEFAULT_TERMINAL_FONT_FAMILY,
    DEFAULT_TERMINAL_FONT_SIZE,
    DEFAULT_TERMINAL_SHELL,
    DEFAULT_THEME_ID,
} from "@taskflow/shared";
import type {
    AppSettings,
    EditorSettings,
    GeneralSettings,
    SettingsUpdatePayload,
} from "@taskflow/shared";

const DEFAULTS: AppSettings = {
    general: {
        fontFamily: DEFAULT_GENERAL_FONT_FAMILY,
        fontSize: DEFAULT_GENERAL_FONT_SIZE,
        defaultAgent: "claude",
        defaultRuntime: "bun",
        favoriteAgents: [...ALL_AGENT_TYPES],
    },
    terminal: {
        fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
        fontSize: DEFAULT_TERMINAL_FONT_SIZE,
        defaultShell: DEFAULT_TERMINAL_SHELL,
    },
    editor: {
        fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
        fontSize: DEFAULT_EDITOR_FONT_SIZE,
        wordWrap: DEFAULT_EDITOR_WORD_WRAP,
        internalEditor: "monaco",
        externalEditor: "system",
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
        dontAskQuestions: false,
    },
    codex: {
        defaultModel: "",
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        fullAuto: false,
    },
    opencode: {
        defaultModel: "",
        fullAccess: false,
        dontAskQuestions: false,
    },
    gemini: {
        defaultModel: "default",
        fullAccess: false,
        dontAskQuestions: false,
    },
    cursor: {
        defaultModel: "default",
        fullAccess: false,
        dontAskQuestions: false,
    },
    appearance: {
        theme: DEFAULT_THEME_ID,
    },
    remoteAgent: {
        autoStart: false,
        appName: "",
        headless: false,
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
        opencode: { ...DEFAULTS.opencode },
        gemini: { ...DEFAULTS.gemini },
        cursor: { ...DEFAULTS.cursor },
        appearance: { ...DEFAULTS.appearance },
        remoteAgent: { ...DEFAULTS.remoteAgent },
    };
}

/** Apply partial update, deleting keys set to null so defaults fill in on next get(). */
function applyNullable<T extends object>(target: T, patch: { [K in keyof T]?: T[K] | null }): void {
    for (const key of Object.keys(patch) as Array<keyof T>) {
        if (patch[key] === null) {
            Reflect.deleteProperty(target, key);
        } else if (patch[key] !== undefined) {
            target[key] = patch[key] as T[keyof T];
        }
    }
}

export class SettingsStore {
    constructor(private filePath: string) {}

    async get(): Promise<AppSettings> {
        try {
            const raw = await readFile(this.filePath, "utf-8");
            const parsed = JSON.parse(raw) as Partial<AppSettings> & {
                general?: Partial<GeneralSettings> & { externalEditor?: string };
            };
            const defaults = createDefaultSettings();

            // Migration: move externalEditor from general to editor
            let needsMigration = false;
            if (parsed.general && "externalEditor" in parsed.general) {
                const editorPartial: Partial<EditorSettings> = parsed.editor ?? {};
                if (!editorPartial.externalEditor) {
                    editorPartial.externalEditor = parsed.general.externalEditor;
                }
                parsed.editor = editorPartial as EditorSettings;
                delete parsed.general.externalEditor;
                needsMigration = true;
            }

            const result = {
                general: { ...defaults.general, ...parsed.general },
                terminal: { ...defaults.terminal, ...parsed.terminal },
                editor: { ...defaults.editor, ...parsed.editor },
                layout: {
                    window: { ...defaults.layout.window, ...parsed.layout?.window },
                    panels: { ...defaults.layout.panels, ...parsed.layout?.panels },
                },
                claude: { ...defaults.claude, ...parsed.claude },
                codex: { ...defaults.codex, ...parsed.codex },
                opencode: { ...defaults.opencode, ...parsed.opencode },
                gemini: { ...defaults.gemini, ...parsed.gemini },
                cursor: { ...defaults.cursor, ...parsed.cursor },
                appearance: { ...defaults.appearance, ...parsed.appearance },
                remoteAgent: { ...defaults.remoteAgent, ...parsed.remoteAgent },
            };

            // Persist migration so it only runs once
            if (needsMigration) {
                await writeFile(this.filePath, JSON.stringify(result, null, 2));
            }

            return result;
        } catch {
            return createDefaultSettings();
        }
    }

    async update(partial: SettingsUpdatePayload): Promise<AppSettings> {
        const current = await this.get();
        if (partial.general) {
            applyNullable(current.general, partial.general);
        }
        if (partial.terminal) {
            applyNullable(current.terminal, partial.terminal);
        }
        if (partial.editor) {
            applyNullable(current.editor, partial.editor);
        }
        if (partial.layout?.window) {
            applyNullable(current.layout.window, partial.layout.window);
        }
        if (partial.layout?.panels) {
            applyNullable(current.layout.panels, partial.layout.panels);
        }
        if (partial.claude) {
            applyNullable(current.claude, partial.claude);
        }
        if (partial.codex) {
            applyNullable(current.codex, partial.codex);
        }
        if (partial.opencode) {
            applyNullable(current.opencode, partial.opencode);
        }
        if (partial.gemini) {
            applyNullable(current.gemini, partial.gemini);
        }
        if (partial.cursor) {
            applyNullable(current.cursor, partial.cursor);
        }
        if (partial.appearance) {
            applyNullable(current.appearance, partial.appearance);
        }
        if (partial.remoteAgent) {
            applyNullable(current.remoteAgent, partial.remoteAgent);
        }
        // Persist without null keys so defaults fill in on next get()
        await writeFile(this.filePath, JSON.stringify(current, null, 2));
        // Re-read to apply defaults for any deleted keys
        return this.get();
    }
}
