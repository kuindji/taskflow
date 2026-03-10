import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useSessionStore } from '@/stores/session-store';
import { onEvent } from '@/hooks/useWebSocket';
import { MSG } from '@taskflow/shared';
import type { TerminalOutputEvent } from '@taskflow/shared';
import '@xterm/xterm/css/xterm.css';

interface TerminalPaneProps {
  sessionId: string;
  visible: boolean;
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

    const term = new Terminal({
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#45475a',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: '#bac2de',
      },
      fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
      fontSize: 13,
      cursorBlink: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;

    if (visible) {
      fit.fit();
      resizeTerminal(sessionId, term.cols, term.rows);
    }

    const dataDisposable = term.onData((data) => {
      sendInput(sessionId, data);
    });

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      resizeTerminal(sessionId, cols, rows);
    });

    const unsubscribe = onEvent(MSG.TERMINAL_OUTPUT, (payload) => {
      const event = payload as TerminalOutputEvent;
      if (event.sessionId === sessionId) {
        term.write(event.data);
      }
    });

    // Resize on container resize
    const resizeObserver = new ResizeObserver(() => {
      if (!visibleRef.current || !fitRef.current || !termRef.current) return;
      fitRef.current.fit();
      resizeTerminal(sessionId, termRef.current.cols, termRef.current.rows);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      unsubscribe();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, resizeTerminal, sendInput]);

  useEffect(() => {
    if (!visible || !termRef.current || !fitRef.current) return;
    fitRef.current.fit();
    resizeTerminal(sessionId, termRef.current.cols, termRef.current.rows);
  }, [visible, sessionId, resizeTerminal]);

  return <div ref={containerRef} className="flex-1 overflow-hidden" />;
}

export { TerminalPane };
export type { TerminalPaneProps };
