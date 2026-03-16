import { readdir, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { ThemeSource, ThemeColors, AnsiColors } from "@taskflow/shared";
import { isPlistDict, parsePlistXml, type PlistDict, type PlistValue } from "./plist";

// Terminal.app stores colors as NSKeyedArchiver data blobs in plist files.
// These are complex binary-encoded NSColor objects that cannot be reliably
// decoded without Objective-C bridging. This is a best-effort parser that
// returns an empty array on failure rather than crashing.

function componentToHex(component: number): string {
    const clamped = Math.max(0, Math.min(1, component));
    const int = Math.round(clamped * 255);
    return int.toString(16).padStart(2, "0");
}

function normalizeHex(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    const match = /^#?([0-9a-fA-F]{6})$/.exec(trimmed);
    if (!match) return null;
    return `#${match[1].toLowerCase()}`;
}

function extractRgbHex(dict: PlistDict): string | null {
    const r = dict["Red Component"];
    const g = dict["Green Component"];
    const b = dict["Blue Component"];

    if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") {
        return null;
    }

    return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

function extractColor(value: PlistValue): string | null {
    if (typeof value === "string") {
        return normalizeHex(value);
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            const color = extractColor(item);
            if (color) return color;
        }
        return null;
    }

    if (!isPlistDict(value)) {
        return null;
    }

    const direct = extractRgbHex(value);
    if (direct) return direct;

    for (const child of Object.values(value)) {
        const color = extractColor(child);
        if (color) return color;
    }

    return null;
}

const ANSI_KEY_VARIANTS: Record<keyof AnsiColors, string[]> = {
    black: ["ANSIBlackColor", "ANSI Black Color"],
    red: ["ANSIRedColor", "ANSI Red Color"],
    green: ["ANSIGreenColor", "ANSI Green Color"],
    yellow: ["ANSIYellowColor", "ANSI Yellow Color"],
    blue: ["ANSIBlueColor", "ANSI Blue Color"],
    magenta: ["ANSIMagentaColor", "ANSI Magenta Color"],
    cyan: ["ANSICyanColor", "ANSI Cyan Color"],
    white: ["ANSIWhiteColor", "ANSI White Color"],
    brightBlack: ["ANSIBrightBlackColor", "ANSI Bright Black Color"],
    brightRed: ["ANSIBrightRedColor", "ANSI Bright Red Color"],
    brightGreen: ["ANSIBrightGreenColor", "ANSI Bright Green Color"],
    brightYellow: ["ANSIBrightYellowColor", "ANSI Bright Yellow Color"],
    brightBlue: ["ANSIBrightBlueColor", "ANSI Bright Blue Color"],
    brightMagenta: ["ANSIBrightMagentaColor", "ANSI Bright Magenta Color"],
    brightCyan: ["ANSIBrightCyanColor", "ANSI Bright Cyan Color"],
    brightWhite: ["ANSIBrightWhiteColor", "ANSI Bright White Color"],
};

function colorForKeys(dict: PlistDict, keys: string[]): string | null {
    for (const key of keys) {
        const color = extractColor(dict[key] ?? null);
        if (color) return color;
    }
    return null;
}

function parseTerminalAppXml(xml: string, fallbackName: string): ThemeSource | null {
    const parsed = parsePlistXml(xml);
    if (!isPlistDict(parsed)) return null;

    const fg = colorForKeys(parsed, ["TextColor", "ForegroundColor", "Foreground Color"]);
    const bg = colorForKeys(parsed, ["BackgroundColor", "Background Color"]);
    if (!fg || !bg) return null;

    const ansi: Partial<AnsiColors> = {};
    for (const [ansiKey, variants] of Object.entries(ANSI_KEY_VARIANTS) as Array<
        [keyof AnsiColors, string[]]
    >) {
        const color = colorForKeys(parsed, variants);
        if (color) {
            ansi[ansiKey] = color;
        }
    }

    const resolvedAnsi: AnsiColors = {
        black: ansi.black ?? bg,
        red: ansi.red ?? fg,
        green: ansi.green ?? fg,
        yellow: ansi.yellow ?? fg,
        blue: ansi.blue ?? fg,
        magenta: ansi.magenta ?? fg,
        cyan: ansi.cyan ?? fg,
        white: ansi.white ?? fg,
        brightBlack: ansi.brightBlack ?? ansi.black ?? bg,
        brightRed: ansi.brightRed ?? ansi.red ?? fg,
        brightGreen: ansi.brightGreen ?? ansi.green ?? fg,
        brightYellow: ansi.brightYellow ?? ansi.yellow ?? fg,
        brightBlue: ansi.brightBlue ?? ansi.blue ?? fg,
        brightMagenta: ansi.brightMagenta ?? ansi.magenta ?? fg,
        brightCyan: ansi.brightCyan ?? ansi.cyan ?? fg,
        brightWhite: ansi.brightWhite ?? ansi.white ?? fg,
    };

    const colors: ThemeColors = {
        foreground: fg,
        background: bg,
        cursor: colorForKeys(parsed, ["CursorColor", "Cursor Color"]) ?? fg,
        cursorText: bg,
        selection: colorForKeys(parsed, ["SelectionColor", "Selection Color"]) ?? resolvedAnsi.blue,
        selectionText: fg,
        ansi: resolvedAnsi,
    };

    const name =
        (typeof parsed.name === "string" && parsed.name.trim()) ||
        (typeof parsed.ProfileName === "string" && parsed.ProfileName.trim()) ||
        fallbackName;

    return {
        version: 1,
        name,
        origin: "imported",
        colors,
    };
}

async function detectTerminalApp(): Promise<boolean> {
    // Terminal.app profiles are stored in macOS preferences.
    // .terminal files may be exported to Desktop or Downloads.
    const searchPaths = [
        join(homedir(), "Library", "Preferences"),
        join(homedir(), "Desktop"),
        join(homedir(), "Downloads"),
        join(homedir(), "Documents"),
    ];

    for (const dir of searchPaths) {
        try {
            await access(dir);
            const files = await readdir(dir);
            if (files.some((f) => f.endsWith(".terminal"))) {
                return true;
            }
        } catch {
            // Directory doesn't exist or not readable
        }
    }

    return false;
}

async function parseTerminalApp(): Promise<ThemeSource[]> {
    const searchPaths = [
        join(homedir(), "Library", "Preferences"),
        join(homedir(), "Desktop"),
        join(homedir(), "Downloads"),
        join(homedir(), "Documents"),
    ];
    const themes: ThemeSource[] = [];

    for (const dir of searchPaths) {
        try {
            const files = await readdir(dir);
            for (const file of files) {
                if (!file.endsWith(".terminal")) continue;

                try {
                    const content = await Bun.file(join(dir, file)).text();
                    const name = file.replace(/\.terminal$/, "");
                    const theme = parseTerminalAppXml(content, name);
                    if (theme) {
                        themes.push(theme);
                    }
                } catch {
                    // Skip unreadable or unsupported files.
                }
            }
        } catch {
            // Directory doesn't exist or is not readable.
        }
    }

    return themes;
}

export { parseTerminalAppXml, detectTerminalApp, parseTerminalApp };
