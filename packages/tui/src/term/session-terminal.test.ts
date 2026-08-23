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
            [MSG.SESSION_SNAPSHOT]: { snapshot: "HELLO", lastSequence: 5, cursorHidden: false, kittyStack: [] },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(readRow(term, 0)).toBe("HELLO");
        term.dispose();
    });

    test("falls back to history when there is no snapshot", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: null, lastSequence: 0, cursorHidden: false, kittyStack: [] },
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
                        ({ snapshot: "AAA", lastSequence: 5, cursorHidden: false, kittyStack: [] }) as unknown as T,
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
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false, kittyStack: [] },
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
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false, kittyStack: [] },
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
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false, kittyStack: [] },
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

    test("restores the outer kitty flags when a nested push is popped", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false, kittyStack: [] },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        // A shell that speaks the protocol pushes, then an editor run inside it
        // pushes its own flags and pops them again on exit.
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[>1u", sequence: 1 });
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[>5u", sequence: 2 });
        await settle();
        expect(term.modes.kittyFlags).toBe(5);
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[<u", sequence: 3 });
        await settle();
        expect(term.modes.kittyFlags).toBe(1);
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[<u", sequence: 4 });
        await settle();
        expect(term.modes.kittyFlags).toBeNull();
        term.dispose();
    });

    test("tracks cursor visibility", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false, kittyStack: [] },
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
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false, kittyStack: [] },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 40, rows: 5 });
        await term.attach();
        net.emit(MSG.SESSION_EXITED, { sessionId: "s1", exitCode: 3 });
        await settle();
        const text = [0, 1, 2].map((y) => readRow(term, y)).join("");
        expect(text).toContain("[Process exited with code 3]");
        term.dispose();
    });

    test("holds the exit marker until the initial stream has been replayed", async () => {
        let release = (): void => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const net = fakeNet({});
        net.request = <T,>(type: string): Promise<T> => {
            if (type === MSG.SESSION_SNAPSHOT) {
                return gate.then(
                    () =>
                        ({ snapshot: "WORK", lastSequence: 0, cursorHidden: false, kittyStack: [] }) as unknown as T,
                );
            }
            return Promise.reject(new Error(`no stub for ${type}`));
        };

        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 40, rows: 5 });
        const attached = term.attach();
        // The child exits while the snapshot request is still in flight.
        net.emit(MSG.SESSION_EXITED, { sessionId: "s1", exitCode: 0 });
        release();
        await attached;
        await settle();
        expect(readRow(term, 0)).toBe("WORK");
        expect(readRow(term, 1)).toContain("[Process exited with code 0]");
        term.dispose();
    });

    test("ignores an exit belonging to another session", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false, kittyStack: [] },
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
            [MSG.SESSION_SNAPSHOT]: { snapshot: "PROMPT>", lastSequence: 0, cursorHidden: false, kittyStack: [] },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        await term.attach();
        expect([0, 1, 2].map((y) => readRow(term, y)).join("")).toBe("PROMPT>");
        term.dispose();
    });

    test("re-attaching takes its modes from the snapshot, not the pre-drop state", async () => {
        // SerializeAddon emits an enable sequence for a mode that is on and
        // nothing at all for one that is off, so a mode the child switched off
        // while we were disconnected cannot be turned back off by the snapshot.
        // Re-applying the pre-drop modes over it would strand the client
        // encoding arrows the child stopped asking for.
        const responses: Record<string, unknown> = {
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "\x1b[?1h",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
        };
        const net = fakeNet(responses);
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(term.modes.applicationCursorKeys).toBe(true);

        // The child left application cursor keys behind while we were away.
        responses[MSG.SESSION_SNAPSHOT] = {
            snapshot: "",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
        };
        await term.attach();
        expect(term.modes.applicationCursorKeys).toBe(false);
        term.dispose();
    });

    test("re-attaching preserves modes the child set before the drop when there is no snapshot", async () => {
        // History is raw scrollback and may have been trimmed past the
        // sequences that set these modes, so the pre-drop state stands in.
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: null, lastSequence: 0, cursorHidden: false, kittyStack: [] },
            [MSG.SESSION_HISTORY]: { data: "", lastSequence: 0 },
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

    test("re-attaching clears output the snapshot already accounts for", async () => {
        // lastSequence 1 means the backend's mirror has parsed that batch, so it
        // is already in the serialized screen. Replaying it over the snapshot
        // would draw it twice.
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "PROMPT>", lastSequence: 1, cursorHidden: false, kittyStack: [] },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 40, rows: 5 });
        await term.attach();
        // Output arrives and is still in the write queue when the socket drops.
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "OLDOLDOLD", sequence: 1 });
        await term.attach();
        expect([0, 1, 2].map((y) => readRow(term, y)).join("")).toBe("PROMPT>");
        term.dispose();
    });

    test("re-attaching replays live output the snapshot does not cover yet", async () => {
        // The backend reports the sequence its headless terminal has finished
        // parsing, which trails the sequence it has already sent us. A snapshot
        // taken in that window legitimately excludes a batch this client has
        // already received, so the batch has to survive the reset and be
        // replayed on top of the snapshot rather than being dropped with the
        // old grid.
        const responses: Record<string, unknown> = {
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 4,
                cursorHidden: false,
                kittyStack: [],
            },
        };
        const net = fakeNet(responses);
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 40, rows: 5 });
        await term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "LIVE", sequence: 5 });
        await settle();

        responses[MSG.SESSION_SNAPSHOT] = {
            snapshot: "PROMPT>",
            lastSequence: 4,
            cursorHidden: false,
            kittyStack: [],
        };
        await term.attach();
        await settle();
        expect([0, 1, 2].map((y) => readRow(term, y)).join("")).toBe("PROMPT>LIVE");
        term.dispose();
    });

    test("keeps replayed output available for a further re-attach", async () => {
        // The backend's parse lag can outlast a single reconnect: if the second
        // drop happens before it has parsed the batch, the next snapshot still
        // excludes it, so the replay has to be held back again rather than
        // written to the grid and forgotten.
        const responses: Record<string, unknown> = {
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 4,
                cursorHidden: false,
                kittyStack: [],
            },
        };
        const net = fakeNet(responses);
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 40, rows: 5 });
        await term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "LIVE", sequence: 5 });
        await settle();

        responses[MSG.SESSION_SNAPSHOT] = {
            snapshot: "PROMPT>",
            lastSequence: 4,
            cursorHidden: false,
            kittyStack: [],
        };
        await term.attach();
        await settle();
        await term.attach();
        await settle();
        expect([0, 1, 2].map((y) => readRow(term, y)).join("")).toBe("PROMPT>LIVE");
        term.dispose();
    });

    test("keeps the exit marker across repeated re-attaches", async () => {
        // The marker is this client's own, so no snapshot ever contains it and
        // nothing but the hold-back buffer can bring it back after a reset.
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "PROMPT>",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 40, rows: 5 });
        await term.attach();
        net.emit(MSG.SESSION_EXITED, { sessionId: "s1", exitCode: 0 });
        await settle();

        await term.attach();
        await settle();
        await term.attach();
        await settle();
        expect([0, 1, 2].map((y) => readRow(term, y)).join("")).toContain(
            "[Process exited with code 0]",
        );
        term.dispose();
    });

    test("bounds the output it holds back for a re-attach", async () => {
        // The hold-back buffer covers the backend's parse lag, not the whole
        // session, so it drops the oldest rather than growing without bound.
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "PROMPT>",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 40, rows: 5 });
        await term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "A".repeat(200 * 1024), sequence: 1 });
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "BBB", sequence: 2 });
        await settle();

        await term.attach();
        await settle();
        expect([0, 1, 2].map((y) => readRow(term, y)).join("")).toBe("PROMPT>BBB");
        term.dispose();
    });

    test("re-attach reads modes from output that was still queued", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: null, lastSequence: 0, cursorHidden: false, kittyStack: [] },
            [MSG.SESSION_HISTORY]: { data: "", lastSequence: 0 },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[?1h", sequence: 1 });
        // No settle(): the mode-setting write is still queued when we re-attach.
        await term.attach();
        expect(term.modes.applicationCursorKeys).toBe(true);
        term.dispose();
    });

    test("re-attaching without a snapshot rebuilds the kitty stack from history", async () => {
        // The history path replays raw scrollback that still contains the
        // child's original push. Carrying the pre-drop stack across the reset
        // would push a second copy of it, and the child's next pop would land
        // on the duplicate instead of leaving the protocol.
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: null, lastSequence: 0, cursorHidden: false, kittyStack: [] },
            [MSG.SESSION_HISTORY]: { data: "\x1b[>5u", lastSequence: 0 },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        await settle();
        expect(term.modes.kittyFlags).toBe(5);
        await term.attach();
        await settle();
        expect(term.modes.kittyFlags).toBe(5);
        // One push happened in the child, so one pop leaves the protocol.
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[<u", sequence: 1 });
        await settle();
        expect(term.modes.kittyFlags).toBeNull();
        term.dispose();
    });

    test("re-attaching honours a kitty pop the history replay carries", async () => {
        // The child left the protocol while we were disconnected, and the
        // scrollback still carries both its push and its pop. Replaying it
        // rebuilds an empty stack, which is the truth — the pre-drop stack must
        // not stand in for it.
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: null, lastSequence: 0, cursorHidden: false, kittyStack: [] },
            [MSG.SESSION_HISTORY]: { data: "\x1b[>5u", lastSequence: 0 },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        await settle();
        expect(term.modes.kittyFlags).toBe(5);

        net.request = <T,>(type: string): Promise<T> => {
            if (type === MSG.SESSION_SNAPSHOT) {
                return Promise.resolve({
                    snapshot: null,
                    lastSequence: 0,
                    cursorHidden: false,
                    kittyStack: [],
                } as unknown as T);
            }
            if (type === MSG.SESSION_HISTORY) {
                return Promise.resolve({ data: "\x1b[>5u\x1b[<u", lastSequence: 0 } as unknown as T);
            }
            return Promise.reject(new Error(`no stub for ${type}`));
        };
        await term.attach();
        await settle();
        expect(term.modes.kittyFlags).toBeNull();
        term.dispose();
    });

    test("re-attaching keeps the pre-drop kitty stack when history carries none", async () => {
        // Raw scrollback may have been trimmed past the child's push. A replay
        // that carries no kitty sequence at all says nothing about the protocol,
        // so the pre-drop stack is the best guess left.
        const responses: Record<string, unknown> = {
            [MSG.SESSION_SNAPSHOT]: { snapshot: null, lastSequence: 0, cursorHidden: false, kittyStack: [] },
            [MSG.SESSION_HISTORY]: { data: "\x1b[>5u", lastSequence: 0 },
        };
        const net = fakeNet(responses);
        net.request = <T,>(type: string): Promise<T> => {
            const response = responses[type];
            if (response === undefined) return Promise.reject(new Error(`no stub for ${type}`));
            return Promise.resolve(response as T);
        };
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        await settle();
        expect(term.modes.kittyFlags).toBe(5);

        responses[MSG.SESSION_HISTORY] = { data: "TRIMMED", lastSequence: 0 };
        await term.attach();
        await settle();
        expect(term.modes.kittyFlags).toBe(5);
        term.dispose();
    });

    test("restores the kitty stack the snapshot reports", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                // The child is already nested: a shell pushed 1, an editor pushed 5.
                kittyStack: [null, 1, 5],
            },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(term.modes.kittyFlags).toBe(5);
        // Quitting the editor has to hand the shell its own flags back, not legacy.
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[<u", sequence: 1 });
        await settle();
        expect(term.modes.kittyFlags).toBe(1);
        term.dispose();
    });

    test("sends a resize request and resizes the local grid", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false, kittyStack: [] },
            [MSG.TERMINAL_RESIZE]: { success: true },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        term.resize(40, 10);
        expect(term.terminal.cols).toBe(40);
        expect(net.requests.some((r) => r.type === MSG.TERMINAL_RESIZE)).toBe(true);
        term.dispose();
    });
    test("scroll moves the viewport back over the scrollback and returns to it", async () => {
        const lines = Array.from({ length: 20 }, (_, i) => `L${String(i + 1)}`).join("\r\n");
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: null, lastSequence: 0, cursorHidden: false, kittyStack: [] },
            [MSG.SESSION_HISTORY]: { data: lines, lastSequence: 1 },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();

        const buffer = term.terminal.buffer.active;
        const base = buffer.baseY;
        expect(base).toBeGreaterThan(3);
        expect(buffer.viewportY).toBe(base);

        term.scroll(-3);
        expect(term.terminal.buffer.active.viewportY).toBe(base - 3);
        // The view really moved onto older output rather than onto blank rows:
        // unscrolled it starts at L16, three lines back it starts at L13.
        expect(readRow(term, base)).toBe("L16");
        expect(readRow(term, term.terminal.buffer.active.viewportY)).toBe("L13");

        term.scroll(3);
        expect(term.terminal.buffer.active.viewportY).toBe(base);
        term.dispose();
    });
});
