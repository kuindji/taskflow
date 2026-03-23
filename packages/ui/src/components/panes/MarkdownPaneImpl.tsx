import { Children, useEffect, useState, useCallback, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Components } from "react-markdown";
import { useFileStore } from "@/stores/file-store";
import { useSettingsStore } from "@/stores/settings-store";
import { onEvent } from "@/hooks/useWebSocket";
import { MSG, DEFAULT_EDITOR_FONT_SIZE, DEFAULT_EDITOR_FONT_FAMILY } from "@taskflow/shared";
import type { FileChangeEvent } from "@taskflow/shared";

interface MarkdownPaneImplProps {
    filePath: string;
}

const remarkPlugins = [remarkGfm];

function MarkdownPaneImpl({ filePath }: MarkdownPaneImplProps) {
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const readFile = useFileStore((s) => s.readFile);
    const editorFontSize = useSettingsStore(
        (s) => s.settings?.editor?.fontSize ?? DEFAULT_EDITOR_FONT_SIZE,
    );
    const editorFontFamily = useSettingsStore(
        (s) => s.settings?.editor?.fontFamily ?? DEFAULT_EDITOR_FONT_FAMILY,
    );
    const loadIdRef = useRef(0);

    const loadContent = useCallback(async () => {
        const loadId = ++loadIdRef.current;
        try {
            const text = await readFile(filePath);
            if (loadId !== loadIdRef.current) return;
            setContent(text);
            setError(null);
        } catch (err: unknown) {
            if (loadId !== loadIdRef.current) return;
            const message = err instanceof Error ? err.message : "Failed to read file";
            setError(message);
        } finally {
            if (loadId === loadIdRef.current) {
                setLoading(false);
            }
        }
    }, [filePath, readFile]);

    // Initial load
    useEffect(() => {
        setLoading(true);
        void loadContent();
    }, [loadContent]);

    // Track file changes
    useEffect(() => {
        return onEvent(MSG.FILE_CHANGED, (payload) => {
            const event = payload as FileChangeEvent;
            if (event.path === filePath && event.type !== "delete") {
                void loadContent();
            }
        });
    }, [filePath, loadContent]);

    const components: Components = {
        code({ className, children, ...rest }) {
            const match = /language-(\w+)/.exec(className ?? "");
            const codeString = Children.toArray(children)
                .map((child) => {
                    if (typeof child === "string" || typeof child === "number") {
                        return String(child);
                    }

                    return "";
                })
                .join("")
                .replace(/\n$/, "");

            if (match) {
                return (
                    <SyntaxHighlighter
                        style={oneDark}
                        language={match[1]}
                        PreTag="div"
                        customStyle={{
                            margin: 0,
                            borderRadius: "0.375rem",
                            fontSize: editorFontSize,
                        }}>
                        {codeString}
                    </SyntaxHighlighter>
                );
            }

            return (
                <code className={className} {...rest}>
                    {children}
                </code>
            );
        },
    };

    if (loading) {
        return (
            <div className="text-muted-foreground flex flex-1 items-center justify-center">
                Loading...
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-destructive flex flex-1 items-center justify-center">{error}</div>
        );
    }

    return (
        <div className="min-h-0 min-w-0 flex-1 overflow-auto p-6">
            <div
                className="markdown-preview prose prose-invert min-w-0 max-w-none"
                style={{ fontSize: editorFontSize, fontFamily: editorFontFamily }}>
                <Markdown remarkPlugins={remarkPlugins} components={components}>
                    {content}
                </Markdown>
            </div>
        </div>
    );
}

export default MarkdownPaneImpl;
