import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasAddon } from "@xterm/addon-canvas";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getTaskWorkspaceKey, getProjectWorkspaceKey } from "@/hooks/useActiveWorkspace";
import { onEvent, sendRequest } from "@/hooks/useWebSocket";
import { DEFAULT_TERMINAL_FONT_FAMILY, MSG } from "@taskflow/shared";
import type {
    TerminalOutputEvent,
    SessionExitedEvent,
    SessionHistoryResponse,
    FileStatResponse,
} from "@taskflow/shared";
import { useTaskStore } from "@/stores/task-store";
import { useProjectStore } from "@/stores/project-store";
import { useFileStore } from "@/stores/file-store";
import { useUIStore } from "@/stores/ui-store";
import type { IBufferLine, ILink, ILinkProvider } from "@xterm/xterm";
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

/** Module-level cache: keeps one xterm instance per mounted terminal tab. */
const terminalCache = new Map<string, CachedTerminal>();
const RESIZE_DEBOUNCE_MS = 250;

// ─── Link handling ───────────────────────────────────────────────────────────

function getWorkspaceKey(taskId?: string, projectId?: string): string | null {
    if (taskId) return getTaskWorkspaceKey(taskId);
    if (projectId) return getProjectWorkspaceKey(projectId);
    return null;
}

function getWorkingDir(taskId?: string, projectId?: string): string | null {
    if (taskId) {
        const task = useTaskStore.getState().tasks.find((t) => t.id === taskId);
        if (!task) return null;
        const project = useProjectStore.getState().projects.find((p) => p.id === task.projectId);
        if (!project) return null;
        return task.worktree.enabled && task.worktree.path ? task.worktree.path : project.path;
    }
    if (projectId) {
        const project = useProjectStore.getState().projects.find((p) => p.id === projectId);
        return project?.path ?? null;
    }
    return null;
}

function openUrlInApp(url: string, workspaceKey: string | null) {
    if (!workspaceKey) return;
    const store = useSessionStore.getState();
    const existingTabs = store.tabsByWorkspace[workspaceKey] ?? [];
    const existing = existingTabs.find((t) => t.type === "browser" && t.url === url);
    if (existing) {
        store.setActiveTab(workspaceKey, existing.id);
        return;
    }
    let label = url;
    try {
        const parsed = new URL(url);
        label = parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "");
    } catch {
        /* keep raw url as label */
    }
    store.addTab(workspaceKey, {
        id: crypto.randomUUID(),
        type: "browser",
        label,
        url,
    });
}

function openFileInApp(filePath: string, workspaceKey: string | null) {
    if (!workspaceKey) return;
    const store = useSessionStore.getState();
    const existingTabs = store.tabsByWorkspace[workspaceKey] ?? [];
    const existing = existingTabs.find((t) => t.type === "editor" && t.filePath === filePath);
    if (existing) {
        store.setActiveTab(workspaceKey, existing.id);
        return;
    }
    const label = filePath.split("/").pop() ?? filePath;
    store.addTab(workspaceKey, {
        id: crypto.randomUUID(),
        type: "editor",
        label,
        filePath,
    });
}

function openExternalUrl(url: string) {
    if (window.taskflow) {
        void window.taskflow.openExternalUrl(url);
    } else {
        window.open(url, "_blank");
    }
}

function openExternalFile(filePath: string, opts?: { line?: number; col?: number }) {
    if (window.taskflow) {
        const editor = useSettingsStore.getState().settings?.general.externalEditor;
        void window.taskflow.openExternalFile(filePath, { ...opts, editor });
    }
}

function createWebLinkHandler(taskId?: string, projectId?: string) {
    const workspaceKey = getWorkspaceKey(taskId, projectId);
    return (event: MouseEvent, uri: string) => {
        if (event.metaKey || event.ctrlKey) {
            openExternalUrl(uri);
        } else {
            openUrlInApp(uri, workspaceKey);
        }
    };
}

// ─── File path link provider ─────────────────────────────────────────────────

// Absolute: /path/to/file with optional :line:col
const ABS_PATH_RE = /(?<![/\w.@+-])(\/[\w.@+-]+(?:\/[\w.@+-]*)*(?::(\d+)(?::(\d+))?)?)/g;

// Relative: dir/file or ./dir/file with optional :line:col
// Must contain at least one "/". False positives (e.g., "yes/no") are acceptable
// because the file:stat check at click time gracefully handles non-existent paths.
const REL_PATH_RE =
    /(?<![/\w.@+-])((?:\.\.?\/)?[\w.@+-]+\/[\w.@+\-/]*[\w.@+-](?::(\d+)(?::(\d+))?)?)/g;

