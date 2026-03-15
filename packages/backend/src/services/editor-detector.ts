import type { EditorInfo } from "@taskflow/shared";
import { buildShellPath } from "./shell-path";

const KNOWN_EDITORS: EditorInfo[] = [
    { id: "vscode", name: "VS Code", command: "code" },
    { id: "cursor", name: "Cursor", command: "cursor" },
    { id: "zed", name: "Zed", command: "zed" },
    { id: "sublime", name: "Sublime Text", command: "subl" },
    { id: "nvim", name: "Neovim", command: "nvim" },
];

export async function detectEditors(): Promise<EditorInfo[]> {
    const available: EditorInfo[] = [];
    const PATH = buildShellPath();
    for (const editor of KNOWN_EDITORS) {
        const path = Bun.which(editor.command, { PATH });
        if (path) available.push(editor);
    }
    return available;
}
