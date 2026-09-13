import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import {
    DEFAULT_EDITOR_FONT_FAMILY,
    DEFAULT_EDITOR_FONT_SIZE,
    DEFAULT_EDITOR_WORD_WRAP,
} from "@taskflow/shared";
import { useFileStore } from "@/stores/file-store";
import { useSettingsStore } from "@/stores/settings-store";
import { MONACO_THEME_NAME } from "@/lib/monaco-theme";
import { Button } from "@/components/ui/button";
import { syncCompilerOptions, registerImportNavigation } from "@/lib/monaco-import-navigation";
import { openFileInApp } from "@/lib/open-file";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";
import { useProjectStore } from "@/stores/project-store";
import { useWorkspaceBackend } from "@/hooks/useWorkspaceBackend";
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
    getViewState,
    saveViewState,
    consumePendingLine,
} from "./editor-dirty-state";
import { modelUriFor } from "./editor-uri";

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
    const editorReadyRef = useRef(false);
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
    const [loading, setLoading] = useState(true);
    const [dirty, setDirty] = useState(
        () => backendId !== null && isEditorDirty(backendId, filePath),
    );

    useEffect(() => {
        editorFontFamilyRef.current = editorFontFamily;
        editorFontSizeRef.current = editorFontSize;
        editorWordWrapRef.current = editorWordWrap;
    }, [editorFontFamily, editorFontSize, editorWordWrap]);

    useEffect(() => {
        // The model's identity includes its machine, so there is no model to
        // show until the workspace names one.
        if (!containerRef.current) return;
        if (backendId === null) {
            setLoading(true);
            setDirty(false);
            return;
        }
        const loadRequestId = ++loadRequestIdRef.current;
        // A read still in flight at cleanup belongs to the editor it disposes.
        let cancelled = false;
        editorReadyRef.current = false;

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
            readOnly: false,
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
            editorReadyRef.current = true;
            restoreViewState();
            navigateToPendingLine();
            setDirty(true);
            setLoading(false);
        } else {
            void readFile(backendId, filePath)
                .then((content) => {
                    if (cancelled || loadRequestId !== loadRequestIdRef.current) return;
                    editor.setValue(content);
                    editorReadyRef.current = true;
                    restoreViewState();
                    navigateToPendingLine();
                    setDirty(false);
                    setLoading(false);
                })
                .catch((err: unknown) => {
                    if (cancelled || loadRequestId !== loadRequestIdRef.current) return;
                    console.error("Failed to read file:", err);
                    editorReadyRef.current = true;
                    setLoading(false);
                });
        }

        const changeDisposable = editor.onDidChangeModelContent(() => {
            if (!editorReadyRef.current) return;
            setEditorDirty(backendId, filePath, true);
            setDirty(true);
        });

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            if (!editorReadyRef.current) return;
            void writeFile(backendId, filePath, editor.getValue())
                .then(() => {
                    setEditorDirty(backendId, filePath, false);
                    setDirty(false);
                })
                .catch((err: unknown) => {
                    console.error("Failed to save file:", err);
                });
        });

        return () => {
            cancelled = true;
            editorReadyRef.current = false;
            const state = editor.saveViewState();
            if (state) {
                saveViewState(backendId, filePath, state);
            }
            if (editorRef.current === editor) {
                editorRef.current = null;
            }
            changeDisposable.dispose();
            editor.dispose();
            if (!isEditorDirty(backendId, filePath)) {
                // The machine's reset may already have disposed it.
                if (!model.isDisposed()) model.dispose();
                clearEditorDirty(backendId, filePath);
            }
        };
    }, [backendId, filePath, readFile, writeFile]);

    // Listen for line-navigation requests from search results or other sources
    useEffect(() => {
        function handleNavigate(e: Event) {
            const { filePath: targetPath, line } = (
                e as CustomEvent<{ filePath: string; line: number }>
            ).detail;
            const editor = editorRef.current;
            if (targetPath === filePath && editor && editorReadyRef.current) {
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
        <div className="relative flex-1">
            {dirty && (
                <Button
                    size="sm"
                    className="absolute top-2 right-2 z-10"
                    disabled={loading}
                    onClick={async () => {
                        if (!editorRef.current || !editorReadyRef.current || backendId === null)
                            return;
                        try {
                            await writeFile(backendId, filePath, editorRef.current.getValue());
                            setEditorDirty(backendId, filePath, false);
                            setDirty(false);
                        } catch (err: unknown) {
                            console.error("Failed to save file:", err);
                        }
                    }}>
                    Save
                </Button>
            )}
            {loading && (
                <div className="text-muted-foreground absolute inset-0 z-[1] flex items-center justify-center">
                    Loading...
                </div>
            )}
            <div ref={containerRef} className="h-full w-full" />
        </div>
    );
}

export default EditorPaneImpl;
