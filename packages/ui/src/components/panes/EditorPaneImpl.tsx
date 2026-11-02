import { useCallback, useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import {
    DEFAULT_EDITOR_FONT_FAMILY,
    DEFAULT_EDITOR_FONT_SIZE,
    DEFAULT_EDITOR_WORD_WRAP,
    MSG,
} from "@taskflow/shared";
import type { FileChangeEvent, FileDiskText } from "@taskflow/shared";
import { useFileStore } from "@/stores/file-store";
import { useSettingsStore } from "@/stores/settings-store";
import { MONACO_THEME_NAME } from "@/lib/monaco-theme";
import { Button } from "@/components/ui/button";
import { syncCompilerOptions, registerImportNavigation } from "@/lib/monaco-import-navigation";
import { openFileInApp } from "@/lib/open-file";
import { onEvent } from "@/lib/connection-registry";
import { fileChangeCovers } from "@/lib/file-change";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";
import { useProjectStore } from "@/stores/project-store";
import { useWorkspaceBackend } from "@/hooks/useWorkspaceBackend";
import { useWorkspaceFileWatch } from "@/hooks/useWorkspaceFileWatch";
import {
    getTaskWorkspaceKey,
    getProjectWorkspaceKey,
    MASTER_WORKSPACE_KEY,
    workspaceBackendId,
} from "@/hooks/useActiveWorkspace";

interface EditorPaneImplProps {
    filePath: string;
}

import { getLanguage } from "@/lib/editor-language";

import {
    isEditorDirty,
    setEditorDirty,
    clearEditorDirty,
    getDiskBaseline,
    setDiskBaseline,
    clearDiskBaseline,
    getViewState,
    saveViewState,
    consumePendingLine,
} from "./editor-dirty-state";
import { createEditorPreviewAccess } from "./editor-preview-access";
import { modelUriFor } from "./editor-uri";
import { isDiskSync, queueSave, replaceFromDisk } from "./editor-disk-sync";

/** Why the buffer and the disk disagree, when only the user can say which wins. */
type DiskNotice =
    /** The file changed under unsaved edits; `hash` names the disk text the bar is about. */
    | { kind: "changed"; hash: string }
    /** A save was refused because the file had changed since it was loaded. */
    | { kind: "conflict" };

const jsxCompilerOptions: monaco.languages.typescript.CompilerOptions = {
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    allowJs: true,
    allowNonTsExtensions: true,
    esModuleInterop: true,
};

monaco.languages.typescript.typescriptDefaults.setCompilerOptions(jsxCompilerOptions);
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSuggestionDiagnostics: true,
});
monaco.languages.typescript.javascriptDefaults.setCompilerOptions(jsxCompilerOptions);
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSuggestionDiagnostics: true,
});

// Register Cmd+click import navigation.
// The provider is registered once globally; the openFile callback reads
// current workspace context at call time via store.getState().
registerImportNavigation((backendId: string, filePath: string) => {
    const { masterWorkspaceActive, activeProjectId } = useUIStore.getState();
    const { activeTaskId } = useTaskStore.getState();
    const { projects } = useProjectStore.getState();

    let workspaceKey: string | null = null;
    if (masterWorkspaceActive) {
        workspaceKey = MASTER_WORKSPACE_KEY;
    } else if (activeTaskId) {
        workspaceKey = getTaskWorkspaceKey(activeTaskId);
    } else if (activeProjectId) {
        const project = projects.find((p) => p.id === activeProjectId);
        if (project) workspaceKey = getProjectWorkspaceKey(activeProjectId);
    }

    if (!workspaceKey) return;
    // A definition never crosses machines: the path is only meaningful in a
    // workspace on the machine it was resolved on.
    if (workspaceBackendId(workspaceKey) !== backendId) return;
    void openFileInApp(filePath, workspaceKey);
});

