import { afterEach, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useActiveWorkspace } from "./useActiveWorkspace";

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

test("an event subscribed through the shim comes only from primary", async () => {
    // A child process, for the same mock.module leak as above.
    const script = `
        const { onEvent } = await import("./src/hooks/useWebSocket.ts");
        const { openConnection, closeConnection, setPrimary } = await import("./src/lib/connection-registry.ts");
        function serve(label) {
            const sockets = new Set();
            const server = Bun.serve({
                port: 0,
                hostname: "127.0.0.1",
                fetch: (req, s) => (s.upgrade(req) ? undefined : new Response("ok")),
                websocket: { open: (ws) => sockets.add(ws), message() {} },
            });
            return {
                origin: "http://127.0.0.1:" + server.port,
                broadcast: () => { for (const ws of sockets) ws.send(JSON.stringify({ type: "thing", payload: label })); },
                stop: () => server.stop(true),
            };
        }
        const a = serve("A");
        const b = serve("B");
        await openConnection("a", a.origin);
        await openConnection("b", b.origin);
        setPrimary("a");
        const seen = [];
        onEvent("thing", (payload) => seen.push(payload));
        b.broadcast();
        a.broadcast();
        await new Promise((resolve) => setTimeout(resolve, 200));
        closeConnection("a", "detach");
        closeConnection("b", "detach");
        a.stop();
        b.stop();
        console.log(JSON.stringify(seen));
    `;
    const child = Bun.spawn(["bun", "-e", script], {
        cwd: new URL("../..", import.meta.url).pathname,
        stdout: "pipe",
        stderr: "pipe",
    });
    await child.exited;
    expect(await new Response(child.stderr).text()).toBe("");
    expect(JSON.parse(await new Response(child.stdout).text()) as unknown).toEqual(["A"]);
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
