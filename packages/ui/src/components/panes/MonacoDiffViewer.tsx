import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import { DEFAULT_EDITOR_FONT_FAMILY, DEFAULT_EDITOR_FONT_SIZE } from "@taskflow/shared";
import { useSettingsStore } from "@/stores/settings-store";
import { MONACO_THEME_NAME } from "@/lib/monaco-theme";

interface MonacoDiffViewerProps {
    original: string;
    modified: string;
    language: string;
}

function MonacoDiffViewer({ original, modified, language }: MonacoDiffViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
    const originalModelRef = useRef<monaco.editor.ITextModel | null>(null);
    const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null);

    const fontFamily = useSettingsStore(
        (s) => s.settings?.editor?.fontFamily ?? DEFAULT_EDITOR_FONT_FAMILY,
    );
    const fontSize = useSettingsStore(
        (s) => s.settings?.editor?.fontSize ?? DEFAULT_EDITOR_FONT_SIZE,
    );

    useEffect(() => {
        if (!containerRef.current) return;

        const originalModel = monaco.editor.createModel(original, language);
        const modifiedModel = monaco.editor.createModel(modified, language);
        originalModelRef.current = originalModel;
        modifiedModelRef.current = modifiedModel;

        const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
            theme: MONACO_THEME_NAME,
            readOnly: true,
            originalEditable: false,
            minimap: { enabled: false },
            fontSize,
            fontFamily,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            renderSideBySide: true,
        });

        diffEditor.setModel({ original: originalModel, modified: modifiedModel });
        editorRef.current = diffEditor;

        return () => {
            diffEditor.dispose();
            originalModel.dispose();
            modifiedModel.dispose();
            editorRef.current = null;
            originalModelRef.current = null;
            modifiedModelRef.current = null;
        };
        // Only create/destroy editor on mount/unmount — content updates handled below
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Update content when props change
    useEffect(() => {
        const origModel = originalModelRef.current;
        const modModel = modifiedModelRef.current;
        if (!origModel || !modModel) return;

        if (origModel.getValue() !== original) {
            origModel.setValue(original);
        }
        if (modModel.getValue() !== modified) {
            modModel.setValue(modified);
        }

        // Update language if it changed
        if (origModel.getLanguageId() !== language) {
            monaco.editor.setModelLanguage(origModel, language);
        }
        if (modModel.getLanguageId() !== language) {
            monaco.editor.setModelLanguage(modModel, language);
        }
    }, [original, modified, language]);

    // Update editor options when font settings change
    useEffect(() => {
        editorRef.current?.updateOptions({ fontFamily, fontSize });
    }, [fontFamily, fontSize]);

    return <div ref={containerRef} className="h-full w-full" />;
}

export { MonacoDiffViewer };
