import * as monaco from "monaco-editor";
import type { ResolvedTheme } from "@taskflow/shared";

const THEME_NAME = "taskflow";

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
    },
});

function updateMonacoTheme(resolved: ResolvedTheme): void {
    const { css, xterm } = resolved;
    const fg = css["--foreground"].replace("#", "");
    const bg = css["--background"];
    const comment = css["--muted-foreground"].replace("#", "");
    const keyword = css["--accent"].replace("#", "");
    const string = xterm.green.replace("#", "");
    const number = xterm.yellow.replace("#", "");
    const type = xterm.magenta.replace("#", "");
    const constant = xterm.red.replace("#", "");
    const operator = xterm.cyan.replace("#", "");

    monaco.editor.defineTheme(THEME_NAME, {
        base: "vs-dark",
        inherit: true,
        rules: [
            { token: "", foreground: fg, background: bg.replace("#", "") },
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
            "editor.foreground": css["--foreground"],
            "editor.selectionBackground": css["--secondary"] + "80",
            "editor.lineHighlightBackground": css["--card"],
            "editorCursor.foreground": resolved.xterm.cursor,
            "editorWhitespace.foreground": css["--secondary"] + "40",
            "editorIndentGuide.background": css["--secondary"] + "40",
            "editorLineNumber.foreground": css["--muted-foreground"],
            "editorLineNumber.activeForeground": css["--foreground"],
        },
    });

    monaco.editor.setTheme(THEME_NAME);
}

export { updateMonacoTheme, THEME_NAME as MONACO_THEME_NAME };
