import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasAddon } from "@xterm/addon-canvas";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { onEvent, sendRequest } from "@/hooks/useWebSocket";
import { DEFAULT_TERMINAL_FONT_FAMILY, MSG } from "@taskflow/shared";
import type { TerminalOutputEvent, SessionExitedEvent, SessionHistoryResponse } from "@taskflow/shared";
import { cn } from "@/lib/utils";
import "@xterm/xterm/css/xterm.css";

const SHELL_UNSAFE = /[^a-zA-Z0-9_./:@=+-]/;

function shellQuote(path: string): string {
    if (!SHELL_UNSAFE.test(path)) return path;
    return `'${path.replace(/'/g, "'\\''")}'`;
}

interface TerminalPaneProps {
    taskId?: string;
    projectId?: string;
    sessionId: string;
    visible: boolean;
}

interface CachedTerminal {
    term: Terminal;
    fit: FitAddon;
    element: HTMLDivElement;
    unsubOutput: () => void;
    unsubExit: () => void;
    disposeRuntime: () => void;
}

interface BufferedTerminalChunk {
    data: string;
    sequence: number;
}

interface FitResult {
    measured: boolean;
    resized: boolean;
}

interface TerminalViewportSnapshot {
    distanceFromBottom: number;
}

/** Module-level cache: keeps xterm instances alive across task switches */
const terminalCache = new Map<string, CachedTerminal>();
const RESIZE_DEBOUNCE_MS = 250;

function fitTerminal(fit: FitAddon, term: Terminal, forceViewportRecalc = false): FitResult {
    const dims = fit.proposeDimensions();
    if (!dims || isNaN(dims.cols) || isNaN(dims.rows) || dims.cols < 2 || dims.rows < 1) {
        return { measured: false, resized: false };
    }

    const cols = Math.max(2, dims.cols);
    const rows = Math.max(1, dims.rows);
    const prevCols = term.cols;
    const prevRows = term.rows;
    const needsResize = prevCols !== cols || prevRows !== rows;
    if (needsResize) {
        term.resize(cols, rows);
    } else if (forceViewportRecalc) {
        // After DOM detach/reattach or display:none toggle, xterm's internal
        // viewport scroll height becomes stale. Force recalculation by cycling
        // through a different size.
        term.resize(cols + 1, rows);
        term.resize(cols, rows);
    }
    return { measured: true, resized: needsResize || forceViewportRecalc };
}

function refreshTerminal(term: Terminal): void {
    if (term.rows <= 0) return;
    term.refresh(0, term.rows - 1);
}

function captureViewport(term: Terminal): TerminalViewportSnapshot {
    const buffer = term.buffer.active;
    return {
        distanceFromBottom: Math.max(0, buffer.baseY - buffer.viewportY),
    };
}

function restoreViewport(term: Terminal, snapshot: TerminalViewportSnapshot): void {
    const buffer = term.buffer.active;
    const targetLine = Math.max(0, buffer.baseY - snapshot.distanceFromBottom);
    term.scrollToLine(targetLine);
}

function createTerminalWriter(term: Terminal): { write: (data: string) => void; dispose: () => void } {
    return {
        write(data) {
            if (!data) return;
            term.write(data);
        },
        dispose() {},
    };
}

function loadBestEffortRendererAddons(term: Terminal): () => void {
    const canvas = new CanvasAddon();
    term.loadAddon(canvas);

    let disposed = false;
    let cleanupWebgl: (() => void) | null = null;

    void import("@xterm/addon-webgl")
        .then(({ WebglAddon }) => {
            if (disposed) return;
            const addon = new WebglAddon();
            term.loadAddon(addon);
            const contextLossDisposable = addon.onContextLoss(() => {
                cleanupWebgl?.();
                cleanupWebgl = null;
            });
            cleanupWebgl = () => {
                contextLossDisposable.dispose();
                addon.dispose();
            };
        })
        .catch(() => {
            // Canvas remains the baseline renderer when WebGL is unavailable.
        });

    return () => {
        disposed = true;
        cleanupWebgl?.();
        cleanupWebgl = null;
        canvas.dispose();
    };
}