/** Collapse `.` and `..` segments in an absolute path without filesystem I/O. */
function normalizePath(absolute: string): string {
    const parts = absolute.split("/");
    const stack: string[] = [];
    for (const p of parts) {
        if (p === "..") stack.pop();
        else if (p && p !== ".") stack.push(p);
    }
    return "/" + stack.join("/");
}

function resolvePath(raw: string, workingDir: string | null): string | null {
    if (!raw) return null;
    const pathOnly = raw.replace(/:\d+(?::\d+)?$/, "");
    if (pathOnly.startsWith("/")) {
        // Absolute: must be within workingDir
        if (!workingDir) return null;
        if (pathOnly !== workingDir && !pathOnly.startsWith(workingDir + "/")) {
            return null;
        }
        return pathOnly;
    }
    // Relative: resolve against workingDir
    if (!workingDir) return null;
    const normalized = normalizePath(workingDir + "/" + pathOnly);
    // Reject paths that escape workingDir via ../
    if (normalized !== workingDir && !normalized.startsWith(workingDir + "/")) {
        return null;
    }
    return normalized;
}

/**
 * Build a mapping from string character index (as returned by translateToString)
 * to buffer cell column. Needed because wide chars, combining marks, and surrogate
 * pairs cause string indices to diverge from cell positions.
 */
function buildCellMapping(line: IBufferLine): number[] {
    const mapping: number[] = [];
    for (let col = 0; col < line.length; col++) {
        const cell = line.getCell(col);
        if (!cell) break;
        const width = cell.getWidth();
        if (width === 0) continue; // continuation cell of a wide char
        const chars = cell.getChars();
        const len = chars.length || 1;
        for (let i = 0; i < len; i++) {
            mapping.push(col);
        }
    }
    return mapping;
}

function createFilePathLinkProvider(
    term: Terminal,
    taskId?: string,
    projectId?: string,
): ILinkProvider {
    const workspaceKey = getWorkspaceKey(taskId, projectId);

    return {
        provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
            const line = term.buffer.active.getLine(bufferLineNumber - 1);
            if (!line) {
                callback(undefined);
                return;
            }

            const workingDir = getWorkingDir(taskId, projectId);
            const lineText = line.translateToString(true);
            const cellMap = buildCellMapping(line);
            const links: ILink[] = [];
            const seen = new Set<string>();

            for (const re of [ABS_PATH_RE, REL_PATH_RE]) {
                re.lastIndex = 0;
                let match: RegExpExecArray | null;
                while ((match = re.exec(lineText)) !== null) {
                    const fullMatch = match[1];
                    const matchIndex = match.index + (match[0].length - fullMatch.length);

                    // Deduplicate overlapping matches
                    const key = `${matchIndex}:${fullMatch.length}`;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    const resolved = resolvePath(fullMatch, workingDir);
                    if (!resolved) continue;

                    // Map string indices to buffer cell positions (1-based, end exclusive)
                    const startCol = (cellMap[matchIndex] ?? matchIndex) + 1;
                    const lastCharIdx = matchIndex + fullMatch.length - 1;
                    const endCol = (cellMap[lastCharIdx] ?? lastCharIdx) + 2;

                    links.push({
                        range: {
                            start: { x: startCol, y: bufferLineNumber },
                            end: { x: endCol, y: bufferLineNumber },
                        },
                        text: fullMatch,
                        activate(event: MouseEvent, text: string) {
                            void handlePathActivation(text, workingDir, workspaceKey, event);
                        },
                    });
                }
            }

            callback(links.length > 0 ? links : undefined);
        },
    };
}

async function handlePathActivation(
    text: string,
    workingDir: string | null,
    workspaceKey: string | null,
    event: MouseEvent,
): Promise<void> {
    const resolved = resolvePath(text, workingDir);
    if (!resolved) return;

    const lineMatch = text.match(/:(\d+)(?::(\d+))?$/);
    const line = lineMatch?.[1] ? Number(lineMatch[1]) : undefined;
    const col = lineMatch?.[2] ? Number(lineMatch[2]) : undefined;

    let stat: FileStatResponse;
    try {
        stat = await sendRequest<FileStatResponse>(MSG.FILE_STAT, { path: resolved });
    } catch {
        return;
    }
    if (!stat.exists) return;

    const isExternal = event.metaKey || event.ctrlKey;

    if (stat.isDirectory) {
        if (isExternal) {
            window.taskflow?.showItemInFolder(resolved);
        } else {
            useFileStore.getState().setExpandToPath(resolved);
            if (!useUIStore.getState().fileExplorerOpen) {
                useUIStore.getState().toggleFileExplorer();
            }
        }
    } else {
        if (isExternal) {
            openExternalFile(resolved, { line, col });
        } else {
            openFileInApp(resolved, workspaceKey);
        }
    }
}

