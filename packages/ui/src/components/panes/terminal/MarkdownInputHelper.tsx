import { useCallback, useRef, useEffect } from "react";
import * as monaco from "monaco-editor";
import { DEFAULT_EDITOR_FONT_FAMILY, DEFAULT_EDITOR_FONT_SIZE } from "@taskflow/shared";
import { MONACO_THEME_NAME } from "@/lib/monaco-theme";
import { useSettingsStore } from "@/stores/settings-store";
import { useSessionStore } from "@/stores/session-store";
import { useMarkdownInputStore, getEditor } from "@/stores/markdown-input-store";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Tab } from "@/stores/session-helpers";

const AGENT_SESSION_TYPES: ReadonlySet<Tab["type"]> = new Set([
    "claude",
    "codex",
    "opencode",
    "gemini",
    "cursor",
]);

const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 220;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 150;
const CONTAINER_PADDING = 12;

// --- EditorPanel sub-component ---

interface EditorPanelProps {
    sessionId: string;
    containerRef: React.RefObject<HTMLDivElement | null>;
    onSend: () => void;
    onInsert: () => void;
    onClose: () => void;
}

function EditorPanel({ sessionId, containerRef, onSend, onInsert, onClose }: EditorPanelProps) {
    const editorState = useMarkdownInputStore((s) => getEditor(s, sessionId));
    const setPosition = useMarkdownInputStore((s) => s.setPosition);
    const setSize = useMarkdownInputStore((s) => s.setSize);
    const setBuffer = useMarkdownInputStore((s) => s.setBuffer);

    const fontFamily = useSettingsStore(
        (s) => s.settings?.editor?.fontFamily ?? DEFAULT_EDITOR_FONT_FAMILY,
    );
    const fontSize = useSettingsStore(
        (s) => s.settings?.editor?.fontSize ?? DEFAULT_EDITOR_FONT_SIZE,
    );

    const panelRef = useRef<HTMLDivElement>(null);
    const monacoRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const isDragging = useRef(false);
    const isResizing = useRef(false);
    const dragOffset = useRef({ x: 0, y: 0 });

    // Compute clamped position and size
    const containerRect = containerRef.current?.getBoundingClientRect();
    const maxW = (containerRect?.width ?? 600) - CONTAINER_PADDING * 2;
    const maxH = (containerRect?.height ?? 400) - CONTAINER_PADDING * 2;

    const width = Math.min(Math.max(editorState.size?.width ?? DEFAULT_WIDTH, MIN_WIDTH), maxW);
    const height = Math.min(Math.max(editorState.size?.height ?? DEFAULT_HEIGHT, MIN_HEIGHT), maxH);

    // Default position: bottom center
    const defaultX = Math.max(0, ((containerRect?.width ?? 600) - width) / 2);
    const defaultY = Math.max(0, (containerRect?.height ?? 400) - height - CONTAINER_PADDING);

    const rawX = editorState.position?.x ?? defaultX;
    const rawY = editorState.position?.y ?? defaultY;
    const x = Math.min(Math.max(0, rawX), Math.max(0, (containerRect?.width ?? 600) - width));
    const y = Math.min(Math.max(0, rawY), Math.max(0, (containerRect?.height ?? 400) - height));

    // Monaco setup via callback ref
    const editorContainerRef = useCallback(
        (node: HTMLDivElement | null) => {
            if (!node) return;
            if (monacoRef.current) return; // Already created

            const editor = monaco.editor.create(node, {
                value: editorState.buffer,
                language: "markdown",
                theme: MONACO_THEME_NAME,
                fontFamily,
                fontSize,
                wordWrap: "on",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                lineNumbers: "off",
                folding: false,
                glyphMargin: false,
                lineDecorationsWidth: 0,
                lineNumbersMinChars: 0,
                padding: { top: 10, bottom: 10 },
                renderLineHighlight: "none",
                overviewRulerBorder: false,
                scrollbar: {
                    verticalScrollbarSize: 6,
                    horizontalScrollbarSize: 6,
                },
            });

            monacoRef.current = editor;

            editor.onDidChangeModelContent(() => {
                setBuffer(sessionId, editor.getValue());
            });

            // Cmd+Enter to send
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                onSend();
            });

            // Cmd+Shift+I to close editor
            editor.addCommand(
                monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI,
                () => {
                    onClose();
                },
            );

            editor.focus();
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time setup, buffer read from ref
        [sessionId, fontFamily, fontSize],
    );

    // Dispose Monaco on unmount
    useEffect(() => {
        return () => {
            if (monacoRef.current) {
                monacoRef.current.dispose();
                monacoRef.current = null;
            }
        };
    }, []);

    // Update Monaco font when settings change
    useEffect(() => {
        if (monacoRef.current) {
            monacoRef.current.updateOptions({ fontFamily, fontSize });
        }
    }, [fontFamily, fontSize]);

    // --- Drag handlers (document-level move/end for reliable capture) ---
    const handleDragStart = useCallback(
        (e: React.PointerEvent) => {
            if (isResizing.current) return;
            isDragging.current = true;
            const panel = panelRef.current;
            if (!panel) return;
            const rect = panel.getBoundingClientRect();
            const containerR = containerRef.current?.getBoundingClientRect();
            dragOffset.current = {
                x: e.clientX - rect.left + (containerR?.left ?? 0),
                y: e.clientY - rect.top + (containerR?.top ?? 0),
            };
        },
        [containerRef],
    );

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            if (!isDragging.current) return;
            const containerR = containerRef.current?.getBoundingClientRect();
            if (!containerR) return;
            const newX = e.clientX - dragOffset.current.x;
            const newY = e.clientY - dragOffset.current.y;
            const clampedX = Math.min(Math.max(0, newX), Math.max(0, containerR.width - width));
            const clampedY = Math.min(Math.max(0, newY), Math.max(0, containerR.height - height));
            setPosition(sessionId, { x: clampedX, y: clampedY });
        };
        const onUp = () => {
            isDragging.current = false;
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        return () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
        };
    }, [containerRef, sessionId, width, height, setPosition]);

    // --- Resize handlers (document-level move/end for reliable capture) ---
    const handleResizeStart = useCallback((e: React.PointerEvent) => {
        isResizing.current = true;
        e.stopPropagation();
        e.preventDefault();
    }, []);

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            if (!isResizing.current) return;
            const containerR = containerRef.current?.getBoundingClientRect();
            if (!containerR) return;
            const newW = Math.min(
                Math.max(MIN_WIDTH, e.clientX - containerR.left - x),
                containerR.width - x,
            );
            const newH = Math.min(
                Math.max(MIN_HEIGHT, e.clientY - containerR.top - y),
                containerR.height - y,
            );
            setSize(sessionId, { width: newW, height: newH });
        };
        const onUp = () => {
            isResizing.current = false;
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        return () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
        };
    }, [containerRef, sessionId, x, y, setSize]);

    return (
        <div
            ref={panelRef}
            className="absolute z-20 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
            style={{ left: x, top: y, width, height }}
        >
            {/* Drag zone — top strip */}
            <div
                className="flex shrink-0 cursor-grab items-center justify-between px-2.5 py-1.5 active:cursor-grabbing"
                onPointerDown={handleDragStart}
            >
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] tracking-wider text-muted-foreground/40">⋮⋮</span>
                    <span className="font-sans text-[10px] text-muted-foreground/60">
                        Markdown Input
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                >
                    ×
                </button>
            </div>

            {/* Monaco editor area */}
            <div
                ref={editorContainerRef}
                className="min-h-0 flex-1 overflow-hidden p-3 [&_.monaco-editor]:!border-none [&_.monaco-editor]:!outline-none"
            />

            {/* Footer — same bg, no border */}
            <div className="flex shrink-0 items-center justify-between px-2.5 py-1.5">
                <span className="font-sans text-[10px] text-muted-foreground/30">⌘⇧I</span>
                <div className="flex items-center">
                    <button
                        type="button"
                        onClick={onSend}
                        className="rounded-l-md bg-primary px-3 py-1 font-sans text-[11px] text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                        Send ↵
                    </button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="rounded-r-md border-l border-primary-foreground/20 bg-primary px-1.5 py-1 font-sans text-[11px] text-primary-foreground transition-colors hover:bg-primary/90"
                            >
                                ▾
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="top" align="end">
                            <DropdownMenuItem onSelect={onInsert}>
                                Insert (no submit)
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Resize handle — bottom right corner */}
            <div
                className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize"
                onPointerDown={handleResizeStart}
            />
        </div>
    );
}

