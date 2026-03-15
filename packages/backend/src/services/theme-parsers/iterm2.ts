import { access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { ThemeSource, ThemeColors, AnsiColors } from "@taskflow/shared";
import { isPlistDict, parsePlistXml, type PlistDict, type PlistValue } from "./plist";

function componentToHex(component: number): string {
    const clamped = Math.max(0, Math.min(1, component));
    const int = Math.round(clamped * 255);
    return int.toString(16).padStart(2, "0");
}

function extractColor(dict: PlistDict): string | null {
    const r = dict["Red Component"];
    const g = dict["Green Component"];
    const b = dict["Blue Component"];

    if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") {
        return null;
    }

    return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

const ANSI_COLOR_KEYS: Array<[string, keyof AnsiColors]> = [
    ["Ansi 0 Color", "black"],
    ["Ansi 1 Color", "red"],
    ["Ansi 2 Color", "green"],
    ["Ansi 3 Color", "yellow"],
    ["Ansi 4 Color", "blue"],
    ["Ansi 5 Color", "magenta"],
    ["Ansi 6 Color", "cyan"],
    ["Ansi 7 Color", "white"],
    ["Ansi 8 Color", "brightBlack"],
    ["Ansi 9 Color", "brightRed"],
    ["Ansi 10 Color", "brightGreen"],
    ["Ansi 11 Color", "brightYellow"],
    ["Ansi 12 Color", "brightBlue"],
    ["Ansi 13 Color", "brightMagenta"],
    ["Ansi 14 Color", "brightCyan"],
    ["Ansi 15 Color", "brightWhite"],
];

function extractNamedColor(dict: PlistDict, key: string): string | null {
    const value = dict[key];
    return isPlistDict(value) ? extractColor(value) : null;
}

function parseThemeDict(dict: PlistDict, fallbackName: string): ThemeSource | null {
    const fg = extractNamedColor(dict, "Foreground Color");
    const bg = extractNamedColor(dict, "Background Color");
    if (!fg || !bg) return null;

    const ansi: Partial<AnsiColors> = {};
    for (const [plistKey, ansiKey] of ANSI_COLOR_KEYS) {
        const hex = extractNamedColor(dict, plistKey);
        if (!hex) return null;
        ansi[ansiKey] = hex;
    }

    const cursor = extractNamedColor(dict, "Cursor Color") ?? fg;
    const cursorText = extractNamedColor(dict, "Cursor Text Color") ?? bg;
    const selection = extractNamedColor(dict, "Selection Color") ?? (ansi as AnsiColors).blue;
    const selectionText = extractNamedColor(dict, "Selected Text Color") ?? fg;
    const name =
        typeof dict["Name"] === "string" && dict["Name"].trim()
            ? dict["Name"].trim()
            : fallbackName;

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

function collectThemeDictionaries(value: PlistValue, output: PlistDict[] = []): PlistDict[] {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectThemeDictionaries(item, output);
        }
        return output;
    }

    if (!isPlistDict(value)) {
        return output;
    }

    if ("Foreground Color" in value && "Background Color" in value) {
        output.push(value);
    }

    for (const child of Object.values(value)) {
        collectThemeDictionaries(child, output);
    }

    return output;
}

function parseIterm2ThemesXml(xml: string, fallbackName: string = "iTerm2"): ThemeSource[] {
    const parsed = parsePlistXml(xml);
    if (!parsed) return [];

    const candidates = collectThemeDictionaries(parsed);
    return candidates
        .map((candidate, index) => {
            const themeName =
                typeof candidate["Name"] === "string" && candidate["Name"].trim()
                    ? candidate["Name"].trim()
                    : candidates.length === 1
                      ? fallbackName
                      : `${fallbackName} ${index + 1}`;
            return parseThemeDict(candidate, themeName);
        })
        .filter((theme): theme is ThemeSource => theme !== null);
}

function parseIterm2Xml(xml: string, name: string): ThemeSource | null {
    const [theme] = parseIterm2ThemesXml(xml, name);
    return theme ?? null;
}

async function parseIterm2(): Promise<ThemeSource[]> {
    const plistPath = join(homedir(), "Library", "Preferences", "com.googlecode.iterm2.plist");
    try {
        const xml = await plutilConvert(plistPath);
        return parseIterm2ThemesXml(xml, "iTerm2");
    } catch {
        return [];
    }
}

async function plutilConvert(path: string): Promise<string> {
    const proc = Bun.spawn(["plutil", "-convert", "xml1", "-o", "-", path], {
        stdout: "pipe",
        stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
        throw new Error(`plutil exited with code ${exitCode}`);
    }
    return stdout;
}

async function detectIterm2(): Promise<boolean> {
    try {
        await access(join(homedir(), "Library", "Preferences", "com.googlecode.iterm2.plist"));
        return true;
    } catch {
        return false;
    }
}

export { parseIterm2Xml, parseIterm2ThemesXml, detectIterm2, parseIterm2 };
