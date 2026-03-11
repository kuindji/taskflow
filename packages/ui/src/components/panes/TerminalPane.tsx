import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
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
    taskId: string;
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

/** Module-level cache: keeps xterm instances alive across task switches */
const terminalCache = new Map<string, CachedTerminal>();

function fitTerminal(fit: FitAddon, term: Terminal): FitResult {
    const dims = fit.proposeDimensions();
    if (!dims || isNaN(dims.cols) || isNaN(dims.rows) || dims.cols < 2 || dims.rows < 1) {
        return { measured: false, resized: false };
    }

    const cols = Math.max(2, dims.cols);
    const rows = Math.max(1, dims.rows);
    const prevCols = term.cols;
    const prevRows = term.rows;
    if (prevCols !== cols || prevRows !== rows) {
        term.resize(cols, rows);
    }
    return { measured: true, resized: cols !== prevCols || rows !== prevRows };
}

function refreshTerminal(term: Terminal): void {
    if (term.rows <= 0) return;
    term.refresh(0, term.rows - 1);
}

function createBufferedWriter(term: Terminal): { write: (data: string) => void; dispose: () => void } {
    let frameId: number | null = null;
    const chunks: string[] = [];

    const flush = () => {
        frameId = null;
        if (chunks.length === 0) return;
        term.write(chunks.join(""));
        chunks.length = 0;
    };

    return {
        write(data) {
            if (!data) return;
            chunks.push(data);
            if (frameId !== null) return;
            frameId = window.requestAnimationFrame(flush);
        },
        dispose() {
            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
                frameId = null;
            }
            chunks.length = 0;
        },
    };
}

function loadBestEffortWebglAddon(term: Terminal): () => void {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    void import("@xterm/addon-webgl")
        .then(({ WebglAddon }) => {
            if (disposed) return;
            const addon = new WebglAddon();
            term.loadAddon(addon);
            const contextLossDisposable = addon.onContextLoss(() => {
                cleanup?.();
                cleanup = null;
            });
            cleanup = () => {
                contextLossDisposable.dispose();
                addon.dispose();
            };
        })
        .catch(() => {
            // Canvas renderer remains the fallback when WebGL is unavailable.
        });

    return () => {
        disposed = true;
        cleanup?.();
        cleanup = null;
    };
}

function getOrCreateTerminal(taskId: string, sessionId: string): CachedTerminal {
    const existing = terminalCache.get(sessionId);
    if (existing) return existing;

    const terminalSettings = useSettingsStore.getState().settings?.terminal;
    const term = new Terminal({
        theme: {
            background: "#1e1e2e",
            foreground: "#cdd6f4",
            cursor: "#f5e0dc",
            selectionBackground: "#45475a",
            black: "#45475a",
            red: "#f38ba8",
            green: "#a6e3a1",
            yellow: "#f9e2af",
            blue: "#89b4fa",
            magenta: "#cba6f7",
            cyan: "#94e2d5",
            white: "#bac2de",
        },
        fontFamily: terminalSettings?.fontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY,
        fontSize: terminalSettings?.fontSize ?? 13,
        cursorBlink: true,
        allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    const unicode = new Unicode11Addon();
    term.loadAddon(unicode);
    term.unicode.activeVersion = "11";
    term.loadAddon(new WebLinksAddon());

    // Create a dedicated wrapper div that persists across mounts
    const element = document.createElement("div");
    element.style.width = "100%";
    element.style.height = "100%";
    term.open(element);
    const disposeWebgl = loadBestEffortWebglAddon(term);
    const writer = createBufferedWriter(term);

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
    sendRequest<SessionHistoryResponse>(MSG.SESSION_HISTORY, { taskId, sessionId })
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
            disposeWebgl();
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

function TerminalPane({ taskId, sessionId, visible }: TerminalPaneProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const visibleRef = useRef(visible);
    const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const resizeFrameRef = useRef<number | null>(null);
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
        (forceResize = false, focus = false, scrollToBottom = false, retries = 2) => {
            if (resizeFrameRef.current !== null) {
                cancelAnimationFrame(resizeFrameRef.current);
            }
            resizeFrameRef.current = requestAnimationFrame(() => {
                resizeFrameRef.current = null;
                if (!visibleRef.current || !fitRef.current || !termRef.current) return;
                const fitResult = fitTerminal(fitRef.current, termRef.current);
                if (!fitResult.measured) {
                    if (retries > 0) {
                        scheduleFit(forceResize, focus, scrollToBottom, retries - 1);
                    }
                    return;
                }

                sendResizeIfNeeded(forceResize || fitResult.resized);
                if (scrollToBottom) {
                    termRef.current.scrollToBottom();
                }
                refreshTerminal(termRef.current);
                if (focus) termRef.current.focus();
            });
        },
        [sendResizeIfNeeded],
    );

    useEffect(() => {
        if (!containerRef.current) return;

        const cached = getOrCreateTerminal(taskId, sessionId);
        const { term, fit, element } = cached;

        termRef.current = term;
        fitRef.current = fit;

        // Attach the cached element into the container
        containerRef.current.appendChild(element);

        if (visible) {
            scheduleFit(true, false, true);
        }

        // User input: only active while mounted
        const dataDisposable = term.onData((data) => {
            sendInputRef.current(sessionId, data);
        });

        // Resize on container resize, but coalesce rapid layout changes into one frame.
        const resizeObserver = new ResizeObserver(() => {
            if (!visibleRef.current) return;
            scheduleFit();
        });
        resizeObserver.observe(containerRef.current);

        return () => {
            resizeObserver.disconnect();
            dataDisposable.dispose();
            if (resizeFrameRef.current !== null) {
                cancelAnimationFrame(resizeFrameRef.current);
                resizeFrameRef.current = null;
            }
            // Detach from DOM but keep terminal alive in cache
            element.remove();
            termRef.current = null;
            fitRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- terminal setup should not re-run on visibility change
    }, [scheduleFit, sessionId, taskId]);

    useEffect(() => {
        if (!visible || !termRef.current || !fitRef.current) return;
        // Defer fit until the browser has painted the now-visible container,
        // otherwise FitAddon measures zero dimensions from display:none.
        scheduleFit(true, true, true);
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

export { TerminalPane, destroyTerminal };
