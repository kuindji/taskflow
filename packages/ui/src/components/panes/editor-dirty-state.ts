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

export { dirtyModels, isEditorDirty, clearEditorDirty, viewStates };
