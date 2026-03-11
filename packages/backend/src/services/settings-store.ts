import { readFile, writeFile } from "fs/promises";
import {
    DEFAULT_EDITOR_FONT_FAMILY,
    DEFAULT_EDITOR_FONT_SIZE,
    DEFAULT_TERMINAL_FONT_FAMILY,
} from "@taskflow/shared";
import type { AppSettings, SettingsUpdatePayload } from "@taskflow/shared";

const DEFAULTS: AppSettings = {
    general: {
        fontFamily: "CaskaydiaCove Nerd Font Mono, monospace",
        fontSize: 13,
    },
    terminal: {
        fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
        fontSize: 13,
    },
    editor: {
        fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
        fontSize: DEFAULT_EDITOR_FONT_SIZE,
    },
};

function createDefaultSettings(): AppSettings {
    return {
        general: { ...DEFAULTS.general },
        terminal: { ...DEFAULTS.terminal },
        editor: { ...DEFAULTS.editor },
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
        await writeFile(this.filePath, JSON.stringify(current, null, 2));
        return current;
    }
}