function fitTerminal(fit: FitAddon, term: Terminal): FitResult {
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
    }
    return { measured: true, resized: needsResize };
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

function createTerminalWriter(term: Terminal): {
    write: (data: string) => void;
    dispose: () => void;
} {
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

function getCssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getTerminalTheme(): Record<string, string> {
    return {
        background: getCssVar("--card"),
        foreground: getCssVar("--foreground"),
        cursor: "#f5e0dc",
        cursorAccent: getCssVar("--card"),
        selectionBackground: getCssVar("--muted"),
        black: getCssVar("--muted"),
        red: getCssVar("--destructive"),
        green: getCssVar("--success"),
        yellow: getCssVar("--warning"),
        blue: getCssVar("--accent"),
        magenta: "#cba6f7",
        cyan: "#94e2d5",
        white: "#bac2de",
        brightBlack: getCssVar("--muted-foreground"),
        brightRed: getCssVar("--destructive"),
        brightGreen: getCssVar("--success"),
        brightYellow: getCssVar("--warning"),
        brightBlue: getCssVar("--accent"),
        brightMagenta: "#cba6f7",
        brightCyan: "#94e2d5",
        brightWhite: "#a6adc8",
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
        theme: getTerminalTheme(),
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
    term.loadAddon(new WebLinksAddon(createWebLinkHandler(taskId, projectId)));

    // Create a dedicated wrapper div that persists across mounts
    const element = document.createElement("div");
    element.style.width = "100%";
    element.style.height = "100%";
    term.open(element);

    // File path link provider (registered after open so buffer is available)
    const filePathLinkDisposable = term.registerLinkProvider(
        createFilePathLinkProvider(term, taskId, projectId),
    );

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
            filePathLinkDisposable.dispose();
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
        (forceResize = false, focus = false, scrollToBottom = false, retries = 2) => {
            if (fitFrameRef.current !== null) {
                cancelAnimationFrame(fitFrameRef.current);
            }
            fitFrameRef.current = requestAnimationFrame(() => {
                fitFrameRef.current = null;
                if (!visibleRef.current || !fitRef.current || !termRef.current) return;

                const viewportSnapshot = scrollToBottom ? null : captureViewport(termRef.current);
                const fitResult = fitTerminal(fitRef.current, termRef.current);
                if (!fitResult.measured) {
                    if (retries > 0) {
                        scheduleFit(forceResize, focus, scrollToBottom, retries - 1);
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
            scheduleFit(true, true, true);
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
            if (resizeDebounceTimeoutRef.current !== null) {
                window.clearTimeout(resizeDebounceTimeoutRef.current);
                resizeDebounceTimeoutRef.current = null;
            }
            // Workspace switches unmount the pane completely. Rebuild the
            // terminal UI from backend history on return instead of reusing a
            // detached xterm viewport whose scroll state can go stale.
            destroyTerminal(sessionId);
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
        scheduleFit(true, true, true);
    }, [visible, sessionId, scheduleFit]);

    // Dedicated focus effect — independent of fit/resize logic.
    // Uses rAF for fast path + bounded retry loop as fallback for cases
    // where the terminal element isn't ready yet (freshly mounted, layout pending).
    useEffect(() => {
        if (!visible) return;

        let cancelled = false;
        let attempts = 0;
        const MAX_ATTEMPTS = 10;
        const ATTEMPT_INTERVAL = 50;

        function tryFocus() {
            if (cancelled) return;
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
    }, [visible, sessionId]);

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
                    const file = files[i] as File & { path?: string };
                    console.debug("[drop] file:", file.name, "path:", file.path);
                    if (file.path) paths.push(shellQuote(file.path));
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
        <div
            ref={containerRef}
            className={cn(
                "flex-1 overflow-hidden",
                dragOver && "ring-primary/50 ring-2 ring-inset",
            )}
            onClick={handleContainerClick}
        />
    );
}

// eslint-disable-next-line react-refresh/only-export-components -- destroyTerminal manages the module-level terminal cache
export { TerminalPane, destroyTerminal };