// --- Main component ---

interface MarkdownInputHelperProps {
    sessionId: string;
    sessionType: Tab["type"];
}

function MarkdownInputHelper({ sessionId, sessionType }: MarkdownInputHelperProps) {
    const isOpen = useMarkdownInputStore((s) => getEditor(s, sessionId).isOpen);
    const toggle = useMarkdownInputStore((s) => s.toggle);
    const clearBuffer = useMarkdownInputStore((s) => s.clearBuffer);
    const containerRef = useRef<HTMLDivElement>(null);

    const sendInput = useSessionStore((s) => s.sendInput);

    const handleToggle = useCallback(() => {
        toggle(sessionId);
    }, [toggle, sessionId]);

    const handleSend = useCallback(() => {
        const buffer = getEditor(useMarkdownInputStore.getState(), sessionId).buffer;
        if (!buffer.trim()) return;
        sendInput(sessionId, buffer + "\r");
        clearBuffer(sessionId);
    }, [sessionId, sendInput, clearBuffer]);

    const handleInsert = useCallback(() => {
        const buffer = getEditor(useMarkdownInputStore.getState(), sessionId).buffer;
        if (!buffer.trim()) return;
        sendInput(sessionId, buffer);
        clearBuffer(sessionId);
    }, [sessionId, sendInput, clearBuffer]);

    const handleClose = useCallback(() => {
        toggle(sessionId);
    }, [toggle, sessionId]);

    if (!AGENT_SESSION_TYPES.has(sessionType)) return null;

    return (
        <div ref={containerRef} className="pointer-events-none absolute inset-0 z-10">
            {isOpen ? (
                <div className="pointer-events-auto h-full">
                    <EditorPanel
                        sessionId={sessionId}
                        containerRef={containerRef}
                        onSend={handleSend}
                        onInsert={handleInsert}
                        onClose={handleClose}
                    />
                </div>
            ) : (
                <button
                    type="button"
                    onClick={handleToggle}
                    className="pointer-events-auto absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-md transition-colors hover:bg-accent hover:text-accent-foreground"
                    title="Markdown Input (⌘⇧I)"
                >
                    <PenIcon />
                </button>
            )}
        </div>
    );
}

function PenIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
        </svg>
    );
}

export { MarkdownInputHelper, AGENT_SESSION_TYPES };
