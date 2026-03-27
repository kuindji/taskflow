import { useCallback, useRef, useEffect } from "react";
import * as monaco from "monaco-editor";
import { DEFAULT_EDITOR_FONT_FAMILY, DEFAULT_EDITOR_FONT_SIZE } from "@taskflow/shared";
import { MONACO_THEME_NAME } from "@/lib/monaco-theme";
import { useSettingsStore } from "@/stores/settings-store";
import { useSessionStore } from "@/stores/session-store";
import { useMarkdownInputStore, getEditor } from "@/stores/markdown-input-store";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
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

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

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
    const globalPosition = useMarkdownInputStore((s) => s.position);
    const globalSize = useMarkdownInputStore((s) => s.size);
    const setPosition = useMarkdownInputStore((s) => s.setPosition);
    const setSize = useMarkdownInputStore((s) => s.setSize);
    const setBuffer = useMarkdownInputStore((s) => s.setBuffer);
    const updateSettings = useSettingsStore((s) => s.updateSettings);

    const fontFamily = useSettingsStore(
        (s) => s.settings?.editor?.fontFamily ?? DEFAULT_EDITOR_FONT_FAMILY,
    );
    const fontSize = useSettingsStore(
        (s) => s.settings?.editor?.fontSize ?? DEFAULT_EDITOR_FONT_SIZE,
    );

    const panelRef = useRef<HTMLDivElement>(null);
    const monacoRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const isDragging = useRef(false);
    const resizeEdge = useRef<ResizeEdge | null>(null);
    const dragOffset = useRef({ x: 0, y: 0 });
    const resizeOrigin = useRef({ x: 0, y: 0, w: 0, h: 0, px: 0, py: 0 });

    // Compute clamped position and size
    const containerRect = containerRef.current?.getBoundingClientRect();
    const maxW = (containerRect?.width ?? 600) - CONTAINER_PADDING * 2;
    const maxH = (containerRect?.height ?? 400) - CONTAINER_PADDING * 2;

    const width = Math.min(Math.max(globalSize?.width ?? DEFAULT_WIDTH, MIN_WIDTH), maxW);
    const height = Math.min(Math.max(globalSize?.height ?? DEFAULT_HEIGHT, MIN_HEIGHT), maxH);

    // Default position: bottom center
    const defaultX = Math.max(0, ((containerRect?.width ?? 600) - width) / 2);
    const defaultY = Math.max(0, (containerRect?.height ?? 400) - height - CONTAINER_PADDING);

    const rawX = globalPosition?.x ?? defaultX;
    const rawY = globalPosition?.y ?? defaultY;
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

            // Free Cmd+J so it bubbles to the app-level "New Agent" shortcut
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyJ, () => {});

            // Cmd+Shift+E to close editor
            editor.addCommand(
                monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE,
                () => {
                    onClose();
                },
            );

            // Defer focus so Monaco has a frame to fully render
            requestAnimationFrame(() => editor.focus());
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
            if (resizeEdge.current) return;
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
            setPosition({ x: clampedX, y: clampedY });
        };
        const onUp = () => {
            if (isDragging.current) {
                isDragging.current = false;
                const pos = useMarkdownInputStore.getState().position;
                if (pos) {
                    void updateSettings({
                        layout: { panels: { markdownEditorPosition: pos } },
                    });
                }
            }
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        return () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
        };
    }, [containerRef, width, height, setPosition, updateSettings]);

    // --- Resize handlers (all edges & corners) ---
    const handleResizeStart = useCallback(
        (edge: ResizeEdge) => (e: React.PointerEvent) => {
            resizeEdge.current = edge;
            resizeOrigin.current = { x, y, w: width, h: height, px: e.clientX, py: e.clientY };
            e.stopPropagation();
            e.preventDefault();
        },
        [x, y, width, height],
    );

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            const edge = resizeEdge.current;
            if (!edge) return;
            const containerR = containerRef.current?.getBoundingClientRect();
            if (!containerR) return;

            const { x: ox, y: oy, w: ow, h: oh, px, py } = resizeOrigin.current;
            const dx = e.clientX - px;
            const dy = e.clientY - py;

            let newX = ox;
            let newY = oy;
            let newW = ow;
            let newH = oh;

            // Horizontal
            if (edge.includes("e")) {
                newW = Math.min(Math.max(MIN_WIDTH, ow + dx), containerR.width - ox);
            }
            if (edge.includes("w")) {
                const maxDx = ow - MIN_WIDTH;
                const clampedDx = Math.min(Math.max(dx, -ox), maxDx);
                newX = ox + clampedDx;
                newW = ow - clampedDx;
            }

            // Vertical
            if (edge.includes("s")) {
                newH = Math.min(Math.max(MIN_HEIGHT, oh + dy), containerR.height - oy);
            }
            if (edge === "n" || edge === "ne" || edge === "nw") {
                const maxDy = oh - MIN_HEIGHT;
                const clampedDy = Math.min(Math.max(dy, -oy), maxDy);
                newY = oy + clampedDy;
                newH = oh - clampedDy;
            }

            setSize({ width: newW, height: newH });
            setPosition({ x: newX, y: newY });
        };
        const onUp = () => {
            if (resizeEdge.current) {
                resizeEdge.current = null;
                const state = useMarkdownInputStore.getState();
                if (state.size) {
                    void updateSettings({
                        layout: {
                            panels: {
                                markdownEditorSize: state.size,
                                markdownEditorPosition: state.position ?? undefined,
                            },
                        },
                    });
                }
            }
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        return () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
        };
    }, [containerRef, setSize, setPosition, updateSettings]);

    return (
        <div
            ref={panelRef}
            className="border-border bg-card absolute z-20 flex flex-col overflow-hidden rounded-2xl border shadow-lg"
            style={{ left: x, top: y, width, height }}>
            {/* Drag zone — top strip */}
            <div
                className="shrink-0 cursor-grab py-1.5 active:cursor-grabbing"
                onPointerDown={handleDragStart}
            />
            {/* Close button */}
            <button
                type="button"
                onClick={onClose}
                className="ring-offset-background focus:ring-ring absolute top-2 right-2 z-10 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
                <XIcon />
                <span className="sr-only">Close</span>
            </button>

            {/* Monaco editor area */}
            <div
                ref={editorContainerRef}
                className="min-h-0 flex-1 overflow-hidden px-3 [&_.monaco-editor]:!border-none [&_.monaco-editor]:!outline-none"
            />

            {/* Footer — same bg, no border */}
            <div className="flex shrink-0 items-center justify-between px-2.5 py-1.5">
                <span className="text-muted-foreground/30 font-sans text-[10px]">⌘⇧E</span>
                <div className="flex items-center gap-1.5">
                    <Button variant="secondary" size="xs" onClick={onInsert}>
                        Insert
                    </Button>
                    <Button size="xs" onClick={onSend}>
                        Send
                    </Button>
                </div>
            </div>

            {/* Resize edges */}
            <div
                className="absolute inset-x-2 top-0 h-1 cursor-ns-resize"
                onPointerDown={handleResizeStart("n")}
            />
            <div
                className="absolute inset-x-2 bottom-0 h-1 cursor-ns-resize"
                onPointerDown={handleResizeStart("s")}
            />
            <div
                className="absolute inset-y-2 left-0 w-1 cursor-ew-resize"
                onPointerDown={handleResizeStart("w")}
            />
            <div
                className="absolute inset-y-2 right-0 w-1 cursor-ew-resize"
                onPointerDown={handleResizeStart("e")}
            />
            {/* Resize corners */}
            <div
                className="absolute top-0 left-0 h-2 w-2 cursor-nwse-resize"
                onPointerDown={handleResizeStart("nw")}
            />
            <div
                className="absolute top-0 right-0 h-2 w-2 cursor-nesw-resize"
                onPointerDown={handleResizeStart("ne")}
            />
            <div
                className="absolute bottom-0 left-0 h-2 w-2 cursor-nesw-resize"
                onPointerDown={handleResizeStart("sw")}
            />
            <div
                className="absolute right-0 bottom-0 h-2 w-2 cursor-nwse-resize"
                onPointerDown={handleResizeStart("se")}
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
        toggle(sessionId);
    }, [sessionId, sendInput, clearBuffer, toggle]);

    const handleInsert = useCallback(() => {
        const buffer = getEditor(useMarkdownInputStore.getState(), sessionId).buffer;
        if (!buffer.trim()) return;
        sendInput(sessionId, buffer);
        clearBuffer(sessionId);
        toggle(sessionId);
    }, [sessionId, sendInput, clearBuffer, toggle]);

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
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            onClick={handleToggle}
                            className="border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground pointer-events-auto absolute right-3 bottom-3 flex h-8 w-8 items-center justify-center rounded-lg border shadow-md transition-colors">
                            <PenIcon />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="left">Input editor (⌘⇧E)</TooltipContent>
                </Tooltip>
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
            strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
        </svg>
    );
}

export { MarkdownInputHelper, AGENT_SESSION_TYPES };
