import type { EditorInfo } from "@taskflow/shared";

const KNOWN_EDITORS: EditorInfo[] = [
    { id: "vscode", name: "VS Code", command: "code" },
    { id: "cursor", name: "Cursor", command: "cursor" },
    { id: "zed", name: "Zed", command: "zed" },
    { id: "sublime", name: "Sublime Text", command: "subl" },
    { id: "nvim", name: "Neovim", command: "nvim" },
];

export async function detectEditors(): Promise<EditorInfo[]> {
    const available: EditorInfo[] = [];
    for (const editor of KNOWN_EDITORS) {
        try {
            const proc = Bun.spawn(["which", editor.command], {
                stdout: "pipe",
                stderr: "pipe",
            });
            const exitCode = await proc.exited;
            if (exitCode === 0) available.push(editor);
        } catch {
            /* not found */
        }
    }
    return available;
}
