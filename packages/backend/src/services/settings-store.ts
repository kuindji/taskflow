import { readFile, writeFile } from "fs/promises";
import { DEFAULT_TERMINAL_FONT_FAMILY } from "@taskflow/shared";
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
};

export class SettingsStore {
    constructor(private filePath: string) {}

    async get(): Promise<AppSettings> {
        try {
            const raw = await readFile(this.filePath, "utf-8");
            const parsed = JSON.parse(raw) as Partial<AppSettings>;
            return {
                general: { ...DEFAULTS.general, ...parsed.general },
                terminal: { ...DEFAULTS.terminal, ...parsed.terminal },
            };
        } catch {
            return { ...DEFAULTS };
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
        await writeFile(this.filePath, JSON.stringify(current, null, 2));
        return current;
    }
}
