import { parse as parseYaml } from "yaml";
import { readdir, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { ThemeSource, ThemeColors, AnsiColors } from "@taskflow/shared";

interface WarpTheme {
    accent?: string;
    background?: string;
    foreground?: string;
    cursor?: string;
    terminal_colors?: {
        normal?: Record<string, string>;
        bright?: Record<string, string>;
    };
}

function normalizeHex(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
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

function parseWarpYaml(yaml: string, name: string): ThemeSource | null {
    try {
        const config = parseYaml(yaml) as WarpTheme;
        if (!config || typeof config !== "object") return null;

        const fg = normalizeHex(config.foreground);
        const bg = normalizeHex(config.background);
        if (!fg || !bg) return null;

        const ansi = extractAnsi(config.terminal_colors?.normal, config.terminal_colors?.bright);
        if (!ansi) return null;

        const cursor = normalizeHex(config.cursor) ?? fg;
        const cursorText = bg;
        const selection = ansi.blue;
        const selectionText = fg;

        const colors: ThemeColors = {
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
            colors,
        };
    } catch {
        return null;
    }
}

async function detectWarp(): Promise<boolean> {
    const themesDir = join(homedir(), ".warp", "themes");
    try {
        await access(themesDir);
        const files = await readdir(themesDir);
        return files.some((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    } catch {
        return false;
    }
}

async function parseWarp(): Promise<ThemeSource[]> {
    const themesDir = join(homedir(), ".warp", "themes");
    try {
        const files = await readdir(themesDir);
        const results: ThemeSource[] = [];

        for (const file of files) {
            if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
            try {
                const content = await Bun.file(join(themesDir, file)).text();
                const name = file.replace(/\.(yaml|yml)$/, "");
                const theme = parseWarpYaml(content, `Warp - ${name}`);
                if (theme) results.push(theme);
            } catch {
                // Skip unreadable files
            }
        }

        return results;
    } catch {
        return [];
    }
}

export { parseWarpYaml, detectWarp, parseWarp };
