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

function parseGhosttyConfig(content: string, name: string): ThemeSource | null {
    const lines = content.split("\n");
    const values: Record<string, string> = {};
    const palette: Record<number, string> = {};

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#") || !trimmed) continue;

        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;

        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();

        if (key === "palette") {
            const paletteMatch = /^(\d+)=(.+)$/.exec(value);
            if (paletteMatch) {
                const idx = parseInt(paletteMatch[1], 10);
                const hex = normalizeHex(paletteMatch[2]);
                if (hex && idx >= 0 && idx <= 15) {
                    palette[idx] = hex;
                }
            }
        } else {
            values[key] = value;
        }
    }

    // Need at least background and foreground
    const fg = normalizeHex(values["foreground"] ?? "");
    const bg = normalizeHex(values["background"] ?? "");
    if (!fg || !bg) return null;

    // Need all 16 ANSI colors
    for (let i = 0; i < 16; i++) {
        if (!palette[i]) return null;
    }

    const ansi: AnsiColors = {
        black: palette[0],
        red: palette[1],
        green: palette[2],
        yellow: palette[3],
        blue: palette[4],
        magenta: palette[5],
        cyan: palette[6],
        white: palette[7],
        brightBlack: palette[8],
        brightRed: palette[9],
        brightGreen: palette[10],
        brightYellow: palette[11],
        brightBlue: palette[12],
        brightMagenta: palette[13],
        brightCyan: palette[14],
        brightWhite: palette[15],
    };

    const cursor = normalizeHex(values["cursor-color"] ?? "") ?? fg;
    const cursorText = normalizeHex(values["cursor-text"] ?? "") ?? bg;
    const selection = normalizeHex(values["selection-background"] ?? "") ?? ansi.blue;
    const selectionText = normalizeHex(values["selection-foreground"] ?? "") ?? fg;

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
}

async function detectGhostty(): Promise<boolean> {
    try {
        await access(join(homedir(), ".config", "ghostty", "config"));
        return true;
    } catch {
        return false;
    }
}

async function parseGhostty(): Promise<ThemeSource[]> {
    const configPath = join(homedir(), ".config", "ghostty", "config");
    try {
        const content = await Bun.file(configPath).text();
        const theme = parseGhosttyConfig(content, "Ghostty");
        return theme ? [theme] : [];
    } catch {
        return [];
    }
}

export { parseGhosttyConfig, detectGhostty, parseGhostty };
