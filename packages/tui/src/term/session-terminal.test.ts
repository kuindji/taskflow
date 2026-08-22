import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import { SessionTerminal } from "./session-terminal";
import type { NetLike } from "../net/client";

interface FakeNet extends NetLike {
    emit(type: string, payload: unknown): void;
    requests: Array<{ type: string; payload: unknown }>;
}

function fakeNet(responses: Record<string, unknown>): FakeNet {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    return {
        requests: [],
        request<T>(type: string, payload?: unknown): Promise<T> {
            this.requests.push({ type, payload });
            const response = responses[type];
            if (response === undefined) return Promise.reject(new Error(`no stub for ${type}`));
            return Promise.resolve(response as T);
        },
        onStatusChange: () => () => undefined,
        on(type: string, handler: (payload: unknown) => void): () => void {
            let set = listeners.get(type);
            if (!set) {
                set = new Set();
                listeners.set(type, set);
            }
            set.add(handler);
            return () => {
                set.delete(handler);
            };
        },
        emit(type: string, payload: unknown): void {
            for (const handler of listeners.get(type) ?? []) handler(payload);
        },
    };
}

function readRow(term: SessionTerminal, y: number): string {
    return term.terminal.buffer.active.getLine(y)?.translateToString(true) ?? "";
}

/** Modes are set by the child's output stream, which is still queued. */
async function settle(): Promise<void> {
    await Bun.sleep(30);
}

describe("SessionTerminal", () => {
    test("restores from a snapshot when one is available", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "HELLO", lastSequence: 5, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(readRow(term, 0)).toBe("HELLO");
        term.dispose();
    });

    test("falls back to history when there is no snapshot", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: null, lastSequence: 0, cursorHidden: false },
            [MSG.SESSION_HISTORY]: { data: "FROMLOG", lastSequence: 2 },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(readRow(term, 0)).toBe("FROMLOG");
        term.dispose();
    });

    test("replays buffered output that arrived before the snapshot, skipping stale chunks", async () => {
        let release = (): void => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const net = fakeNet({});
        net.request = <T,>(type: string): Promise<T> => {
            if (type === MSG.SESSION_SNAPSHOT) {
                return gate.then(
                    () =>
                        ({ snapshot: "AAA", lastSequence: 5, cursorHidden: false }) as unknown as T,
                );
            }
            return Promise.reject(new Error(`no stub for ${type}`));
        };

        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        const attached = term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "STALE", sequence: 4 });
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "BBB", sequence: 6 });
        release();
        await attached;
        expect(readRow(term, 0)).toBe("AAABBB");
        term.dispose();
    });

    test("ignores output belonging to other sessions", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "other", data: "NOPE", sequence: 1 });
        await settle();
        expect(readRow(term, 0)).toBe("");
        term.dispose();
    });

    test("tracks application cursor keys and bracketed paste from child output", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(term.modes.applicationCursorKeys).toBe(false);
        net.emit(MSG.TERMINAL_OUTPUT, {
            sessionId: "s1",
            data: "\x1b[?1h\x1b[?2004h",
            sequence: 1,
        });
        await settle();
        expect(term.modes.applicationCursorKeys).toBe(true);
        expect(term.modes.bracketedPaste).toBe(true);
        term.dispose();
    });

    test("tracks the kitty protocol flags the child pushes and pops", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(term.modes.kittyFlags).toBeNull();
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[>1u", sequence: 1 });
        await settle();
        expect(term.modes.kittyFlags).toBe(1);
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[<u", sequence: 2 });
        await settle();
        expect(term.modes.kittyFlags).toBeNull();
        term.dispose();
    });

    test("tracks cursor visibility", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(term.cursorHidden).toBe(false);
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[?25l", sequence: 1 });
        await settle();
        expect(term.cursorHidden).toBe(true);
        term.dispose();
    });

    test("writes a process-exited marker when the session ends", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 40, rows: 5 });
        await term.attach();
        net.emit(MSG.SESSION_EXITED, { sessionId: "s1", exitCode: 3 });
        await settle();
        const text = [0, 1, 2].map((y) => readRow(term, y)).join("");
        expect(text).toContain("[Process exited with code 3]");
        term.dispose();
    });

    test("ignores an exit belonging to another session", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 40, rows: 5 });
        await term.attach();
        net.emit(MSG.SESSION_EXITED, { sessionId: "other", exitCode: 1 });
        await settle();
        const text = [0, 1, 2].map((y) => readRow(term, y)).join("");
        expect(text).not.toContain("Process exited");
        term.dispose();
    });

    test("re-attaching replaces the screen instead of appending to it", async () => {
        // What Task 18 does on reconnect. Without the reset, the snapshot is
        // drawn on top of the old grid and everything appears twice.
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "PROMPT>", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        await term.attach();
        expect([0, 1, 2].map((y) => readRow(term, y)).join("")).toBe("PROMPT>");
        term.dispose();
    });

    test("re-attaching preserves modes the child set before the drop", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, {
            sessionId: "s1",
            data: "\x1b[?1h\x1b[?2004h",
            sequence: 1,
        });
        await settle();
        await term.attach();
        expect(term.modes.applicationCursorKeys).toBe(true);
        expect(term.modes.bracketedPaste).toBe(true);
        term.dispose();
    });

    test("sends a resize request and resizes the local grid", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
            [MSG.TERMINAL_RESIZE]: { success: true },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        term.resize(40, 10);
        expect(term.terminal.cols).toBe(40);
        expect(net.requests.some((r) => r.type === MSG.TERMINAL_RESIZE)).toBe(true);
        term.dispose();
    });
});
