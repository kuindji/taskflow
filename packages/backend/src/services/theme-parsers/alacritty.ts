import { parse as parseToml } from "smol-toml";
import { access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { ThemeSource, ThemeColors, AnsiColors } from "@taskflow/shared";

interface AlacrittyColors {
    primary?: { foreground?: string; background?: string };
    normal?: Record<string, string>;
    bright?: Record<string, string>;
    cursor?: { text?: string; cursor?: string };
    selection?: { text?: string; background?: string };
}

interface AlacrittyConfig {
    colors?: AlacrittyColors;
}

function normalizeHex(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    const match = /^#?([0-9a-fA-F]{6})$/.exec(trimmed);
    if (!match) return null;
    return `#${match[1].toLowerCase()}`;
}

function extractAnsi(normal: Record<string, string> | undefined, bright: Record<string, string> | undefined): AnsiColors | null {
    const colorMap: Record<string, keyof AnsiColors> = {
        black: "black",
        red: "red",
        green: "green",
        yellow: "yellow",
        blue: "blue",
        magenta: "magenta",
        cyan: "cyan",
        white: "white",
    };
    const brightMap: Record<string, keyof AnsiColors> = {
        black: "brightBlack",
        red: "brightRed",
        green: "brightGreen",
        yellow: "brightYellow",
        blue: "brightBlue",
        magenta: "brightMagenta",
        cyan: "brightCyan",
        white: "brightWhite",
    };

    const ansi: Partial<AnsiColors> = {};

    for (const [name, key] of Object.entries(colorMap)) {
        const hex = normalizeHex(normal?.[name]);
        if (!hex) return null;
        ansi[key] = hex;
    }

    for (const [name, key] of Object.entries(brightMap)) {
        const hex = normalizeHex(bright?.[name]);
        if (!hex) return null;
        ansi[key] = hex;
    }

    return ansi as AnsiColors;
}

function parseAlacrittyConfig(config: AlacrittyConfig, name: string): ThemeSource | null {
    const colors = config.colors;
    if (!colors) return null;

    const fg = normalizeHex(colors.primary?.foreground);
    const bg = normalizeHex(colors.primary?.background);
    if (!fg || !bg) return null;

    const ansi = extractAnsi(colors.normal, colors.bright);
    if (!ansi) return null;

    const cursor = normalizeHex(colors.cursor?.cursor) ?? fg;
    const cursorText = normalizeHex(colors.cursor?.text) ?? bg;
    const selection = normalizeHex(colors.selection?.background) ?? ansi.blue;
    const selectionText = normalizeHex(colors.selection?.text) ?? fg;

    const themeColors: ThemeColors = {
        foreground: fg,
        background: bg,
        cursor,
        cursorText,
        selection,
        selectionText,
        ansi,
    };

    return {
        version: 1,
        name,
        origin: "imported",
        colors: themeColors,
    };
}

function parseAlacrittyToml(toml: string, name: string): ThemeSource | null {
    try {
        const config = parseToml(toml) as AlacrittyConfig;
        return parseAlacrittyConfig(config, name);
    } catch {
        return null;
    }
}

async function detectAlacritty(): Promise<boolean> {
    try {
        await access(join(homedir(), ".config", "alacritty", "alacritty.toml"));
        return true;
    } catch {
        return false;
    }
}

async function parseAlacritty(): Promise<ThemeSource[]> {
    const configPath = join(homedir(), ".config", "alacritty", "alacritty.toml");
    try {
        const content = await Bun.file(configPath).text();
        const theme = parseAlacrittyToml(content, "Alacritty");
        return theme ? [theme] : [];
    } catch {
        return [];
    }
}

export { parseAlacrittyToml, detectAlacritty, parseAlacritty };
