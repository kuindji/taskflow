import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { onEvent, sendRequest } from "@/hooks/useWebSocket";
import { MSG } from "@taskflow/shared";
import type { TerminalOutputEvent, SessionExitedEvent, SessionHistoryResponse } from "@taskflow/shared";
import "@xterm/xterm/css/xterm.css";

interface TerminalPaneProps {
    sessionId: string;
    visible: boolean;
}

/** Fit terminal to container, subtracting 1 column to prevent subpixel overflow */
function fitTerminal(fit: FitAddon, term: Terminal): void {
    const dims = fit.proposeDimensions();
    if (!dims || isNaN(dims.cols) || isNaN(dims.rows)) return;
    const cols = Math.max(2, dims.cols - 1);
    if (term.cols !== cols || term.rows !== dims.rows) {
        term.resize(cols, dims.rows);
    }
}

function TerminalPane({ sessionId, visible }: TerminalPaneProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const visibleRef = useRef(visible);
    const sendInput = useSessionStore((s) => s.sendInput);
    const resizeTerminal = useSessionStore((s) => s.resizeTerminal);

    useEffect(() => {
        visibleRef.current = visible;
    }, [visible]);

    useEffect(() => {
        if (!containerRef.current) return;

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
            fontFamily: terminalSettings?.fontFamily ?? "CaskaydiaCove Nerd Font Mono, monospace",
            fontSize: terminalSettings?.fontSize ?? 13,
            cursorBlink: true,
        });

        const fit = new FitAddon();
        term.loadAddon(fit);
        term.loadAddon(new WebLinksAddon());

        term.open(containerRef.current);
        termRef.current = term;
        fitRef.current = fit;

        if (visible) {
            fitTerminal(fit, term);
            resizeTerminal(sessionId, term.cols, term.rows);
        }

        // Buffer live output until history is loaded, then flush in order
        const pendingData: string[] = [];
        let historyLoaded = false;

        const unsubscribe = onEvent(MSG.TERMINAL_OUTPUT, (payload) => {
            const event = payload as TerminalOutputEvent;
            if (event.sessionId === sessionId) {
                if (historyLoaded) {
                    term.write(event.data);
                } else {
                    pendingData.push(event.data);
                }
            }
        });

        // Replay scrollback from backend, then flush any buffered live data
        sendRequest<SessionHistoryResponse>(MSG.SESSION_HISTORY, { sessionId })
            .then(({ data }) => {
                if (data) term.write(data);
                historyLoaded = true;
                for (const chunk of pendingData) term.write(chunk);
                pendingData.length = 0;
            })
            .catch(() => {
                // If history fetch fails, just start writing live data
                historyLoaded = true;
                for (const chunk of pendingData) term.write(chunk);
                pendingData.length = 0;
            });

        const dataDisposable = term.onData((data) => {
            sendInput(sessionId, data);
        });

        const resizeDisposable = term.onResize(({ cols, rows }) => {
            resizeTerminal(sessionId, cols, rows);
        });

        const unsubExit = onEvent(MSG.SESSION_EXITED, (payload) => {
            const event = payload as SessionExitedEvent;
            if (event.sessionId === sessionId) {
                term.writeln(`\r\n\x1b[90m[Process exited with code ${event.exitCode}]\x1b[0m`);
            }
        });

        // Resize on container resize
        const resizeObserver = new ResizeObserver(() => {
            if (!visibleRef.current || !fitRef.current || !termRef.current) return;
            fitTerminal(fitRef.current, termRef.current);
            resizeTerminal(sessionId, termRef.current.cols, termRef.current.rows);
        });
        resizeObserver.observe(containerRef.current);

        return () => {
            resizeObserver.disconnect();
            unsubscribe();
            unsubExit();
            dataDisposable.dispose();
            resizeDisposable.dispose();
            term.dispose();
            termRef.current = null;
            fitRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- terminal setup should not re-run on visibility change
    }, [sessionId, resizeTerminal, sendInput]);

    useEffect(() => {
        if (!visible || !termRef.current || !fitRef.current) return;
        // Defer fit until the browser has painted the now-visible container,
        // otherwise FitAddon measures zero dimensions from display:none.
        const raf = requestAnimationFrame(() => {
            if (!fitRef.current || !termRef.current) return;
            fitTerminal(fitRef.current, termRef.current);
            resizeTerminal(sessionId, termRef.current.cols, termRef.current.rows);
        });
        return () => cancelAnimationFrame(raf);
    }, [visible, sessionId, resizeTerminal]);

    return <div ref={containerRef} className="flex-1 overflow-hidden" />;
}

export { TerminalPane };
export type { TerminalPaneProps };
