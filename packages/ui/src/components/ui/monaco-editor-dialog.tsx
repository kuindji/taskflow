import { useRef, useCallback, useEffect } from "react";
import * as monaco from "monaco-editor";
import { DEFAULT_EDITOR_FONT_FAMILY, DEFAULT_EDITOR_FONT_SIZE } from "@taskflow/shared";
import { MONACO_THEME_NAME } from "@/lib/monaco-theme";
import { useSettingsStore } from "@/stores/settings-store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface MonacoEditorDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    value: string;
    onClose: (value: string) => void;
    title?: string;
}

function MonacoEditorDialog({
    open,
    onOpenChange,
    value,
    onClose,
    title = "Edit",
}: MonacoEditorDialogProps) {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const valueRef = useRef(value);
    const fontFamily = useSettingsStore(
        (s) => s.settings?.editor?.fontFamily ?? DEFAULT_EDITOR_FONT_FAMILY,
    );
    const fontSize = useSettingsStore(
        (s) => s.settings?.editor?.fontSize ?? DEFAULT_EDITOR_FONT_SIZE,
    );
    const fontFamilyRef = useRef(fontFamily);
    const fontSizeRef = useRef(fontSize);

    useEffect(() => {
        valueRef.current = value;
    }, [value]);

    useEffect(() => {
        fontFamilyRef.current = fontFamily;
        fontSizeRef.current = fontSize;
    }, [fontFamily, fontSize]);

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen && editorRef.current) {
                onClose(editorRef.current.getValue());
                editorRef.current.dispose();
                editorRef.current = null;
            }
            onOpenChange(nextOpen);
        },
        [onClose, onOpenChange],
    );

    const containerCallbackRef = useCallback((node: HTMLDivElement | null) => {
        if (!node) return;

        const editor = monaco.editor.create(node, {
            value: valueRef.current,
            language: "markdown",
            theme: MONACO_THEME_NAME,
            fontFamily: fontFamilyRef.current,
            fontSize: fontSizeRef.current,
            wordWrap: "on",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            lineNumbers: "off",
            folding: false,
            glyphMargin: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
            padding: { top: 8, bottom: 8 },
            renderLineHighlight: "none",
            overviewRulerBorder: false,
        });

        editorRef.current = editor;
        editor.focus();
    }, []);

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="flex h-[70vh] flex-col sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <div
                    ref={containerCallbackRef}
                    className="min-h-0 flex-1 overflow-hidden rounded-md [&_.monaco-editor]:!border-none [&_.monaco-editor]:!outline-none"
                />
            </DialogContent>
        </Dialog>
    );
}

export { MonacoEditorDialog };
export type { MonacoEditorDialogProps };
