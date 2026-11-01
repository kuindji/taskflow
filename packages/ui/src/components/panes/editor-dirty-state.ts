import type * as monaco from "monaco-editor";
import { registerBackendReset } from "@/stores/store-reset";

/**
 * Per machine, then per absolute path: two machines very often hold the same
 * repository at the same path, and their buffers must never share state. Nested
 * rather than string-keyed so a reset cannot match another machine's keys, and
 * so this module (reached from the main bundle through open-file and the
 * workspace pane) needs no runtime monaco import.
 *
 * The models themselves are disposed by the "editor-models" reset in editor-uri.
 */
type PerMachine<T> = Map<string, Map<string, T>>;

/** Tracks which editor models have unsaved edits so state survives unmount/remount */
const dirtyModels: PerMachine<boolean> = new Map();

/** Tracks editor view state (scroll position, cursor, selections) across unmount/remount */
const viewStates: PerMachine<monaco.editor.ICodeEditorViewState> = new Map();

/**
 * Tracks pending "go to line" requests for editor panes.
 * Used when opening a file at a specific line — the line is stored here
 * and consumed by EditorPaneImpl after the file loads.
 */
const pendingLines: PerMachine<number> = new Map();

registerBackendReset("editor-dirty-state", (backendId) => {
    dirtyModels.delete(backendId);
    viewStates.delete(backendId);
    pendingLines.delete(backendId);
});

function machineMap<T>(maps: PerMachine<T>, backendId: string): Map<string, T> {
    let map = maps.get(backendId);
    if (!map) {
        map = new Map();
        maps.set(backendId, map);
    }
    return map;
}

function isEditorDirty(backendId: string, filePath: string): boolean {
    return dirtyModels.get(backendId)?.get(filePath) ?? false;
}

function setEditorDirty(backendId: string, filePath: string, dirty: boolean): void {
    machineMap(dirtyModels, backendId).set(filePath, dirty);
}

function clearEditorDirty(backendId: string, filePath: string): void {
    dirtyModels.get(backendId)?.delete(filePath);
}

/** Paths with unsaved edits on every machine except `keepBackendId`, which a hard switch keeps. */
function dirtyFilePaths(keepBackendId: string): string[] {
    const paths = new Set<string>();
    for (const backendId of dirtyModels.keys()) {
        if (backendId === keepBackendId) continue;
        for (const filePath of dirtyFilePathsOn(backendId)) paths.add(filePath);
    }
    return [...paths];
}

/** Paths with unsaved edits on `backendId`, whose models a detach disposes. */
function dirtyFilePathsOn(backendId: string): string[] {
    const models = dirtyModels.get(backendId);
    if (!models) return [];
    return [...models].filter(([, dirty]) => dirty).map(([filePath]) => filePath);
}

function getViewState(
    backendId: string,
    filePath: string,
): monaco.editor.ICodeEditorViewState | undefined {
    return viewStates.get(backendId)?.get(filePath);
}

function saveViewState(
    backendId: string,
    filePath: string,
    state: monaco.editor.ICodeEditorViewState,
): void {
    machineMap(viewStates, backendId).set(filePath, state);
}

function setPendingLine(backendId: string, filePath: string, line: number): void {
    machineMap(pendingLines, backendId).set(filePath, line);
}

function consumePendingLine(backendId: string, filePath: string): number | undefined {
    const lines = pendingLines.get(backendId);
    const line = lines?.get(filePath);
    if (line !== undefined) lines?.delete(filePath);
    return line;
}

export {
    isEditorDirty,
    setEditorDirty,
    clearEditorDirty,
    dirtyFilePaths,
    dirtyFilePathsOn,
    getViewState,
    saveViewState,
    setPendingLine,
    consumePendingLine,
};
