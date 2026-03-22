import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasAddon } from "@xterm/addon-canvas";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useSessionStore } from "@/stores/session-store";
import type { Tab } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getTaskWorkspaceKey, getProjectWorkspaceKey } from "@/hooks/useActiveWorkspace";
import { onEvent, sendRequest } from "@/hooks/useWebSocket";
import { DEFAULT_TERMINAL_FONT_FAMILY, MSG, TERMINAL_SCROLLBACK } from "@taskflow/shared";
import type {
    TerminalOutputEvent,
    SessionExitedEvent,
    SessionHistoryResponse,
    SessionSnapshotResponse,
    FileStatResponse,
    XtermTheme,
} from "@taskflow/shared";
import { useTaskStore } from "@/stores/task-store";
import { useProjectStore } from "@/stores/project-store";
import { useFileStore } from "@/stores/file-store";
import { useUIStore } from "@/stores/ui-store";
import { useThemeStore } from "@/stores/theme-store";
import type { IBufferLine, ILink, ILinkProvider } from "@xterm/xterm";
import { cn } from "@/lib/utils";
import { middleTruncate } from "@/lib/middle-truncate";
import { TimeBudgetedWriter } from "@/lib/time-budgeted-writer";
import { captureTerminalViewport, getRestoreViewportLine } from "@/lib/terminal-viewport";
import "@xterm/xterm/css/xterm.css";

const SHELL_UNSAFE = /[^a-zA-Z0-9_./:@=+-]/;

function shellQuote(path: string): string {
    if (!SHELL_UNSAFE.test(path)) return path;
    return `'${path.replace(/'/g, "'\\''")}'`;
}

interface TerminalPaneProps {
    taskId?: string;
    projectId?: string;
    master?: boolean;
    sessionId: string;
    visible: boolean;
}

interface CachedTerminal {
    term: Terminal;
    fit: FitAddon;
    writer: TimeBudgetedWriter;
    element: HTMLDivElement;
    unsubOutput: () => void;
    unsubExit: () => void;
    ensureHistoryLoaded: () => Promise<void>;
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

import { openFileInApp } from "@/lib/open-file";

/** Module-level cache: keeps one xterm instance per mounted terminal tab. */
const terminalCache = new Map<string, CachedTerminal>();
const RESIZE_DEBOUNCE_MS = 250;

/** Pending delayed destructions — cancelled if terminal remounts within the grace period. */
const pendingDetaches = new Map<string, ReturnType<typeof setTimeout>>();
const DETACH_GRACE_MS = 50;
const SHELL_TITLE_MAX_LEN = 30;

function findTabForSession(sessionId: string): { workspaceKey: string; tab: Tab } | undefined {
    const store = useSessionStore.getState();
    for (const [workspaceKey, tabs] of Object.entries(store.tabsByWorkspace)) {
        const tab = tabs.find((t) => t.sessionId === sessionId);
        if (tab) return { workspaceKey, tab };
    }
    return undefined;
}

function applyThemeToCachedTerminal(cached: CachedTerminal, theme: XtermTheme): void {
    cached.term.options.theme = { ...theme };
    refreshTerminal(cached.term);
}

// Single module-level subscription: re-theme all cached terminals when the resolved theme changes.
useThemeStore.subscribe((state, prevState) => {
    if (state.resolved === prevState.resolved) return;
    for (const [, cached] of terminalCache) {
        applyThemeToCachedTerminal(cached, state.resolved.xterm);
    }
});

// ─── Link handling ───────────────────────────────────────────────────────────

function getWorkspaceKey(taskId?: string, projectId?: string, master?: boolean): string | null {
    if (taskId) return getTaskWorkspaceKey(taskId);
    if (projectId) return getProjectWorkspaceKey(projectId);
    if (master) return "master";
    return null;
}

function getWorkingDir(taskId?: string, projectId?: string, master?: boolean): string | null {
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
    if (master) {
        return null;
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

function openExternalUrl(url: string) {
    if (window.taskflow) {
        void window.taskflow.openExternalUrl(url);
    } else {
        window.open(url, "_blank");
    }
}

function openExternalFile(filePath: string, opts?: { line?: number; col?: number }) {
    if (window.taskflow) {
        const editor = useSettingsStore.getState().settings?.editor.externalEditor;
        void window.taskflow.openExternalFile(filePath, { ...opts, editor });
    }
}

function createWebLinkHandler(taskId?: string, projectId?: string, master?: boolean) {
    const workspaceKey = getWorkspaceKey(taskId, projectId, master);
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

// Bare filenames: dotfiles (.gitignore, .env.local) or files with extensions (package.json, CLAUDE.md).
// Bounded by whitespace or line edges to avoid false positives on embedded substrings.
// Does NOT match extensionless names (src, LICENSE) — too many false positives.
const BARE_NAME_RE = /(?<=^|\s)(\.[\w.@+-]+|[\w@+-][\w.@+-]*\.[\w@+-]{1,15})(?=\s|$)/g;

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

// ─── File stat cache for bare-name link validation ──────────────────────────

interface CachedStat {
    exists: boolean;
    isDirectory: boolean;
    ts: number;
}

const fileStatCache = new Map<string, CachedStat>();
const STAT_CACHE_TTL_MS = 10_000;

async function cachedFileStat(
    absolutePath: string,
): Promise<{ exists: boolean; isDirectory: boolean }> {
    const cached = fileStatCache.get(absolutePath);
    if (cached && Date.now() - cached.ts < STAT_CACHE_TTL_MS) {
        return cached;
    }
    try {
        const result = await sendRequest<FileStatResponse>(MSG.FILE_STAT, {
            path: absolutePath,
        });
        const entry: CachedStat = { ...result, ts: Date.now() };
        fileStatCache.set(absolutePath, entry);
        return result;
    } catch {
        return { exists: false, isDirectory: false };
    }
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
    master?: boolean,
): ILinkProvider {
    const workspaceKey = getWorkspaceKey(taskId, projectId, master);

    return {
        provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
            const line = term.buffer.active.getLine(bufferLineNumber - 1);
            if (!line) {
                callback(undefined);
                return;
            }

            const workingDir = getWorkingDir(taskId, projectId, master);
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
                            void handlePathActivation(
                                text,
                                workingDir,
                                workspaceKey,
                                event,
                                taskId,
                                projectId,
                            );
                        },
                    });
                }
            }

