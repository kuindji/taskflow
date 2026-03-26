import * as monaco from "monaco-editor";
import type { ResolvedTheme } from "@taskflow/shared";

const THEME_NAME = "taskflow";
const RGB_RE = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)$/i;
const HEX_RE = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;

const FALLBACKS = {
    foreground: "#cdd6f4",
    background: "#1e1e2e",
    comment: "#585b70",
    keyword: "#89b4fa",
    selection: "#31324480",
    lineHighlight: "#181825",
    whitespace: "#31324440",
} as const;

// Default theme registered at module load time (Catppuccin Mocha fallback).
// This ensures "taskflow" exists before any EditorPane mounts.
monaco.editor.defineTheme(THEME_NAME, {
    base: "vs-dark",
    inherit: true,
    rules: [
        { token: "", foreground: "cdd6f4", background: "1e1e2e" },
        { token: "comment", foreground: "585b70", fontStyle: "italic" },
        { token: "keyword", foreground: "89b4fa" },
        { token: "string", foreground: "a6e3a1" },
        { token: "number", foreground: "f9e2af" },
        { token: "type", foreground: "cba6f7" },
        { token: "function", foreground: "89b4fa" },
        { token: "variable", foreground: "cdd6f4" },
        { token: "constant", foreground: "f38ba8" },
        { token: "operator", foreground: "94e2d5" },
        { token: "delimiter", foreground: "585b70" },
    ],
    colors: {
        "editor.background": "#1e1e2e",
        "editor.foreground": "#cdd6f4",
        "editor.selectionBackground": "#31324480",
        "editor.lineHighlightBackground": "#181825",
        "editorCursor.foreground": "#f5e0dc",
        "editorWhitespace.foreground": "#31324440",
        "editorIndentGuide.background": "#31324440",
        "editorLineNumber.foreground": "#585b70",
        "editorLineNumber.activeForeground": "#cdd6f4",
        "editorLink.activeForeground": "#89b4fa",
    },
});

let colorParser: HTMLDivElement | null = null;

function getColorParser(): HTMLDivElement | null {
    if (typeof document === "undefined") return null;
    if (colorParser?.isConnected) return colorParser;

    colorParser = document.createElement("div");
    colorParser.style.display = "none";
    (document.body ?? document.documentElement).appendChild(colorParser);
    return colorParser;
}

function toHexByte(value: number): string {
    return Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, "0");
}

function parseCssColor(value: string, fallback: string): [number, number, number, number] {
    const parser = getColorParser();
    if (!parser) return parseColorString(fallback) ?? [0, 0, 0, 1];

    parser.style.color = "";
    parser.style.color = value;
    if (!parser.style.color) {
        parser.style.color = fallback;
    }

    const normalized = getComputedStyle(parser).color;
    return parseColorString(normalized) ?? parseColorString(fallback) ?? [0, 0, 0, 1];
}

function parseColorString(value: string): [number, number, number, number] | null {
    const hexMatch = value.match(HEX_RE);
    if (hexMatch) {
        const hex = hexMatch[1];
        if (hex.length === 6) {
            return [
                Number.parseInt(hex.slice(0, 2), 16),
                Number.parseInt(hex.slice(2, 4), 16),
                Number.parseInt(hex.slice(4, 6), 16),
                1,
            ];
        }

        return [
            Number.parseInt(hex.slice(0, 2), 16),
            Number.parseInt(hex.slice(2, 4), 16),
            Number.parseInt(hex.slice(4, 6), 16),
            Number.parseInt(hex.slice(6, 8), 16) / 255,
        ];
    }

    const match = value.match(RGB_RE);
    if (!match) return null;

    const [, r, g, b, alpha] = match;
    return [Number(r), Number(g), Number(b), alpha === undefined ? 1 : Number(alpha)];
}

function toMonacoColor(value: string, fallback: string, alphaMultiplier = 1): string {
    const [r, g, b, alpha] = parseCssColor(value, fallback);
    const finalAlpha = Math.max(0, Math.min(1, alpha * alphaMultiplier));
    const suffix = finalAlpha < 1 ? toHexByte(finalAlpha * 255) : "";
    return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}${suffix}`;
}

function toMonacoTokenColor(value: string, fallback: string): string {
    return toMonacoColor(value, fallback).slice(1);
}

function updateMonacoTheme(resolved: ResolvedTheme): void {
    const { css, xterm } = resolved;
    const fg = toMonacoTokenColor(css["--foreground"], FALLBACKS.foreground);
    const bg = toMonacoColor(css["--background"], FALLBACKS.background);
    const comment = toMonacoTokenColor(css["--muted-foreground"], FALLBACKS.comment);
    const keyword = toMonacoTokenColor(css["--accent"], FALLBACKS.keyword);
    const string = xterm.green.replace("#", "");
    const number = xterm.yellow.replace("#", "");
    const type = xterm.magenta.replace("#", "");
    const constant = xterm.red.replace("#", "");
    const operator = xterm.cyan.replace("#", "");

    monaco.editor.defineTheme(THEME_NAME, {
        base: "vs-dark",
        inherit: true,
        rules: [
            { token: "", foreground: fg, background: bg.slice(1) },
            { token: "comment", foreground: comment, fontStyle: "italic" },
            { token: "keyword", foreground: keyword },
            { token: "string", foreground: string },
            { token: "number", foreground: number },
            { token: "type", foreground: type },
            { token: "function", foreground: keyword },
            { token: "variable", foreground: fg },
            { token: "constant", foreground: constant },
            { token: "operator", foreground: operator },
            { token: "delimiter", foreground: comment },
        ],
        colors: {
            "editor.background": bg,
            "editor.foreground": toMonacoColor(css["--foreground"], FALLBACKS.foreground),
            "editor.selectionBackground": toMonacoColor(
                css["--secondary"],
                FALLBACKS.selection,
                0.5,
            ),
            "editor.lineHighlightBackground": toMonacoColor(css["--card"], FALLBACKS.lineHighlight),
            "editorCursor.foreground": resolved.xterm.cursor,
            "editorWhitespace.foreground": toMonacoColor(
                css["--secondary"],
                FALLBACKS.whitespace,
                0.25,
            ),
            "editorIndentGuide.background": toMonacoColor(
                css["--secondary"],
                FALLBACKS.whitespace,
                0.25,
            ),
            "editorLineNumber.foreground": toMonacoColor(
                css["--muted-foreground"],
                FALLBACKS.comment,
            ),
            "editorLineNumber.activeForeground": toMonacoColor(
                css["--foreground"],
                FALLBACKS.foreground,
            ),
            "editorLink.activeForeground": toMonacoColor(
                css["--accent"],
                FALLBACKS.keyword,
            ),
        },
    });

    monaco.editor.setTheme(THEME_NAME);
}

export { updateMonacoTheme, THEME_NAME as MONACO_THEME_NAME };
