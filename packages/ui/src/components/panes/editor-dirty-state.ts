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
 * The hash of the disk text each model last matched: what it loaded, saved or
 * reloaded. Kept with the model rather than a pane, since models outlive
 * their pane and split panes share one. A save names it as `expected`, and a
 * change event re-reads against it.
 */
const diskBaselines: PerMachine<string> = new Map();

/** Why a model's buffer and its disk disagree, when only the user can say which wins. */
type DiskNotice =
    /** The file changed under unsaved edits; `hash` names the disk text the bar is about. */
    | { kind: "changed"; hash: string }
    /** A save was refused because the file had changed since it was loaded. */
    | { kind: "conflict" };

/** Per model, like the baseline, so split panes show one bar and resolving it in one clears it in all. */
const diskNotices: PerMachine<DiskNotice> = new Map();
const diskNoticeListeners = new Set<() => void>();

function notifyDiskNotices(): void {
    for (const listener of diskNoticeListeners) listener();
}

/**
 * Tracks pending "go to line" requests for editor panes.
 * Used when opening a file at a specific line — the line is stored here
 * and consumed by EditorPaneImpl after the file loads.
 */
const pendingLines: PerMachine<number> = new Map();

registerBackendReset("editor-dirty-state", (backendId) => {
    dirtyModels.delete(backendId);
    diskBaselines.delete(backendId);
    if (diskNotices.delete(backendId)) notifyDiskNotices();
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

function getDiskBaseline(backendId: string, filePath: string): string | undefined {
    return diskBaselines.get(backendId)?.get(filePath);
}

function setDiskBaseline(backendId: string, filePath: string, hash: string): void {
    machineMap(diskBaselines, backendId).set(filePath, hash);
}

function getDiskNotice(backendId: string, filePath: string): DiskNotice | null {
    return diskNotices.get(backendId)?.get(filePath) ?? null;
}

function setDiskNotice(backendId: string, filePath: string, notice: DiskNotice | null): void {
    if (getDiskNotice(backendId, filePath) === notice) return;
    if (notice) machineMap(diskNotices, backendId).set(filePath, notice);
    else diskNotices.get(backendId)?.delete(filePath);
    notifyDiskNotices();
}

function subscribeDiskNotices(listener: () => void): () => void {
    diskNoticeListeners.add(listener);
    return () => diskNoticeListeners.delete(listener);
}

/** For a model being disposed: what it knew of the disk goes with it. */
function clearDiskState(backendId: string, filePath: string): void {
    diskBaselines.get(backendId)?.delete(filePath);
    setDiskNotice(backendId, filePath, null);
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
    getDiskBaseline,
    setDiskBaseline,
    getDiskNotice,
    setDiskNotice,
    subscribeDiskNotices,
    clearDiskState,
    dirtyFilePaths,
    dirtyFilePathsOn,
    getViewState,
    saveViewState,
    setPendingLine,
    consumePendingLine,
};
