import { Children, useEffect, useState, useCallback, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Components } from "react-markdown";
import { useFileStore } from "@/stores/file-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { onEvent } from "@/hooks/useWebSocket";
import { MSG, DEFAULT_EDITOR_FONT_SIZE, DEFAULT_EDITOR_FONT_FAMILY } from "@taskflow/shared";
import type { FileChangeEvent } from "@taskflow/shared";

interface MarkdownPaneImplProps {
    filePath: string;
    tabId: string;
    workspaceKey: string;
}

const remarkPlugins = [remarkGfm];

function MarkdownPaneImpl({ filePath, tabId, workspaceKey }: MarkdownPaneImplProps) {
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
    const scrollRef = useRef<HTMLDivElement>(null);
    const scrollWriteRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Read once: the pane owns the live value from here on, and subscribing
    // to the store would re-render the pane on every scroll tick.
    const initialScrollTopRef = useRef(
        useSessionStore.getState().tabsByWorkspace[workspaceKey]?.find((t) => t.id === tabId)
            ?.previewScrollTop ?? 0,
    );

    // Mirrors the container's scrollTop synchronously. React detaches DOM refs
    // in the mutation phase, before passive effect cleanup runs, so the unmount
    // flush below cannot read `scrollRef.current` — it reads this instead.
    // Seeded from the restored offset so an unmount with no scrolling in between
    // (swap to edit and straight back) re-writes the same value, not 0.
    const lastScrollTopRef = useRef(initialScrollTopRef.current);

    const handleScroll = useCallback(() => {
        const top = scrollRef.current?.scrollTop;
        if (top !== undefined) lastScrollTopRef.current = top;
        if (scrollWriteRef.current) return;
        scrollWriteRef.current = setTimeout(() => {
            scrollWriteRef.current = null;
            useSessionStore
                .getState()
                .setTabScrollTop(workspaceKey, tabId, lastScrollTopRef.current);
        }, 150);
    }, [tabId, workspaceKey]);

    // Flush the pending offset on unmount (the preview→edit swap unmounts this pane).
    useEffect(() => {
        return () => {
            if (scrollWriteRef.current) clearTimeout(scrollWriteRef.current);
            useSessionStore
                .getState()
                .setTabScrollTop(workspaceKey, tabId, lastScrollTopRef.current);
        };
    }, [tabId, workspaceKey]);

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

    // Restore once the content has rendered and the container has a scroll height.
    useEffect(() => {
        if (loading) return;
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = initialScrollTopRef.current;
        lastScrollTopRef.current = initialScrollTopRef.current;
    }, [loading]);

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
        <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="min-h-0 min-w-0 flex-1 overflow-auto p-6">
            <div
                className="markdown-preview prose prose-invert max-w-none min-w-0"
                style={{ fontSize: editorFontSize, fontFamily: editorFontFamily }}>
                <Markdown remarkPlugins={remarkPlugins} components={components}>
                    {content}
                </Markdown>
            </div>
        </div>
    );
}

export default MarkdownPaneImpl;
