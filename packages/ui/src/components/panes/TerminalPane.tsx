import { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUIStore } from "@/stores/ui-store";
import { useMarkdownInputStore, getEditor } from "@/stores/markdown-input-store";
import { usePanelActivation } from "@/hooks/usePanelActivation";
import { cn } from "@/lib/utils";
import "@xterm/xterm/css/xterm.css";

import {
    terminalCache,
    getOrCreateTerminal,
    destroyTerminal,
    cancelDetach,
    scheduleDetach,
} from "./terminal/terminal-lifecycle";
import {
    shellQuote,
    fitTerminal,
    refreshTerminal,
    captureViewport,
    restoreViewport,
} from "./terminal/terminal-utils";
import { MarkdownInputHelper } from "./terminal/MarkdownInputHelper";
import { useTerminalModifierBlur } from "./terminal/useTerminalModifierBlur";
import type { Tab } from "@/stores/session-helpers";

const RESIZE_DEBOUNCE_MS = 250;

interface TerminalPaneProps {
    taskId?: string;
    projectId?: string;
    master?: boolean;
    sessionId: string;
    sessionType: Tab["type"];
    visible: boolean;
}

function TerminalPane({ taskId, projectId, master, sessionId, sessionType, visible }: TerminalPaneProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const visibleRef = useRef(visible);
    const sessionStatus = useSessionStore((s) => s.sessionStatus[sessionId]);
    const isInitializing = sessionStatus === "initializing";
    const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const fitFrameRef = useRef<number | null>(null);
    const fitRetryTimeoutRef = useRef<number | null>(null);
    const resizeDebounceTimeoutRef = useRef<number | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const dragCounterRef = useRef(0);
    const sendInput = useSessionStore((s) => s.sendInput);
    const resizeTerminal = useSessionStore((s) => s.resizeTerminal);
    const focusedPanel = useUIStore((s) => s.focusedPanel);

    // Stable callback for sendInput so we can use it in the data handler
    const sendInputRef = useRef(sendInput);
    sendInputRef.current = sendInput;

    const resizeTerminalRef = useRef(resizeTerminal);
    resizeTerminalRef.current = resizeTerminal;

    const sendResizeIfNeeded = useCallback(
        (force = false) => {
            const term = termRef.current;
            if (!term) return;
            const next = { cols: term.cols, rows: term.rows };
            const prev = lastSentSizeRef.current;
            if (!force && prev && prev.cols === next.cols && prev.rows === next.rows) return;
            lastSentSizeRef.current = next;
            resizeTerminalRef.current(sessionId, next.cols, next.rows);
        },
        [sessionId],
    );

    const scheduleFit = useCallback(
        (forceResize = false, focus = false, scrollToBottom = false, retries = 5) => {
            if (fitFrameRef.current !== null) {
                cancelAnimationFrame(fitFrameRef.current);
            }
            if (fitRetryTimeoutRef.current !== null) {
                window.clearTimeout(fitRetryTimeoutRef.current);
                fitRetryTimeoutRef.current = null;
            }
            fitFrameRef.current = requestAnimationFrame(() => {
                fitFrameRef.current = null;
                if (!visibleRef.current || !fitRef.current || !termRef.current) return;

                const viewportSnapshot = scrollToBottom ? null : captureViewport(termRef.current);
                const fitResult = fitTerminal(fitRef.current, termRef.current);
                if (!fitResult.measured) {
                    if (retries > 0) {
                        // Use setTimeout with backoff instead of rAF for retries.
                        // After off-screen→on-screen transitions the browser may
                        // need several layout passes before the container reports
                        // real dimensions to proposeDimensions().
                        const delay = Math.min(50 * Math.pow(2, 5 - retries), 400);
                        fitRetryTimeoutRef.current = window.setTimeout(() => {
                            fitRetryTimeoutRef.current = null;
                            scheduleFit(forceResize, focus, scrollToBottom, retries - 1);
                        }, delay);
                    } else if (focus && termRef.current) {
                        termRef.current.focus();
                    }
                    return;
                }

                sendResizeIfNeeded(forceResize || fitResult.resized);

                if (scrollToBottom) {
                    termRef.current.scrollToBottom();
                } else if (viewportSnapshot && fitResult.resized) {
                    restoreViewport(termRef.current, viewportSnapshot);
                }
                refreshTerminal(termRef.current);
                if (focus) termRef.current.focus();
            });
        },
        [sendResizeIfNeeded],
    );

    const scheduleResizeObserverFit = useCallback(() => {
        if (resizeDebounceTimeoutRef.current !== null) {
            window.clearTimeout(resizeDebounceTimeoutRef.current);
        }
        resizeDebounceTimeoutRef.current = window.setTimeout(() => {
            resizeDebounceTimeoutRef.current = null;
            scheduleFit();
        }, RESIZE_DEBOUNCE_MS);
    }, [scheduleFit]);

    useEffect(() => {
        if (!containerRef.current) return;

        // Cancel any pending detach from a previous unmount
        cancelDetach(sessionId);

        const cached = getOrCreateTerminal(sessionId, taskId, projectId, master);
        const { term, fit, element } = cached;
        cached.writer.visible = visible;

        termRef.current = term;
        fitRef.current = fit;

        // Attach the cached element into the container
        containerRef.current.appendChild(element);

        // Start restoring snapshot/history as soon as the terminal is attached.
        // Viewport preservation during subsequent fits handles reflow safely.
        void cached.ensureHistoryLoaded();

        if (visible) {
            // Preserve viewport on tab restore; initial history restore owns
            // its bottom position instead of fit forcing it.
            scheduleFit(true, focusedPanel === "workspace", false);
        }

        // Shift+Enter → send the same escape sequence as Alt+Enter (\x1b\r)
        // so Claude Code treats it as "newline without submit".
        term.attachCustomKeyEventHandler((event) => {
            if (event.shiftKey && event.key === "Enter") {
                if (event.type === "keydown") {
                    sendInputRef.current(sessionId, "\x1b\r");
                }
                return false; // prevent xterm default handling for all event phases
            }

            // ⌘⇧E — toggle markdown input helper
            if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "KeyE") {
                if (event.type === "keydown") {
                    useMarkdownInputStore.getState().toggle(sessionId);
                }
                return false;
            }

            // Let modifier keys bubble so usePanelNavigation can track Cmd/Shift state
            if (event.key === "Meta" || event.key === "Shift") return false;

            // Let Cmd+digit bubble for number navigation (tab/sidebar switching)
            if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) return false;

            // Let Cmd+Arrow bubble for sidebar/panel navigation
            if ((event.metaKey || event.ctrlKey) && /^Arrow(Up|Down|Left|Right)$/.test(event.key))
                return false;

            // Let Cmd+/ bubble for keyboard shortcuts dialog
            if ((event.metaKey || event.ctrlKey) && event.key === "/") return false;

            return true;
        });

        // User input: only active while mounted
        const dataDisposable = term.onData((data) => {
            sendInputRef.current(sessionId, data);
        });

        // Debounce resize observer churn so PTY size only updates after layout settles.
        const resizeObserver = new ResizeObserver(() => {
            if (!visibleRef.current) return;
            scheduleResizeObserverFit();
        });
        resizeObserver.observe(containerRef.current);

        return () => {
            resizeObserver.disconnect();
            dataDisposable.dispose();
            if (fitFrameRef.current !== null) {
                cancelAnimationFrame(fitFrameRef.current);
                fitFrameRef.current = null;
            }
            if (fitRetryTimeoutRef.current !== null) {
                window.clearTimeout(fitRetryTimeoutRef.current);
                fitRetryTimeoutRef.current = null;
            }
            if (resizeDebounceTimeoutRef.current !== null) {
                window.clearTimeout(resizeDebounceTimeoutRef.current);
                resizeDebounceTimeoutRef.current = null;
            }
            // Schedule delayed destruction instead of immediate teardown.
            // If the terminal remounts within DETACH_GRACE_MS (e.g., rapid
            // tab switch), the pending detach is cancelled and the cached
            // instance is reused.
            scheduleDetach(sessionId);
            termRef.current = null;
            fitRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- terminal setup should not re-run on visibility change
    }, [focusedPanel, projectId, scheduleFit, scheduleResizeObserverFit, sessionId, taskId]);

    useEffect(() => {
        visibleRef.current = visible;
        const cached = terminalCache.get(sessionId);
        if (cached) {
            cached.writer.visible = visible;
        }
    }, [sessionId, visible]);

    useEffect(() => {
        if (!visible || !termRef.current || !fitRef.current) return;
        // Force viewport recalculation when becoming visible.
        // Don't force scrollToBottom — preserve the user's scroll position.
        // Skip focus during navigation mode — usePanelActivation handles that.
        const shouldFocus = focusedPanel === "workspace" && !useUIStore.getState().navigationMode;
        scheduleFit(true, shouldFocus, false);
    }, [focusedPanel, visible, sessionId, scheduleFit]);

    // Dedicated focus effect — independent of fit/resize logic.
    // Uses rAF for fast path + bounded retry loop as fallback for cases
    // where the terminal element isn't ready yet (freshly mounted, layout pending).
    useEffect(() => {
        if (!visible || focusedPanel !== "workspace") return;
        // Skip during navigation mode — usePanelActivation handles deferred focus.
        if (useUIStore.getState().navigationMode) return;

        let cancelled = false;
        let attempts = 0;
        const MAX_ATTEMPTS = 10;
        const ATTEMPT_INTERVAL = 50;

        function tryFocus() {
            if (cancelled) return;
            const editorOpen = getEditor(
                useMarkdownInputStore.getState(),
                sessionId,
            ).isOpen;
            if (editorOpen) return;
            attempts++;
            const term = termRef.current;
            if (term) {
                term.focus();
                return;
            }
            if (attempts < MAX_ATTEMPTS) {
                setTimeout(tryFocus, ATTEMPT_INTERVAL);
            }
        }

        const rafId = requestAnimationFrame(tryFocus);

        return () => {
            cancelled = true;
            cancelAnimationFrame(rafId);
        };
    }, [focusedPanel, visible, sessionId]);

    // Panel activation: focus terminal (or markdown editor) when navigation mode ends.
    usePanelActivation(
        "workspace",
        useCallback(() => {
            if (!visible) return;
            const editorOpen = getEditor(useMarkdownInputStore.getState(), sessionId).isOpen;
            if (editorOpen) return; // markdown editor keeps its own focus
            termRef.current?.focus();
        }, [visible, sessionId]),
    );

    // Blur xterm during Cmd+Shift so modifier events bubble to global handlers.
    useTerminalModifierBlur(containerRef, termRef, sessionId, visible);

    const terminalFontFamily = useSettingsStore((s) => s.settings?.terminal?.fontFamily);
    const terminalFontSize = useSettingsStore((s) => s.settings?.terminal?.fontSize);

    useEffect(() => {
        const cached = terminalCache.get(sessionId);
        if (!cached || terminalFontFamily === undefined || terminalFontSize === undefined) return;
        cached.term.options.fontFamily = terminalFontFamily;
        cached.term.options.fontSize = terminalFontSize;
        if (visible) {
            scheduleFit(true);
        }
    }, [sessionId, scheduleFit, terminalFontFamily, terminalFontSize, visible]);

    useEffect(() => {
        if (typeof document === "undefined" || !("fonts" in document)) return;

        const handleFontMetricsChange = () => {
            if (!visibleRef.current) return;
            scheduleFit(true);
        };

        void document.fonts.ready.then(handleFontMetricsChange);
        document.fonts.addEventListener("loadingdone", handleFontMetricsChange);

        return () => {
            document.fonts.removeEventListener("loadingdone", handleFontMetricsChange);
        };
    }, [scheduleFit]);

    const handleContainerClick = useCallback(() => {
        termRef.current?.focus();
    }, []);

    useEffect(() => {
        const id = sessionId;
        return () => {
            // If the terminal cache no longer has this session after the detach
            // grace period, clean up the markdown input state.
            window.setTimeout(() => {
                if (!terminalCache.has(id)) {
                    useMarkdownInputStore.getState().cleanup(id);
                }
            }, 100);
        };
    }, [sessionId]);

    // Native drag-and-drop listeners attached in capture phase so they fire
    // before xterm.js's internal DOM elements can intercept the events.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        function isAcceptableDrag(e: DragEvent) {
            if (!e.dataTransfer) return false;
            const types = Array.from(e.dataTransfer.types);
            return (
                types.includes("application/x-taskflow-path") ||
                types.includes("Files") ||
                types.includes("text/uri-list") ||
                types.includes("text/plain")
            );
        }

        function onDragOver(e: DragEvent) {
            if (!isAcceptableDrag(e)) {
                console.debug("[drop] dragover rejected, types:", e.dataTransfer?.types);
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        }

        function onDragEnter(e: DragEvent) {
            if (!isAcceptableDrag(e)) return;
            e.preventDefault();
            e.stopPropagation();
            dragCounterRef.current++;
            setDragOver(true);
        }

        function onDragLeave(e: DragEvent) {
            e.stopPropagation();
            dragCounterRef.current--;
            if (dragCounterRef.current <= 0) {
                dragCounterRef.current = 0;
                setDragOver(false);
            }
        }

        function onDrop(e: DragEvent) {
            e.preventDefault();
            e.stopPropagation();
            dragCounterRef.current = 0;
            setDragOver(false);

            if (!e.dataTransfer) return;

            const types = Array.from(e.dataTransfer.types);
            console.debug("[drop] drop event, types:", types);

            // Internal file tree drop
            const taskflowPath = e.dataTransfer.getData("application/x-taskflow-path");
            if (taskflowPath) {
                console.debug("[drop] taskflow path:", taskflowPath);
                sendInputRef.current(sessionId, shellQuote(taskflowPath));
                return;
            }

            // Native file drop (Finder / OS file manager)
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const paths: string[] = [];
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const filePath = window.taskflow?.getPathForFile(file) ?? "";
                    console.debug("[drop] file:", file.name, "path:", filePath);
                    if (filePath) paths.push(shellQuote(filePath));
                }
                if (paths.length > 0) {
                    console.debug("[drop] sending paths:", paths);
                    sendInputRef.current(sessionId, paths.join(" "));
                }
                return;
            }

            // Fallback: URI list (macOS Finder sometimes uses this)
            const uriList = e.dataTransfer.getData("text/uri-list");
            if (uriList) {
                const filePaths = uriList
                    .split("\n")
                    .filter((line) => line.startsWith("file://"))
                    .map((uri) => decodeURIComponent(new URL(uri).pathname));
                if (filePaths.length > 0) {
                    console.debug("[drop] uri-list paths:", filePaths);
                    sendInputRef.current(sessionId, filePaths.map(shellQuote).join(" "));
                    return;
                }
            }

            // Fallback: plain text
            const plainText = e.dataTransfer.getData("text/plain");
            if (plainText) {
                console.debug("[drop] plain text:", plainText);
                sendInputRef.current(sessionId, shellQuote(plainText));
            }
        }

        const opts = { capture: true };
        container.addEventListener("dragover", onDragOver, opts);
        container.addEventListener("dragenter", onDragEnter, opts);
        container.addEventListener("dragleave", onDragLeave, opts);
        container.addEventListener("drop", onDrop, opts);

        return () => {
            container.removeEventListener("dragover", onDragOver, opts);
            container.removeEventListener("dragenter", onDragEnter, opts);
            container.removeEventListener("dragleave", onDragLeave, opts);
            container.removeEventListener("drop", onDrop, opts);
        };
    }, [sessionId]);

    return (
        <div className="bg-card relative flex-1 overflow-hidden p-3">
            <div
                ref={containerRef}
                className={cn(
                    "h-full overflow-hidden",
                    dragOver && "ring-primary/50 ring-2 ring-inset",
                )}
                style={{ overflowAnchor: "none" }}
                onClick={handleContainerClick}
            />
            {isInitializing && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                        <div className="border-muted-foreground h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
                        <span className="text-muted-foreground text-sm">Starting agent...</span>
                    </div>
                </div>
            )}
            <MarkdownInputHelper sessionId={sessionId} sessionType={sessionType} />
        </div>
    );
}

// eslint-disable-next-line react-refresh/only-export-components -- destroyTerminal manages the module-level terminal cache
export { TerminalPane, destroyTerminal };
