import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { CanvasAddon } from "@xterm/addon-canvas";
import { findSessionTab, sessionBackend, useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useThemeStore } from "@/stores/theme-store";
import { onEvent, sendRequest } from "@/lib/connection-registry";
import {
    DEFAULT_TERMINAL_FONT_FAMILY,
    DEFAULT_TERMINAL_FONT_SIZE,
    MSG,
    TERMINAL_SCROLLBACK,
} from "@taskflow/shared";
import type {
    TerminalOutputEvent,
    TerminalResyncEvent,
    SessionExitedEvent,
    SessionHistoryResponse,
    SessionSnapshotResponse,
    XtermTheme,
} from "@taskflow/shared";
import { middleTruncate } from "@/lib/middle-truncate";
import { TimeBudgetedWriter } from "@/lib/time-budgeted-writer";
import { isTerminalViewportAtBottom } from "@/lib/terminal-viewport";
import { onBackendReady } from "@/lib/backend-ready";
import { createTerminalAttachment, subscribeTerminalRecovery } from "./terminal-attachment";
import { createWebLinkHandler, sessionWorkspace } from "./terminal-links";
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
    unsubRecovery: () => void;
    ensureHistoryLoaded: () => Promise<void>;
    attachment: ReturnType<typeof createTerminalAttachment>;
    disposeRuntime: () => void;
}

// ─── Module-level state ──────────────────────────────────────────────────────

/** Module-level cache: keeps one xterm instance per mounted terminal tab. */
const terminalCache = new Map<string, CachedTerminal>();

/** Pending delayed destructions — cancelled if terminal remounts within the grace period. */
const pendingDetaches = new Map<string, ReturnType<typeof setTimeout>>();
const DETACH_GRACE_MS = 50;
const SHELL_TITLE_MAX_LEN = 30;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    term.loadAddon(new WebLinksAddon(createWebLinkHandler(sessionId, taskId, projectId, master)));

    // Create a dedicated wrapper div that persists across mounts
    const element = document.createElement("div");
    element.style.width = "100%";
    element.style.height = "100%";
    term.open(element);

    // File path link provider (registered after open so buffer is available)
    const filePathLinkDisposable = term.registerLinkProvider(
        createFilePathLinkProvider(term, sessionId, taskId, projectId, master),
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
        const found = findSessionTab(sessionId);
        if (!found || found.tab.type !== "shell") return;
        const truncated = middleTruncate(newTitle, SHELL_TITLE_MAX_LEN);
        useSessionStore.getState().updateAutoTitle(found.workspaceKey, found.tab.id, truncated);
    });

    const attachment = createTerminalAttachment({
        sessionId,
        requestSnapshot: () =>
            requestFromSessionMachine<SessionSnapshotResponse>(MSG.SESSION_SNAPSHOT, { sessionId }),
        requestHistory: () =>
            requestFromSessionMachine<SessionHistoryResponse>(MSG.SESSION_HISTORY, {
                ...sessionWorkspace(sessionId, taskId, projectId, master).owner,
                sessionId,
            }),
        writer,
        reset: () => term.reset(),
        scrollToBottom: () => term.scrollToBottom(),
    });
    const unsubOutput = onEvent(MSG.TERMINAL_OUTPUT, (payload) => {
        attachment.receiveOutput(payload as TerminalOutputEvent);
    });
    const unsubExit = onEvent(MSG.SESSION_EXITED, (payload) => {
        const event = payload as SessionExitedEvent;
        if (event.sessionId === sessionId) attachment.receiveExit(event.exitCode);
    });

    const unsubRecovery = subscribeTerminalRecovery({
        sessionId,
        backendId: () => sessionBackend(sessionId),
        onResync: (handler) =>
            onEvent(MSG.TERMINAL_RESYNC, (payload, backendId) =>
                handler(payload as TerminalResyncEvent, backendId),
            ),
        onReady: onBackendReady,
        resync: () => attachment.resync(),
        resize: () => {
            // A hidden terminal sends its size when it is shown again.
            if (writer.visible) {
                useSessionStore.getState().resizeTerminal(sessionId, term.cols, term.rows);
            }
        },
    });

    /** Session ids are unique across machines; its history lives where it runs. */
    function requestFromSessionMachine<T>(type: string, payload: unknown): Promise<T> {
        const backendId = sessionBackend(sessionId);
        if (!backendId) return Promise.reject(new Error("Session has no machine"));
        return sendRequest<T>(backendId, type, payload);
    }

    const cached: CachedTerminal = {
        term,
        fit,
        writer,
        element,
        unsubOutput,
        unsubExit,
        unsubRecovery,
        attachment,
        ensureHistoryLoaded: () => attachment.ensureLoaded(),
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
    cached.unsubRecovery();
    cached.attachment.dispose();
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
