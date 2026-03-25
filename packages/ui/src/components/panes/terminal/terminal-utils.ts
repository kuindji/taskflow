import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { captureTerminalViewport, getRestoreViewportLine } from "@/lib/terminal-viewport";

const SHELL_UNSAFE = /[^a-zA-Z0-9_./:@=+-]/;

interface FitResult {
    measured: boolean;
    resized: boolean;
}

interface TerminalViewportSnapshot {
    isAtBottom: boolean;
    viewportY: number;
}

function shellQuote(path: string): string {
    if (!SHELL_UNSAFE.test(path)) return path;
    return `'${path.replace(/'/g, "'\\''")}'`;
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
    return captureTerminalViewport(term.buffer.active);
}

function restoreViewport(term: Terminal, snapshot: TerminalViewportSnapshot): void {
    term.scrollToLine(getRestoreViewportLine(term.buffer.active, snapshot));
}

export type { FitResult, TerminalViewportSnapshot };
export { shellQuote, fitTerminal, refreshTerminal, captureViewport, restoreViewport };