            // Bare filenames (dotfiles, files with extensions) — need async
            // filesystem validation to avoid false-positive hover underlines.
            if (!workingDir) {
                callback(links.length > 0 ? links : undefined);
                return;
            }

            const bareCandidates: Array<{ resolved: string; link: ILink }> = [];
            BARE_NAME_RE.lastIndex = 0;
            let bareMatch: RegExpExecArray | null;
            while ((bareMatch = BARE_NAME_RE.exec(lineText)) !== null) {
                const fullMatch = bareMatch[1];
                const matchIndex = bareMatch.index + (bareMatch[0].length - fullMatch.length);

                const key = `${matchIndex}:${fullMatch.length}`;
                if (seen.has(key)) continue;
                seen.add(key);

                const resolved = normalizePath(workingDir + "/" + fullMatch);
                // Reject paths that escape workingDir
                if (resolved !== workingDir && !resolved.startsWith(workingDir + "/")) continue;

                const startCol = (cellMap[matchIndex] ?? matchIndex) + 1;
                const lastCharIdx = matchIndex + fullMatch.length - 1;
                const endCol = (cellMap[lastCharIdx] ?? lastCharIdx) + 2;

                bareCandidates.push({
                    resolved,
                    link: {
                        range: {
                            start: { x: startCol, y: bufferLineNumber },
                            end: { x: endCol, y: bufferLineNumber },
                        },
                        text: fullMatch,
                        activate(event: MouseEvent, text: string) {
                            void handlePathActivation(text, workingDir, workspaceKey, event);
                        },
                    },
                });
            }

            if (bareCandidates.length === 0) {
                callback(links.length > 0 ? links : undefined);
                return;
            }

            // Validate bare candidates against filesystem before exposing as links
            void Promise.all(bareCandidates.map((c) => cachedFileStat(c.resolved))).then(
                (results) => {
                    for (let i = 0; i < results.length; i++) {
                        if (results[i].exists) links.push(bareCandidates[i].link);
                    }
                    callback(links.length > 0 ? links : undefined);
                },
            );
        },
    };
}

