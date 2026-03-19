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

interface EditorPaneImplProps {
    filePath: string;
}

const EXT_TO_LANGUAGE: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    py: "python",
    rs: "rust",
    go: "go",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    sh: "shell",
    bash: "shell",
};

function getLanguage(path: string): string {
    const ext = path.split(".").pop() ?? "";
    return EXT_TO_LANGUAGE[ext] ?? "plaintext";
}

import { dirtyModels, viewStates } from "./editor-dirty-state";

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
    const [loading, setLoading] = useState(true);
    const [dirty, setDirty] = useState(() => dirtyModels.get(filePath) ?? false);

    useEffect(() => {
        editorFontFamilyRef.current = editorFontFamily;
        editorFontSizeRef.current = editorFontSize;
        editorWordWrapRef.current = editorWordWrap;
    }, [editorFontFamily, editorFontSize, editorWordWrap]);

    useEffect(() => {
        if (!containerRef.current) return;
        const loadRequestId = ++loadRequestIdRef.current;
        editorReadyRef.current = false;

        const uri = monaco.Uri.file(filePath);
        const existingModel = monaco.editor.getModel(uri);
        const model = existingModel ?? monaco.editor.createModel("", getLanguage(filePath), uri);
        const isDirty = existingModel != null && (dirtyModels.get(filePath) ?? false);

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

        const restoreViewState = () => {
            const savedViewState = viewStates.get(filePath);
            if (savedViewState) {
                editor.restoreViewState(savedViewState);
            }
        };

        if (isDirty) {
            // Model has unsaved edits from a previous mount — skip disk reload
            editorReadyRef.current = true;
            restoreViewState();
            setDirty(true);
            setLoading(false);
        } else {
            void readFile(filePath)
                .then((content) => {
                    if (loadRequestId !== loadRequestIdRef.current) return;
                    editor.setValue(content);
                    editorReadyRef.current = true;
                    restoreViewState();
                    setDirty(false);
                    setLoading(false);
                })
                .catch((err: unknown) => {
                    if (loadRequestId !== loadRequestIdRef.current) return;
                    console.error("Failed to read file:", err);
                    editorReadyRef.current = true;
                    setLoading(false);
                });
        }

        const changeDisposable = editor.onDidChangeModelContent(() => {
            if (!editorReadyRef.current) return;
            dirtyModels.set(filePath, true);
            setDirty(true);
        });

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            if (!editorReadyRef.current) return;
            void writeFile(filePath, editor.getValue())
                .then(() => {
                    dirtyModels.set(filePath, false);
                    setDirty(false);
                })
                .catch((err: unknown) => {
                    console.error("Failed to save file:", err);
                });
        });

        return () => {
            editorReadyRef.current = false;
            const state = editor.saveViewState();
            if (state) {
                viewStates.set(filePath, state);
            }
            if (editorRef.current === editor) {
                editorRef.current = null;
            }
            changeDisposable.dispose();
            editor.dispose();
            if (!dirtyModels.get(filePath)) {
                model.dispose();
                dirtyModels.delete(filePath);
                viewStates.delete(filePath);
            }
        };
    }, [filePath, readFile, writeFile]);

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
                        if (!editorRef.current || !editorReadyRef.current) return;
                        try {
                            await writeFile(filePath, editorRef.current.getValue());
                            dirtyModels.set(filePath, false);
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