function EditorPaneImpl({ filePath }: EditorPaneImplProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const loadRequestIdRef = useRef(0);
    /** Disk reads after load; only the newest may land, and none after the editor goes. */
    const diskReadIdRef = useRef(0);
    const previewAccess = useRef(createEditorPreviewAccess());
    const editorFontFamily = useSettingsStore(
        (s) => s.settings?.editor?.fontFamily ?? DEFAULT_EDITOR_FONT_FAMILY,
    );
    const editorFontSize = useSettingsStore(
        (s) => s.settings?.editor?.fontSize ?? DEFAULT_EDITOR_FONT_SIZE,
    );
    const editorWordWrap = useSettingsStore(
        (s) => s.settings?.editor?.wordWrap ?? DEFAULT_EDITOR_WORD_WRAP,
    );
    const editorFontFamilyRef = useRef(editorFontFamily);
    const editorFontSizeRef = useRef(editorFontSize);
    const editorWordWrapRef = useRef(editorWordWrap);
    const { readFile, writeFile } = useFileStore();
    const backendId = useWorkspaceBackend();
    // Keeps FILE_CHANGED coming for this file while the explorer is closed.
    useWorkspaceFileWatch(backendId, filePath);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [dirty, setDirty] = useState(
        () => backendId !== null && isEditorDirty(backendId, filePath),
    );
    const [notice, setNotice] = useState<DiskNotice | null>(null);

    /** `overwrite` writes whatever the disk holds now; a plain save refuses a changed file. */
    const save = useCallback(
        async (overwrite = false) => {
            const model = editorRef.current?.getModel();
            if (!model || backendId === null) return;
            try {
                const access = previewAccess.current;
                await queueSave(model, () =>
                    access.save(async () => {
                        const savedVersion = model.getAlternativeVersionId();
                        const result = await writeFile(
                            backendId,
                            filePath,
                            model.getValue(),
                            overwrite ? undefined : getDiskBaseline(backendId, filePath),
                        );
                        if (model.isDisposed()) return;
                        if (!result.success) {
                            setNotice({ kind: "conflict" });
                            return;
                        }
                        setDiskBaseline(backendId, filePath, result.hash);
                        setNotice(null);
                        // Text typed while the write was answered is not on disk.
                        if (model.getAlternativeVersionId() !== savedVersion) return;
                        setEditorDirty(backendId, filePath, false);
                        setDirty(false);
                    }),
                );
            } catch (err: unknown) {
                console.error("Failed to save file:", err);
            }
        },
        [backendId, filePath, writeFile],
    );

    /** Reads the file for the model this pane shows, or null if it changed panes, went, or is not text now. */
    const readDisk = useCallback(async () => {
        const model = editorRef.current?.getModel();
        if (!model || backendId === null || !previewAccess.current.canEdit()) return null;
        const readId = ++diskReadIdRef.current;
        let disk: FileDiskText;
        try {
            disk = await readFile(backendId, filePath);
        } catch (err: unknown) {
            console.error("Failed to read file:", err);
            return null;
        }
        if (readId !== diskReadIdRef.current || model.isDisposed()) return null;
        return { model, disk };
    }, [backendId, filePath, readFile]);

    const takeDiskText = useCallback(
        (model: monaco.editor.ITextModel, disk: FileDiskText) => {
            if (backendId === null) return;
            setDiskBaseline(backendId, filePath, disk.hash);
            setEditorDirty(backendId, filePath, false);
            if (model.getValue() !== disk.content) replaceFromDisk(model, disk.content);
            setDirty(false);
            setNotice(null);
        },
        [backendId, filePath],
    );

    /** On a change event: a clean buffer follows the disk, a dirty one asks. */
    const followDisk = useCallback(async () => {
        const read = await readDisk();
        if (!read || backendId === null) return;
        const { model, disk } = read;
        // This pane's own save, or a split pane already took this text.
        if (disk.hash === getDiskBaseline(backendId, filePath)) return;
        if (disk.content !== model.getValue() && isEditorDirty(backendId, filePath)) {
            setNotice({ kind: "changed", hash: disk.hash });
            return;
        }
        takeDiskText(model, disk);
    }, [backendId, filePath, readDisk, takeDiskText]);

    const reloadFromDisk = useCallback(async () => {
        const read = await readDisk();
        if (read) takeDiskText(read.model, read.disk);
    }, [readDisk, takeDiskText]);

    /** Saving next writes over the disk text the bar was about, not over anything newer. */
    const keepMine = useCallback(() => {
        if (notice?.kind === "changed" && backendId !== null) {
            setDiskBaseline(backendId, filePath, notice.hash);
        }
        setNotice(null);
    }, [backendId, filePath, notice]);

    useEffect(() => {
        editorFontFamilyRef.current = editorFontFamily;
        editorFontSizeRef.current = editorFontSize;
        editorWordWrapRef.current = editorWordWrap;
    }, [editorFontFamily, editorFontSize, editorWordWrap]);

    useEffect(() => {
        // The model's identity includes its machine, so there is no model to
        // show until the workspace names one.
        const access = previewAccess.current;
        access.reset();
        setError(null);
        setNotice(null);
        if (!containerRef.current) return;
        if (backendId === null) {
            setLoading(true);
            setDirty(false);
            return;
        }
        const loadRequestId = ++loadRequestIdRef.current;
        // A read still in flight at cleanup belongs to the editor it disposes.
        let cancelled = false;

        const uri = modelUriFor(backendId, filePath);
        const existingModel = monaco.editor.getModel(uri);
        const model = existingModel ?? monaco.editor.createModel("", getLanguage(filePath), uri);
        const isDirty = existingModel != null && isEditorDirty(backendId, filePath);

        setLoading(!isDirty);
        setDirty(isDirty);

        const editor = monaco.editor.create(containerRef.current, {
            model,
            theme: MONACO_THEME_NAME,
            minimap: { enabled: false },
            fontSize: editorFontSizeRef.current,
            fontFamily: editorFontFamilyRef.current,
            wordWrap: editorWordWrapRef.current ? "on" : "off",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            readOnly: !isDirty,
        });

        editorRef.current = editor;

        // Sync TypeScript compiler options with nearest tsconfig
        const language = getLanguage(filePath);
        if (language === "typescript" || language === "javascript") {
            void syncCompilerOptions(backendId, filePath);
        }

        const restoreViewState = () => {
            const savedViewState = getViewState(backendId, filePath);
            if (savedViewState) {
                editor.restoreViewState(savedViewState);
            }
        };

        const navigateToPendingLine = () => {
            const pendingLine = consumePendingLine(backendId, filePath);
            if (pendingLine !== undefined) {
                editor.revealLineInCenter(pendingLine);
                editor.setPosition({ lineNumber: pendingLine, column: 1 });
                editor.focus();
            }
        };

        if (isDirty) {
            // Model has unsaved edits from a previous mount — skip disk reload
            access.allow();
            editor.updateOptions({ readOnly: false });
            restoreViewState();
            navigateToPendingLine();
            setDirty(true);
            setLoading(false);
        } else {
            void readFile(backendId, filePath)
                .then(({ content, hash }) => {
                    if (cancelled || loadRequestId !== loadRequestIdRef.current) return;
                    // A split pane on this model may have been typed in while
                    // this read was answered: its text is newer than the disk's.
                    const editedMeanwhile = isEditorDirty(backendId, filePath);
                    if (!editedMeanwhile) {
                        editor.setValue(content);
                        setDiskBaseline(backendId, filePath, hash);
                    }
                    access.allow();
                    editor.updateOptions({ readOnly: false });
                    restoreViewState();
                    navigateToPendingLine();
                    setDirty(editedMeanwhile);
                    setLoading(false);
                })
                .catch((err: unknown) => {
                    if (cancelled || loadRequestId !== loadRequestIdRef.current) return;
                    console.error("Failed to read file:", err);
                    access.reset();
                    editor.updateOptions({ readOnly: true });
                    setError(err instanceof Error ? err.message : "Failed to read file");
                    setLoading(false);
                });
        }

        const changeDisposable = editor.onDidChangeModelContent((e) => {
            if (isDiskSync(model)) {
                // A pane on this model (perhaps another one) took the disk's text.
                setNotice(null);
                setDirty(isEditorDirty(backendId, filePath));
                return;
            }
            // A flush is a load from disk, perhaps by another pane on this model.
            if (!access.canEdit() || e.isFlush) return;
            setEditorDirty(backendId, filePath, true);
            setDirty(true);
        });

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            void save();
        });

        return () => {
            cancelled = true;
            diskReadIdRef.current += 1;
            access.reset();
            const state = editor.saveViewState();
            if (state) {
                saveViewState(backendId, filePath, state);
            }
            if (editorRef.current === editor) {
                editorRef.current = null;
            }
            changeDisposable.dispose();
            editor.dispose();
            // A split pane may still show this file on the same model.
            const inUse = monaco.editor.getEditors().some((other) => other.getModel() === model);
            if (!inUse && !isEditorDirty(backendId, filePath)) {
                // The machine's reset may already have disposed it.
                if (!model.isDisposed()) model.dispose();
                clearEditorDirty(backendId, filePath);
                clearDiskBaseline(backendId, filePath);
            }
        };
    }, [backendId, filePath, readFile, save]);

    useEffect(() => {
        if (backendId === null) return;
        return onEvent(MSG.FILE_CHANGED, (payload, fromBackendId) => {
            // The same path on another machine is another file.
            if (fromBackendId !== backendId) return;
            if (fileChangeCovers(payload as FileChangeEvent, filePath)) void followDisk();
        });
    }, [backendId, filePath, followDisk]);

    // Listen for line-navigation requests from search results or other sources
    useEffect(() => {
        function handleNavigate(e: Event) {
            const { filePath: targetPath, line } = (
                e as CustomEvent<{ filePath: string; line: number }>
            ).detail;
            const editor = editorRef.current;
            if (targetPath === filePath && editor && previewAccess.current.canEdit()) {
                editor.revealLineInCenter(line);
                editor.setPosition({ lineNumber: line, column: 1 });
                editor.focus();
            }
        }
        window.addEventListener("editor-navigate", handleNavigate);
        return () => window.removeEventListener("editor-navigate", handleNavigate);
    }, [filePath]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;

        editor.updateOptions({
            fontFamily: editorFontFamily,
            fontSize: editorFontSize,
            wordWrap: editorWordWrap ? "on" : "off",
        });
        monaco.editor.remeasureFonts();
        editor.layout();
    }, [editorFontFamily, editorFontSize, editorWordWrap]);

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            {notice && (
                <div
                    role="alert"
                    className="bg-muted flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-sm">
                    <span className="flex-1">
                        {notice.kind === "changed"
                            ? "Changed on disk"
                            : "Not saved: the file changed on disk"}
                    </span>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            void reloadFromDisk();
                        }}>
                        Reload
                    </Button>
                    {notice.kind === "changed" ? (
                        <Button size="sm" variant="outline" onClick={keepMine}>
                            Keep mine
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                                void save(true);
                            }}>
                            Overwrite
                        </Button>
                    )}
                </div>
            )}
            {dirty && !notice && (
                <Button
                    size="sm"
                    className="absolute top-2 right-2 z-10"
                    disabled={loading || error !== null}
                    onClick={() => {
                        void save();
                    }}>
                    Save
                </Button>
            )}
            {(loading || error) && (
                <div className="text-muted-foreground absolute inset-0 z-[1] flex items-center justify-center">
                    {error ?? "Loading..."}
                </div>
            )}
            <div ref={containerRef} className="min-h-0 w-full flex-1" />
        </div>
    );
}

export default EditorPaneImpl;