async function handlePathActivation(
    text: string,
    workingDir: string | null,
    workspaceKey: string | null,
    event: MouseEvent,
    taskId?: string,
    projectId?: string,
): Promise<void> {
    const resolved = resolvePath(text, workingDir);
    if (!resolved) return;

    const lineMatch = text.match(/:(\d+)(?::(\d+))?$/);
    const line = lineMatch?.[1] ? Number(lineMatch[1]) : undefined;
    const col = lineMatch?.[2] ? Number(lineMatch[2]) : undefined;

    const stat = await cachedFileStat(resolved);
    if (!stat.exists) return;

    const isExternal = event.metaKey || event.ctrlKey;

    if (stat.isDirectory) {
        if (isExternal) {
            window.taskflow?.showItemInFolder(resolved);
        } else {
            void useFileStore.getState().expandToPathAndLoad(resolved);
            if (!useUIStore.getState().fileExplorerOpen) {
                useUIStore.getState().toggleFileExplorer();
            }
        }
    } else {
        if (isExternal) {
            openExternalFile(resolved, { line, col });
        } else {
            void openFileInApp(resolved, workspaceKey, { taskId, projectId }, line);
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

interface TerminalViewportSnapshot {
    isAtBottom: boolean;
    viewportY: number;
}

function captureViewport(term: Terminal): TerminalViewportSnapshot {
    return captureTerminalViewport(term.buffer.active);
}

function restoreViewport(term: Terminal, snapshot: TerminalViewportSnapshot): void {
    term.scrollToLine(getRestoreViewportLine(term.buffer.active, snapshot));
}

function removeCanvasCursorLayer(screenElement: HTMLElement): void {
    // Remove the Canvas addon's cursor layer canvas from the DOM so it doesn't
    // paint on top of the WebGL canvas. The Canvas cursor layer (z-index 3)
    // sits above the WebGL canvas (z-index auto) and keeps its independent
    // blink timer running, which causes a duplicate/missing cursor.
    // Selection and link layers are kept — WebGL handles rendering but Canvas
    // layers may still contribute to hover/selection visuals.
    screenElement.querySelector("canvas.xterm-cursor-layer")?.remove();
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

            // Remove the Canvas cursor layer now that WebGL is rendering.
            const screenElement = (
                term as unknown as { element: HTMLElement }
            ).element?.querySelector<HTMLElement>(".xterm-screen");
            if (screenElement) {
                removeCanvasCursorLayer(screenElement);
            }

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

function getTerminalTheme(): XtermTheme {
    return { ...useThemeStore.getState().resolved.xterm };
}

function flushPendingChunks(
    pendingData: BufferedTerminalChunk[],
    lastSequence: number,
    writer: { write: (data: string) => void },
): void {
    for (const chunk of pendingData) {
        if (chunk.sequence > lastSequence) writer.write(chunk.data);
    }
    pendingData.length = 0;
}

function getOrCreateTerminal(
    sessionId: string,
    taskId?: string,
    projectId?: string,
    master?: boolean,
): CachedTerminal {
    const existing = terminalCache.get(sessionId);
    if (existing) return existing;

    const terminalSettings = useSettingsStore.getState().settings?.terminal;
    const lastTerminalSize = useSessionStore.getState().lastTerminalSize;
    const term = new Terminal({
        cols: lastTerminalSize?.cols ?? undefined,
        rows: lastTerminalSize?.rows ?? undefined,
        theme: getTerminalTheme(),
        fontFamily: terminalSettings?.fontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY,
        fontSize: terminalSettings?.fontSize ?? 13,
        fontWeight: "normal",
        fontWeightBold: "bold",
        lineHeight: 1.0,
        letterSpacing: 0,
        scrollback: TERMINAL_SCROLLBACK,
        cursorBlink: true,
        allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon(createWebLinkHandler(taskId, projectId, master)));

    // Create a dedicated wrapper div that persists across mounts
    const element = document.createElement("div");
    element.style.width = "100%";
    element.style.height = "100%";
    term.open(element);

    // File path link provider (registered after open so buffer is available)
    const filePathLinkDisposable = term.registerLinkProvider(
        createFilePathLinkProvider(term, taskId, projectId, master),
    );

    // Renderer addons must load before Unicode (renderer initialization first)
    const disposeRendererAddons = loadBestEffortRendererAddons(term);

    // Unicode support loaded after renderer is ready (auto-activates '15-graphemes')
    term.loadAddon(new UnicodeGraphemesAddon());
    const writer = new TimeBudgetedWriter(term);

    const titleDisposable = term.onTitleChange((newTitle) => {
        if (!newTitle) return;
        const found = findTabForSession(sessionId);
        if (!found || found.tab.type !== "shell") return;
        const truncated = middleTruncate(newTitle, SHELL_TITLE_MAX_LEN);
        useSessionStore.getState().updateAutoTitle(found.workspaceKey, found.tab.id, truncated);
    });

    // Buffer live output until history is loaded, then write directly
    const pendingData: BufferedTerminalChunk[] = [];
    let historyLoaded = false;
    let historyLoadPromise: Promise<void> | null = null;

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
        }
    });

    function ensureHistoryLoaded(): Promise<void> {
        if (historyLoadPromise) return historyLoadPromise;
        historyLoadPromise = sendRequest<SessionSnapshotResponse>(MSG.SESSION_SNAPSHOT, {
            sessionId,
        })
            .then(async ({ snapshot, lastSequence, cursorHidden }) => {
                if (snapshot !== null) {
                    writer.write(snapshot);
                    if (cursorHidden) {
                        writer.write("\x1b[?25l");
                    }
                    await writer.flush();
                    term.scrollToBottom();
                    historyLoaded = true;
                    flushPendingChunks(pendingData, lastSequence, writer);
                    return;
                }
                return replayFromHistory();
            })
            .catch(() => replayFromHistory());
        return historyLoadPromise;
    }

    async function replayFromHistory() {
        return sendRequest<SessionHistoryResponse>(MSG.SESSION_HISTORY, {
            taskId,
            projectId,
            master,
            sessionId,
        })
            .then(async ({ data, lastSequence }) => {
                if (data) writer.write(data);
                await writer.flush();
                term.scrollToBottom();
                historyLoaded = true;
                flushPendingChunks(pendingData, lastSequence, writer);
            })
            .catch(async () => {
                for (const chunk of pendingData) writer.write(chunk.data);
                await writer.flush();
                term.scrollToBottom();
                historyLoaded = true;
                pendingData.length = 0;
            });
    }

    const cached: CachedTerminal = {
        term,
        fit,
        writer,
        element,
        unsubOutput,
        unsubExit,
        ensureHistoryLoaded,
        disposeRuntime: () => {
            titleDisposable.dispose();
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
    cancelDetach(sessionId);
    const cached = terminalCache.get(sessionId);
    if (!cached) return;
    terminalCache.delete(sessionId);
    cached.unsubOutput();
    cached.unsubExit();
    cached.disposeRuntime();
    cached.element.remove();
    cached.term.dispose();
}

/** Schedule terminal destruction after a grace period. */
function scheduleDetach(sessionId: string): void {
    if (pendingDetaches.has(sessionId)) return;
    const timer = setTimeout(() => {
        pendingDetaches.delete(sessionId);
        destroyTerminal(sessionId);
    }, DETACH_GRACE_MS);
    pendingDetaches.set(sessionId, timer);
}

/** Cancel a pending detach if the terminal is being remounted. Returns true if cancelled. */
function cancelDetach(sessionId: string): boolean {
    const timer = pendingDetaches.get(sessionId);
    if (timer === undefined) return false;
    clearTimeout(timer);
    pendingDetaches.delete(sessionId);
    return true;
}

function TerminalPane({ taskId, projectId, master, sessionId, visible }: TerminalPaneProps) {
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
    const restoreFocusAfterModifierRef = useRef(false);
    const [dragOver, setDragOver] = useState(false);
    const dragCounterRef = useRef(0);
    const sendInput = useSessionStore((s) => s.sendInput);
    const resizeTerminal = useSessionStore((s) => s.resizeTerminal);
    const focusedPanel = useUIStore((s) => s.focusedPanel);

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

            // Let modifier keys bubble so useCmdHeld can track Cmd/Shift state
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
        if (!visible || !termRef.current || !fitRef.current) return;
        // Force viewport recalculation when becoming visible.
        // Don't force scrollToBottom — preserve the user's scroll position.
        scheduleFit(true, focusedPanel === "workspace", false);
    }, [focusedPanel, visible, sessionId, scheduleFit]);

    // Dedicated focus effect — independent of fit/resize logic.
    // Uses rAF for fast path + bounded retry loop as fallback for cases
    // where the terminal element isn't ready yet (freshly mounted, layout pending).
    useEffect(() => {
        if (!visible || focusedPanel !== "workspace") return;

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
    }, [focusedPanel, visible, sessionId]);

    useEffect(() => {
        if (!visible) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
            const container = containerRef.current;
            const active = document.activeElement;
            if (!container || !(active instanceof HTMLElement) || !container.contains(active)) {
                return;
            }

            restoreFocusAfterModifierRef.current = true;
            active.blur();
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (!restoreFocusAfterModifierRef.current) return;

            if (event.key === "Shift") {
                if (useUIStore.getState().focusedPanel === "workspace") {
                    restoreFocusAfterModifierRef.current = false;
                    termRef.current?.focus();
                }
                return;
            }

            if (event.key === "Meta" || event.key === "Control") {
                restoreFocusAfterModifierRef.current = false;
                termRef.current?.focus();
            }
        };

        const handleBlur = () => {
            restoreFocusAfterModifierRef.current = false;
        };

        window.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("keyup", handleKeyUp, true);
        window.addEventListener("blur", handleBlur);

        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
            window.removeEventListener("keyup", handleKeyUp, true);
            window.removeEventListener("blur", handleBlur);
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
        <div className="bg-card relative flex-1 overflow-hidden p-1.5">
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
        </div>
    );
}

// eslint-disable-next-line react-refresh/only-export-components -- destroyTerminal manages the module-level terminal cache
export { TerminalPane, destroyTerminal };