function getOrCreateTerminal(
    sessionId: string,
    taskId?: string,
    projectId?: string,
): CachedTerminal {
    const existing = terminalCache.get(sessionId);
    if (existing) return existing;

    const terminalSettings = useSettingsStore.getState().settings?.terminal;
    const term = new Terminal({
        theme: {
            background: "#1e1e2e",
            foreground: "#cdd6f4",
            cursor: "#f5e0dc",
            cursorAccent: "#1e1e2e",
            selectionBackground: "#45475a",
            black: "#45475a",
            red: "#f38ba8",
            green: "#a6e3a1",
            yellow: "#f9e2af",
            blue: "#89b4fa",
            magenta: "#cba6f7",
            cyan: "#94e2d5",
            white: "#bac2de",
            brightBlack: "#585b70",
            brightRed: "#f38ba8",
            brightGreen: "#a6e3a1",
            brightYellow: "#f9e2af",
            brightBlue: "#89b4fa",
            brightMagenta: "#cba6f7",
            brightCyan: "#94e2d5",
            brightWhite: "#a6adc8",
        },
        fontFamily: terminalSettings?.fontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY,
        fontSize: terminalSettings?.fontSize ?? 13,
        fontWeight: "normal",
        fontWeightBold: "bold",
        lineHeight: 1.0,
        letterSpacing: 0,
        scrollback: 10000,
        cursorBlink: true,
        allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    // Create a dedicated wrapper div that persists across mounts
    const element = document.createElement("div");
    element.style.width = "100%";
    element.style.height = "100%";
    term.open(element);

    // Renderer addons must load before Unicode (renderer initialization first)
    const disposeRendererAddons = loadBestEffortRendererAddons(term);

    // Unicode support loaded after renderer is ready (auto-activates '15-graphemes')
    term.loadAddon(new UnicodeGraphemesAddon());
    const writer = createTerminalWriter(term);

    // Buffer live output until history is loaded, then write directly
    const pendingData: BufferedTerminalChunk[] = [];
    let historyLoaded = false;

    const unsubOutput = onEvent(MSG.TERMINAL_OUTPUT, (payload) => {
        const event = payload as TerminalOutputEvent;
        if (event.sessionId === sessionId) {
            if (historyLoaded) {
                writer.write(event.data);
            } else {
                pendingData.push({ data: event.data, sequence: event.sequence });
            }
        }
    });

    const unsubExit = onEvent(MSG.SESSION_EXITED, (payload) => {
        const event = payload as SessionExitedEvent;
        if (event.sessionId === sessionId) {
            writer.write(`\r\n\x1b[90m[Process exited with code ${event.exitCode}]\x1b[0m\r\n`);
            // Don't destroy immediately — user may still want to scroll through output.
            // The cache entry will be cleaned up when the tab is closed (component unmounts
            // for the last time and closeTab calls destroyTerminal).
        }
    });

    // Replay scrollback then flush buffered live data
    sendRequest<SessionHistoryResponse>(MSG.SESSION_HISTORY, { taskId, projectId, sessionId })
        .then(({ data, lastSequence }) => {
            if (data) writer.write(data);
            historyLoaded = true;
            for (const chunk of pendingData) {
                if (chunk.sequence > lastSequence) writer.write(chunk.data);
            }
            pendingData.length = 0;
        })
        .catch(() => {
            historyLoaded = true;
            for (const chunk of pendingData) writer.write(chunk.data);
            pendingData.length = 0;
        });

    const cached: CachedTerminal = {
        term,
        fit,
        element,
        unsubOutput,
        unsubExit,
        disposeRuntime: () => {
            disposeRendererAddons();
            writer.dispose();
        },
    };
    terminalCache.set(sessionId, cached);
    return cached;
}

/** Remove a terminal from cache and dispose all resources */
function destroyTerminal(sessionId: string): void {
    const cached = terminalCache.get(sessionId);
    if (!cached) return;
    terminalCache.delete(sessionId);
    cached.unsubOutput();
    cached.unsubExit();
    cached.disposeRuntime();
    cached.element.remove();
    cached.term.dispose();
}

function TerminalPane({ taskId, projectId, sessionId, visible }: TerminalPaneProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const visibleRef = useRef(visible);
    const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const fitFrameRef = useRef<number | null>(null);
    const resizeDebounceTimeoutRef = useRef<number | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const dragCounterRef = useRef(0);
    const sendInput = useSessionStore((s) => s.sendInput);
    const resizeTerminal = useSessionStore((s) => s.resizeTerminal);

    useEffect(() => {
        visibleRef.current = visible;
    }, [visible]);

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
        (forceResize = false, focus = false, scrollToBottom = false, forceViewportRecalc = false, retries = 2) => {
            if (fitFrameRef.current !== null) {
                cancelAnimationFrame(fitFrameRef.current);
            }
            fitFrameRef.current = requestAnimationFrame(() => {
                fitFrameRef.current = null;
                if (!visibleRef.current || !fitRef.current || !termRef.current) return;
                const viewportSnapshot = scrollToBottom ? null : captureViewport(termRef.current);
                const fitResult = fitTerminal(fitRef.current, termRef.current, forceViewportRecalc);
                if (!fitResult.measured) {
                    if (retries > 0) {
                        scheduleFit(forceResize, focus, scrollToBottom, forceViewportRecalc, retries - 1);
                    } else if (focus && termRef.current) {
                        termRef.current.focus();
                    }
                    return;
                }

                sendResizeIfNeeded(forceResize || fitResult.resized);
                if (scrollToBottom) {
                    termRef.current.scrollToBottom();
                } else if (viewportSnapshot) {
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

        const cached = getOrCreateTerminal(sessionId, taskId, projectId);
        const { term, fit, element } = cached;

        termRef.current = term;
        fitRef.current = fit;

        // Attach the cached element into the container
        containerRef.current.appendChild(element);

        if (visible) {
            scheduleFit(true, true, true, true);
        }

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
            if (resizeDebounceTimeoutRef.current !== null) {
                window.clearTimeout(resizeDebounceTimeoutRef.current);
                resizeDebounceTimeoutRef.current = null;
            }
            // Detach from DOM but keep terminal alive in cache
            element.remove();
            termRef.current = null;
            fitRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- terminal setup should not re-run on visibility change
    }, [projectId, scheduleFit, scheduleResizeObserverFit, sessionId, taskId]);

    useEffect(() => {
        if (!visible || !termRef.current || !fitRef.current) return;
        // Force viewport recalculation: after display:none toggle or DOM
        // detach/reattach, xterm's scroll height is stale even if dimensions
        // haven't changed.
        scheduleFit(true, true, true, true);
    }, [visible, sessionId, scheduleFit]);

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

    const handleDragOver = useCallback((e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes("application/x-taskflow-path")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    }, []);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes("application/x-taskflow-path")) return;
        e.preventDefault();
        dragCounterRef.current++;
        setDragOver(true);
    }, []);

    const handleDragLeave = useCallback(() => {
        dragCounterRef.current--;
        if (dragCounterRef.current <= 0) {
            dragCounterRef.current = 0;
            setDragOver(false);
        }
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            dragCounterRef.current = 0;
            setDragOver(false);
            const path = e.dataTransfer.getData("text/plain");
            if (!path) return;
            sendInputRef.current(sessionId, shellQuote(path));
        },
        [sessionId],
    );

    return (
        <div
            ref={containerRef}
            className={cn("flex-1 overflow-hidden", dragOver && "ring-2 ring-primary/50 ring-inset")}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        />
    );
}

// eslint-disable-next-line react-refresh/only-export-components -- destroyTerminal manages the module-level terminal cache
export { TerminalPane, destroyTerminal };
