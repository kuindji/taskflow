import { afterEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const focused: string[] = [];

function fakeTerminal(sessionId: string) {
    return {
        term: {
            focus: () => focused.push(sessionId),
            attachCustomKeyEventHandler: () => {},
            onData: () => ({ dispose: () => {} }),
            options: {},
            cols: 80,
            rows: 24,
        },
        fit: {},
        element: document.createElement("div"),
        writer: { visible: false },
        attachment: { forwardInput: () => {} },
        ensureHistoryLoaded: async () => {},
    };
}

const cache = new Map<string, ReturnType<typeof fakeTerminal>>();

void mock.module("@/components/panes/terminal/terminal-lifecycle", () => ({
    terminalCache: cache,
    getOrCreateTerminal: (sessionId: string) => {
        const cached = cache.get(sessionId) ?? fakeTerminal(sessionId);
        cache.set(sessionId, cached);
        return cached;
    },
    destroyTerminal: () => {},
    cancelDetach: () => false,
    scheduleDetach: () => {},
}));
void mock.module("@/components/panes/terminal/terminal-utils", () => ({
    shellQuote: (path: string) => path,
    fitTerminal: () => ({ measured: true, resized: false }),
    refreshTerminal: () => {},
    captureViewport: () => null,
    restoreViewport: () => {},
}));
void mock.module("@/components/panes/terminal/MarkdownInputHelper", () => ({
    MarkdownInputHelper: () => null,
}));

const { TerminalPane } = await import("./TerminalPane");
const { useUIStore } = await import("@/stores/ui-store");

const container = document.createElement("div");
document.body.appendChild(container);
const root = createRoot(container);

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function frames() {
    return new Promise((resolve) => setTimeout(resolve, 50));
}

test("returning to a split workspace focuses only the active pane's terminal", async () => {
    useUIStore.setState({ focusedPanel: "sidebar", navigationMode: false });
    act(() =>
        root.render(
            <>
                <TerminalPane sessionId="left" sessionType="shell" visible paneFocused />
                <TerminalPane sessionId="right" sessionType="shell" visible paneFocused={false} />
            </>,
        ),
    );
    await act(frames);
    focused.length = 0;

    // Mouse or sidebar click back into the workspace.
    act(() => useUIStore.setState({ focusedPanel: "workspace" }));
    await act(frames);
    expect(focused.length).toBeGreaterThan(0);
    expect(focused.every((id) => id === "left")).toBe(true);

    // Keyboard navigation: Cmd+Shift+Arrow back to the workspace, then release Shift.
    act(() => useUIStore.setState({ focusedPanel: "sidebar", navigationMode: true }));
    act(() => useUIStore.setState({ focusedPanel: "workspace" }));
    await act(frames);
    focused.length = 0;
    act(() => useUIStore.setState({ navigationMode: false }));
    await act(frames);
    expect(focused).toEqual(["left"]);
});
