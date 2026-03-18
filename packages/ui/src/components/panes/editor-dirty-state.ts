/** Tracks which editor models have unsaved edits so state survives unmount/remount */
const dirtyModels = new Map<string, boolean>();

function isEditorDirty(filePath: string): boolean {
    return dirtyModels.get(filePath) ?? false;
}

function clearEditorDirty(filePath: string): void {
    dirtyModels.delete(filePath);
}

export { dirtyModels, isEditorDirty, clearEditorDirty };
