interface TerminalViewportState {
    baseY: number;
    viewportY: number;
}

interface TerminalViewportSnapshot {
    isAtBottom: boolean;
    viewportY: number;
}

function isTerminalViewportAtBottom(state: TerminalViewportState): boolean {
    return state.baseY - state.viewportY <= 1;
}

function captureTerminalViewport(state: TerminalViewportState): TerminalViewportSnapshot {
    return {
        isAtBottom: isTerminalViewportAtBottom(state),
        viewportY: Math.max(0, state.viewportY),
    };
}

function getRestoreViewportLine(
    state: TerminalViewportState,
    snapshot: TerminalViewportSnapshot,
): number {
    if (snapshot.isAtBottom) {
        return Math.max(0, state.baseY);
    }
    return Math.max(0, Math.min(snapshot.viewportY, state.baseY));
}

export {
    captureTerminalViewport,
    getRestoreViewportLine,
    isTerminalViewportAtBottom,
};
export type { TerminalViewportSnapshot, TerminalViewportState };
