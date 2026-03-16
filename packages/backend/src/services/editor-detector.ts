import type { EditorInfo } from "@taskflow/shared";
import { buildShellPath } from "./shell-path";

const INTERNAL_EDITORS: EditorInfo[] = [
    { id: "nvim", name: "Neovim", command: "nvim", type: "internal", lineFlag: "+{line}" },
    { id: "vim", name: "Vim", command: "vim", type: "internal", lineFlag: "+{line}" },
    { id: "nano", name: "Nano", command: "nano", type: "internal", lineFlag: "+{line}" },
    { id: "helix", name: "Helix", command: "hx", type: "internal", lineFlag: "{file}:{line}" },
    { id: "micro", name: "Micro", command: "micro", type: "internal", lineFlag: "+{line}" },
    {
        id: "emacs",
        name: "Emacs",
        command: "emacs",
        type: "internal",
        lineFlag: "+{line}",
        extraArgs: ["-nw"],
    },
];

const EXTERNAL_EDITORS: EditorInfo[] = [
    { id: "vscode", name: "VS Code", command: "code", type: "external" },
    { id: "cursor", name: "Cursor", command: "cursor", type: "external" },
    { id: "zed", name: "Zed", command: "zed", type: "external" },
    { id: "sublime", name: "Sublime Text", command: "subl", type: "external" },
    { id: "windsurf", name: "Windsurf", command: "windsurf", type: "external" },
    { id: "webstorm", name: "WebStorm", command: "webstorm", type: "external" },
    { id: "idea", name: "IntelliJ IDEA", command: "idea", type: "external" },
];

const ALL_KNOWN_EDITORS = [...INTERNAL_EDITORS, ...EXTERNAL_EDITORS];

export async function detectEditors(): Promise<EditorInfo[]> {
    const available: EditorInfo[] = [];
    const PATH = buildShellPath();
    for (const editor of ALL_KNOWN_EDITORS) {
        const path = Bun.which(editor.command, { PATH });
        if (path) available.push(editor);
    }
    return available;
}

export function getEditorById(editors: EditorInfo[], id: string): EditorInfo | undefined {
    return editors.find((e) => e.id === id);
}
