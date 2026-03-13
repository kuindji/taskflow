import { access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { ThemeSource, ThemeColors, AnsiColors } from "@taskflow/shared";

function componentToHex(component: number): string {
    const clamped = Math.max(0, Math.min(1, component));
    const int = Math.round(clamped * 255);
    return int.toString(16).padStart(2, "0");
}

function extractColor(dict: Record<string, unknown>): string | null {
    const r = dict["Red Component"];
    const g = dict["Green Component"];
    const b = dict["Blue Component"];

    if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") {
        return null;
    }

    return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

interface PlistDict {
    [key: string]: unknown;
}

function parsePlistXml(xml: string): PlistDict {
    // Simple XML plist parser for iTerm2 color profiles.
    // Extracts <dict> entries with key/real pairs.
    const result: PlistDict = {};
    let rootAssigned = false;
    const dictStack: PlistDict[] = [];
    const keyStack: string[] = [];
    let currentKey: string | null = null;

    const tagRe = /<\/?(\w+)[^>]*>|([^<]+)/g;
    let match: RegExpExecArray | null;

    while ((match = tagRe.exec(xml)) !== null) {
        if (match[2] !== undefined) {
            const text = match[2].trim();
            if (text && currentKey !== null) {
                const currentDict = dictStack[dictStack.length - 1];
                const num = parseFloat(text);
                currentDict[currentKey] = isNaN(num) ? text : num;
                currentKey = null;
            }
            continue;
        }

        const isClosing = match[0].startsWith("</");
        const tagName = match[1];

        if (isClosing) {
            if (tagName === "dict") {
                dictStack.pop();
                currentKey = keyStack.pop() ?? null;
            }
        } else {
            if (tagName === "key") {
                const keyMatch = /<key>([^<]*)<\/key>/.exec(xml.slice(match.index));
                if (keyMatch) {
                    currentKey = keyMatch[1];
                    tagRe.lastIndex = match.index + keyMatch[0].length;
                }
            } else if (tagName === "dict") {
                if (!rootAssigned) {
                    // First <dict> is the root — use `result` directly
                    rootAssigned = true;
                    dictStack.push(result);
                } else if (currentKey !== null) {
                    const newDict: PlistDict = {};
                    const parentDict = dictStack[dictStack.length - 1];
                    parentDict[currentKey] = newDict;
                    keyStack.push(currentKey);
                    currentKey = null;
                    dictStack.push(newDict);
                }
            } else if (tagName === "real") {
                const realMatch = /<real>([^<]*)<\/real>/.exec(xml.slice(match.index));
                if (realMatch && currentKey !== null) {
                    const currentDict = dictStack[dictStack.length - 1];
                    currentDict[currentKey] = parseFloat(realMatch[1]);
                    currentKey = null;
                    tagRe.lastIndex = match.index + realMatch[0].length;
                }
            } else if (tagName === "integer") {
                const intMatch = /<integer>([^<]*)<\/integer>/.exec(xml.slice(match.index));
                if (intMatch && currentKey !== null) {
                    const currentDict = dictStack[dictStack.length - 1];
                    currentDict[currentKey] = parseInt(intMatch[1], 10);
                    currentKey = null;
                    tagRe.lastIndex = match.index + intMatch[0].length;
                }
            } else if (tagName === "string") {
                const strMatch = /<string>([^<]*)<\/string>/.exec(xml.slice(match.index));
                if (strMatch && currentKey !== null) {
                    const currentDict = dictStack[dictStack.length - 1];
                    currentDict[currentKey] = strMatch[1];
                    currentKey = null;
                    tagRe.lastIndex = match.index + strMatch[0].length;
                }
            }
        }
    }

    return result;
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

function parseIterm2Xml(xml: string, name: string): ThemeSource | null {
    try {
        const dict = parsePlistXml(xml);

        const fgDict = dict["Foreground Color"];
        const bgDict = dict["Background Color"];
        if (!fgDict || typeof fgDict !== "object" || !bgDict || typeof bgDict !== "object") return null;

        const fg = extractColor(fgDict as Record<string, unknown>);
        const bg = extractColor(bgDict as Record<string, unknown>);
        if (!fg || !bg) return null;

        const ansi: Partial<AnsiColors> = {};
        for (const [plistKey, ansiKey] of ANSI_COLOR_KEYS) {
            const colorDict = dict[plistKey];
            if (!colorDict || typeof colorDict !== "object") return null;
            const hex = extractColor(colorDict as Record<string, unknown>);
            if (!hex) return null;
            ansi[ansiKey] = hex;
        }

        const cursorDict = dict["Cursor Color"];
        const cursorTextDict = dict["Cursor Text Color"];
        const selectionDict = dict["Selection Color"];
        const selectedTextDict = dict["Selected Text Color"];

        const cursor = (cursorDict && typeof cursorDict === "object" ? extractColor(cursorDict as Record<string, unknown>) : null) ?? fg;
        const cursorText = (cursorTextDict && typeof cursorTextDict === "object" ? extractColor(cursorTextDict as Record<string, unknown>) : null) ?? bg;
        const selection = (selectionDict && typeof selectionDict === "object" ? extractColor(selectionDict as Record<string, unknown>) : null) ?? (ansi as AnsiColors).blue;
        const selectionText = (selectedTextDict && typeof selectedTextDict === "object" ? extractColor(selectedTextDict as Record<string, unknown>) : null) ?? fg;

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
    } catch {
        return null;
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

async function parseIterm2(): Promise<ThemeSource[]> {
    const plistPath = join(homedir(), "Library", "Preferences", "com.googlecode.iterm2.plist");
    try {
        const xml = await plutilConvert(plistPath);
        const theme = parseIterm2Xml(xml, "iTerm2");
        return theme ? [theme] : [];
    } catch {
        return [];
    }
}

export { parseIterm2Xml, detectIterm2, parseIterm2 };
