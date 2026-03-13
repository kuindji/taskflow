import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import { DEFAULT_EDITOR_FONT_FAMILY, DEFAULT_EDITOR_FONT_SIZE } from "@taskflow/shared";
import { useFileStore } from "@/stores/file-store";
import { useSettingsStore } from "@/stores/settings-store";
import { Button } from "@/components/ui/button";

interface EditorPaneProps {
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

function EditorPane({ filePath }: EditorPaneProps) {
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
    const editorFontFamilyRef = useRef(editorFontFamily);
    const editorFontSizeRef = useRef(editorFontSize);
    const { readFile, writeFile } = useFileStore();
    const [loading, setLoading] = useState(true);
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        editorFontFamilyRef.current = editorFontFamily;
        editorFontSizeRef.current = editorFontSize;
    }, [editorFontFamily, editorFontSize]);

    useEffect(() => {
        if (!containerRef.current) return;
        const loadRequestId = ++loadRequestIdRef.current;
        editorReadyRef.current = false;
        setLoading(true);
        setDirty(false);

        const uri = monaco.Uri.file(filePath);
        const existingModel = monaco.editor.getModel(uri);
        const model = existingModel ?? monaco.editor.createModel("", getLanguage(filePath), uri);

        const editor = monaco.editor.create(containerRef.current, {
            model,
            theme: "vs-dark",
            minimap: { enabled: false },
            fontSize: editorFontSizeRef.current,
            fontFamily: editorFontFamilyRef.current,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            readOnly: false,
        });

        editorRef.current = editor;

        void readFile(filePath)
            .then((content) => {
                if (loadRequestId !== loadRequestIdRef.current) return;
                editor.setValue(content);
                editorReadyRef.current = true;
                setDirty(false);
                setLoading(false);
            })
            .catch((err: unknown) => {
                if (loadRequestId !== loadRequestIdRef.current) return;
                console.error("Failed to read file:", err);
                editorReadyRef.current = true;
                setLoading(false);
            });

        const changeDisposable = editor.onDidChangeModelContent(() => {
            if (!editorReadyRef.current) return;
            setDirty(true);
        });

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            if (!editorReadyRef.current) return;
            void writeFile(filePath, editor.getValue())
                .then(() => {
                    setDirty(false);
                })
                .catch((err: unknown) => {
                    console.error("Failed to save file:", err);
                });
        });

        return () => {
            editorReadyRef.current = false;
            if (editorRef.current === editor) {
                editorRef.current = null;
            }
            changeDisposable.dispose();
            editor.dispose();
            if (!existingModel) {
                model.dispose();
            }
        };
    }, [filePath, readFile, writeFile]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;

        editor.updateOptions({
            fontFamily: editorFontFamily,
            fontSize: editorFontSize,
        });
        monaco.editor.remeasureFonts();
        editor.layout();
    }, [editorFontFamily, editorFontSize]);

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
                            setDirty(false);
                        } catch (err: unknown) {
                            console.error("Failed to save file:", err);
                        }
                    }}
                >
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

export { EditorPane };
export type { EditorPaneProps };
