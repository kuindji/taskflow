import { afterEach, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useActiveWorkspace } from "./useActiveWorkspace";

// Children mount (and run their effects) before WebSocketProvider has named a
// primary backend, so nothing a component reads on mount may throw.

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let root: Root | null = null;
afterEach(() => {
    act(() => root?.unmount());
    root = null;
});

test("a component reading the active workspace on mount does not crash before connect", () => {
    const uncaught: unknown[] = [];
    function Probe() {
        useActiveWorkspace();
        return null;
    }
    const container = document.createElement("div");
    root = createRoot(container, { onUncaughtError: (error) => uncaught.push(error) });
    act(() => root?.render(createElement(Probe)));
    expect(uncaught).toEqual([]);
});
