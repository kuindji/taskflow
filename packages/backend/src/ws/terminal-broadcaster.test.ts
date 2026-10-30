import { describe, expect, it } from "bun:test";
import { MSG } from "@taskflow/shared";
import { createTerminalBroadcaster } from "./terminal-broadcaster";

class Socket {
    sent: string[] = [];
    constructor(
        public buffered = 0,
        public result = 1,
    ) {}
    getBufferedAmount() {
        return this.buffered;
    }
    send(data: string) {
        this.sent.push(data);
        return this.result;
    }
}
const output = (sessionId = "s1") => ({
    type: MSG.TERMINAL_OUTPUT,
    payload: { sessionId, data: "output", sequence: 1 },
});
const resync = (...sessionIds: string[]) =>
    JSON.stringify({ type: "terminal:resync", payload: { sessionIds } });

describe("terminal broadcaster", () => {
    it("dropping terminal output marks only that client and session dirty", () => {
        const slow = new Socket(1_048_577),
            healthy = new Socket();
        const broadcaster = createTerminalBroadcaster([slow, healthy]);
        broadcaster.broadcast(output(), { dropOnBackpressure: true });
        expect(slow.sent).toEqual([]);
        expect(healthy.sent).toEqual([JSON.stringify(output())]);
        broadcaster.drain(slow);
        broadcaster.drain(healthy);
        expect(slow.sent).toEqual([resync("s1")]);
        expect(healthy.sent).toEqual([JSON.stringify(output())]);
    });
    it("drain sends one terminal resync event with deduplicated session ids", () => {
        const slow = new Socket(1_048_577),
            other = new Socket(1_048_577);
        const broadcaster = createTerminalBroadcaster([slow, other]);
        for (const id of ["s1", "s2", "s1"])
            broadcaster.broadcast(output(id), { dropOnBackpressure: true });
        broadcaster.drain(slow);
        broadcaster.drain(slow);
        expect(slow.sent).toEqual([resync("s1", "s2")]);
        expect(other.sent).toEqual([]);
    });
    it("draining a clean client sends nothing", () => {
        const socket = new Socket(1_048_577);
        const broadcaster = createTerminalBroadcaster([socket]);
        broadcaster.broadcast(
            { type: MSG.SYSTEM_CLIENTS, payload: { count: 1 } },
            { dropOnBackpressure: true },
        );
        broadcaster.drain(socket);
        expect(socket.sent).toEqual([]);
    });
    it("a failed resync send retains the dirty sessions", () => {
        const socket = new Socket(1_048_577, 0);
        const broadcaster = createTerminalBroadcaster([socket]);
        broadcaster.broadcast(output(), { dropOnBackpressure: true });
        broadcaster.drain(socket);
        socket.result = -1;
        broadcaster.drain(socket);
        broadcaster.drain(socket);
        expect(socket.sent).toEqual([resync("s1"), resync("s1")]);
    });
    it("output dropped after a resync causes another resync on drain", () => {
        const socket = new Socket(1_048_577);
        const broadcaster = createTerminalBroadcaster([socket]);
        broadcaster.broadcast(output(), { dropOnBackpressure: true });
        broadcaster.drain(socket);
        broadcaster.broadcast(output("s2"), { dropOnBackpressure: true });
        broadcaster.drain(socket);
        expect(socket.sent).toEqual([resync("s1"), resync("s2")]);
    });
    it("forget and clear release dirty client state", () => {
        const socket = new Socket(1_048_577),
            other = new Socket(1_048_577);
        const broadcaster = createTerminalBroadcaster([socket, other]);
        broadcaster.broadcast(output(), { dropOnBackpressure: true });
        broadcaster.forget(socket);
        broadcaster.drain(socket);
        broadcaster.clear();
        broadcaster.drain(other);
        expect(socket.sent).toEqual([]);
        expect(other.sent).toEqual([]);
    });
    it("non-droppable broadcasts still reach a backpressured client", () => {
        const socket = new Socket(2_000_000);
        createTerminalBroadcaster([socket]).broadcast(output());
        expect(socket.sent).toEqual([JSON.stringify(output())]);
    });
    it("the backpressure threshold is strictly greater than one mebibyte", () => {
        const socket = new Socket(1_048_576);
        const broadcaster = createTerminalBroadcaster([socket]);
        broadcaster.broadcast(output(), { dropOnBackpressure: true });
        broadcaster.drain(socket);
        expect(socket.sent).toEqual([JSON.stringify(output())]);
    });
});
