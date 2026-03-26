import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { CanvasAddon } from "@xterm/addon-canvas";
import { useSessionStore } from "@/stores/session-store";
import type { Tab } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useThemeStore } from "@/stores/theme-store";
import { onEvent, sendRequest } from "@/hooks/useWebSocket";
import { DEFAULT_TERMINAL_FONT_FAMILY, DEFAULT_TERMINAL_FONT_SIZE, MSG, TERMINAL_SCROLLBACK } from "@taskflow/shared";
import type {
    TerminalOutputEvent,
    SessionExitedEvent,
    SessionHistoryResponse,
    SessionSnapshotResponse,
    XtermTheme,
} from "@taskflow/shared";
import { middleTruncate } from "@/lib/middle-truncate";
import { TimeBudgetedWriter } from "@/lib/time-budgeted-writer";
import { isTerminalViewportAtBottom } from "@/lib/terminal-viewport";
import { createWebLinkHandler } from "./terminal-links";
import { createFilePathLinkProvider } from "./terminal-link-provider";
import { refreshTerminal } from "./terminal-utils";

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Module-level state ──────────────────────────────────────────────────────

/** Module-level cache: keeps one xterm instance per mounted terminal tab. */
const terminalCache = new Map<string, CachedTerminal>();

/** Pending delayed destructions — cancelled if terminal remounts within the grace period. */
const pendingDetaches = new Map<string, ReturnType<typeof setTimeout>>();
const DETACH_GRACE_MS = 50;
const SHELL_TITLE_MAX_LEN = 30;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function getTerminalTheme(): XtermTheme {
    return { ...useThemeStore.getState().resolved.xterm };
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

// ─── Core lifecycle ──────────────────────────────────────────────────────────

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
        fontSize: terminalSettings?.fontSize ?? DEFAULT_TERMINAL_FONT_SIZE,
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
    let shouldRestoreBottomAfterWrite = false;

    writer.onBeforeWrite = () => {
        // Only capture on the first frame of a burst — don't overwrite if already true.
        // Intermediate frames may see a corrupted viewport state due to xterm's deferred
        // syncScrollArea, so we preserve the initial "was at bottom" decision.
        if (!shouldRestoreBottomAfterWrite) {
            shouldRestoreBottomAfterWrite =
                writer.visible &&
                element.isConnected &&
                isTerminalViewportAtBottom(term.buffer.active);
        }
    };

    writer.onDidWrite = (bufferDrained: boolean) => {
        // Intermediate frames: do nothing — scrollToBottom() would just get undone
        // by xterm's deferred syncScrollArea → _innerRefresh chain anyway.
        if (!bufferDrained) return;

        const shouldRestore = shouldRestoreBottomAfterWrite;
        shouldRestoreBottomAfterWrite = false;
        if (!shouldRestore || !writer.visible || !element.isConnected) return;

        term.scrollToBottom();

        // Backup: xterm's deferred syncScrollArea (rAF) → _innerRefresh (rAF) chain
        // can re-set isUserScrolling=true after our scrollToBottom(). Double-rAF ensures
        // we fire after that chain settles.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (!writer.visible || !element.isConnected) return;
                term.scrollToBottom();
            });
        });
    };

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

/** Cancel a pending detach if the terminal is being remounted. Returns true if cancelled. */
function cancelDetach(sessionId: string): boolean {
    const timer = pendingDetaches.get(sessionId);
    if (timer === undefined) return false;
    clearTimeout(timer);
    pendingDetaches.delete(sessionId);
    return true;
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

export type { CachedTerminal };
export { terminalCache, getOrCreateTerminal, destroyTerminal, cancelDetach, scheduleDetach };
