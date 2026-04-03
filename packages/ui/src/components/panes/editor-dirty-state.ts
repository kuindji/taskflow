import type * as monaco from "monaco-editor";

/** Tracks which editor models have unsaved edits so state survives unmount/remount */
const dirtyModels = new Map<string, boolean>();

/** Tracks editor view state (scroll position, cursor, selections) across unmount/remount */
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState>();

function isEditorDirty(filePath: string): boolean {
    return dirtyModels.get(filePath) ?? false;
}

function clearEditorDirty(filePath: string): void {
    dirtyModels.delete(filePath);
}

/**
 * Tracks pending "go to line" requests for editor panes.
 * Used when opening a file at a specific line — the line is stored here
 * and consumed by EditorPaneImpl after the file loads.
 */
const pendingLines = new Map<string, number>();

function setPendingLine(filePath: string, line: number): void {
    pendingLines.set(filePath, line);
}

function consumePendingLine(filePath: string): number | undefined {
    const line = pendingLines.get(filePath);
    if (line !== undefined) pendingLines.delete(filePath);
    return line;
}

export { dirtyModels, isEditorDirty, clearEditorDirty, viewStates, pendingLines, setPendingLine, consumePendingLine };
