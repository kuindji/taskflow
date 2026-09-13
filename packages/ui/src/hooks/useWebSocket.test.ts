import { afterEach, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useHomedir } from "./useActiveWorkspace";

// Children mount (and run their effects) before WebSocketProvider has named a
// primary backend, so the shim must answer "not connected" the way the old
// module did: a rejected request and a dropped fire-and-forget, never a throw.

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let root: Root | null = null;
afterEach(() => {
    act(() => root?.unmount());
    root = null;
});

test("a request before any backend is primary rejects instead of throwing", () => {
    // In a child process: other test files replace this module with
    // `mock.module`, and those mocks leak into every file that runs after them.
    const script = `
        const { sendRequest, sendFireAndForget } = await import("./src/hooks/useWebSocket.ts");
        let thrown = false;
        let pending = null;
        try {
            pending = sendRequest("ping");
            sendFireAndForget("ping");
        } catch {
            thrown = true;
        }
        const rejected = pending ? await pending.then(() => false, () => true) : false;
        console.log(JSON.stringify({ thrown, rejected }));
    `;
    const child = Bun.spawnSync(["bun", "-e", script], {
        cwd: new URL("../..", import.meta.url).pathname,
    });
    expect(child.stderr.toString()).toBe("");
    expect(JSON.parse(child.stdout.toString()) as unknown).toEqual({
        thrown: false,
        rejected: true,
    });
});

test("a component fetching the home directory on mount does not crash before connect", () => {
    const uncaught: unknown[] = [];
    function Probe() {
        useHomedir();
        return null;
    }
    const container = document.createElement("div");
    root = createRoot(container, { onUncaughtError: (error) => uncaught.push(error) });
    act(() => root?.render(createElement(Probe)));
    expect(uncaught).toEqual([]);
});
