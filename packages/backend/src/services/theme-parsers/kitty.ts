import { access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { ThemeSource, ThemeColors, AnsiColors } from "@taskflow/shared";

function normalizeHex(value: string): string | null {
    const trimmed = value.trim();
    const match = /^#?([0-9a-fA-F]{6})$/.exec(trimmed);
    if (!match) return null;
    return `#${match[1].toLowerCase()}`;
}

const ANSI_INDEX_MAP: Record<number, keyof AnsiColors> = {
    0: "black",
    1: "red",
    2: "green",
    3: "yellow",
    4: "blue",
    5: "magenta",
    6: "cyan",
    7: "white",
    8: "brightBlack",
    9: "brightRed",
    10: "brightGreen",
    11: "brightYellow",
    12: "brightBlue",
    13: "brightMagenta",
    14: "brightCyan",
    15: "brightWhite",
};

function parseKittyConfig(content: string, name: string): ThemeSource | null {
    const lines = content.split("\n");
    const values: Record<string, string> = {};

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#") || !trimmed) continue;

        // Kitty uses space-separated "key value" format
        const match = /^(\S+)\s+(.+)$/.exec(trimmed);
        if (!match) continue;

        values[match[1]] = match[2].trim();
    }

    const fg = normalizeHex(values["foreground"] ?? "");
    const bg = normalizeHex(values["background"] ?? "");
    if (!fg || !bg) return null;

    const ansi: Partial<AnsiColors> = {};

    for (const [idx, key] of Object.entries(ANSI_INDEX_MAP)) {
        const hex = normalizeHex(values[`color${idx}`] ?? "");
        if (!hex) return null;
        ansi[key] = hex;
    }

    const cursor = normalizeHex(values["cursor"] ?? "") ?? fg;
    const cursorText = normalizeHex(values["cursor_text_color"] ?? "") ?? bg;
    const selection =
        normalizeHex(values["selection_background"] ?? "") ?? (ansi as AnsiColors).blue;
    const selectionText = normalizeHex(values["selection_foreground"] ?? "") ?? fg;

    const colors: ThemeColors = {
        foreground: fg,
        background: bg,
        cursor,
        cursorText,
        selection,
        selectionText,
        ansi: ansi as AnsiColors,
    };

    return {
        version: 1,
        name,
        origin: "imported",
        colors,
    };
}

async function detectKitty(): Promise<boolean> {
    try {
        await access(join(homedir(), ".config", "kitty", "kitty.conf"));
        return true;
    } catch {
        return false;
    }
}

async function parseKitty(): Promise<ThemeSource[]> {
    const configPath = join(homedir(), ".config", "kitty", "kitty.conf");
    try {
        const content = await Bun.file(configPath).text();
        const theme = parseKittyConfig(content, "Kitty");
        return theme ? [theme] : [];
    } catch {
        return [];
    }
}

export { parseKittyConfig, detectKitty, parseKitty };
