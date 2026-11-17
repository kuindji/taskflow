import { dirname } from "path";

// Since Electron 43, open dialogs start in Downloads when no defaultPath is given,
// instead of where the user last picked. This keeps that location per dialog.
export function createLastPathTracker(): {
    defaultPath(): string | undefined;
    remember(selectedPath: string, kind: "file" | "directory"): void;
} {
    let lastPath: string | undefined;
    return {
        defaultPath: () => lastPath,
        remember(selectedPath, kind) {
            lastPath = kind === "file" ? dirname(selectedPath) : selectedPath;
        },
    };
}
