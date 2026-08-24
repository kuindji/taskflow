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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "HELLO",
                lastSequence: 5,
                cursorHidden: false,
                kittyStack: [],
            },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(readRow(term, 0)).toBe("HELLO");
        term.dispose();
    });

    test("falls back to history when there is no snapshot", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: null,
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
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
        net.request = <T>(type: string): Promise<T> => {
            if (type === MSG.SESSION_SNAPSHOT) {
                return gate.then(
                    () =>
                        ({
                            snapshot: "AAA",
                            lastSequence: 5,
                            cursorHidden: false,
                            kittyStack: [],
                        }) as unknown as T,
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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
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
        net.request = <T>(type: string): Promise<T> => {
            if (type === MSG.SESSION_SNAPSHOT) {
                return gate.then(
                    () =>
                        ({
                            snapshot: "WORK",
                            lastSequence: 0,
                            cursorHidden: false,
                            kittyStack: [],
                        }) as unknown as T,
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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "PROMPT>",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: null,
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "PROMPT>",
                lastSequence: 1,
                cursorHidden: false,
                kittyStack: [],
            },
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
        net.emit(MSG.TERMINAL_OUTPUT, {
            sessionId: "s1",
            data: "A".repeat(200 * 1024),
            sequence: 1,
        });
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "BBB", sequence: 2 });
        await settle();

        await term.attach();
        await settle();
        expect([0, 1, 2].map((y) => readRow(term, y)).join("")).toBe("PROMPT>BBB");
        term.dispose();
    });

    test("re-attach reads modes from output that was still queued", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: null,
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: null,
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: null,
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
            [MSG.SESSION_HISTORY]: { data: "\x1b[>5u", lastSequence: 0 },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        await settle();
        expect(term.modes.kittyFlags).toBe(5);

        net.request = <T>(type: string): Promise<T> => {
            if (type === MSG.SESSION_SNAPSHOT) {
                return Promise.resolve({
                    snapshot: null,
                    lastSequence: 0,
                    cursorHidden: false,
                    kittyStack: [],
                } as unknown as T);
            }
            if (type === MSG.SESSION_HISTORY) {
                return Promise.resolve({
                    data: "\x1b[>5u\x1b[<u",
                    lastSequence: 0,
                } as unknown as T);
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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: null,
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
            [MSG.SESSION_HISTORY]: { data: "\x1b[>5u", lastSequence: 0 },
        };
        const net = fakeNet(responses);
        net.request = <T>(type: string): Promise<T> => {
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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
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
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: null,
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
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

    test("the child's mouse modes are read off its own output", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(term.modes.mouseTracking).toBe("none");
        expect(term.modes.mouseEncoding).toBe("x10");

        net.emit(MSG.TERMINAL_OUTPUT, {
            sessionId: "s1",
            data: "\x1b[?1002h\x1b[?1006h",
            sequence: 1,
        });
        await settle();
        expect(term.modes.mouseTracking).toBe("drag");
        expect(term.modes.mouseEncoding).toBe("sgr");

        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[?1006l", sequence: 2 });
        await settle();
        expect(term.modes.mouseEncoding).toBe("x10");
        expect(term.modes.mouseTracking).toBe("drag");
        term.dispose();
    });

    test("disabling an encoding the child is not in leaves the active one alone", async () => {
        // A child that turned SGR on and then reset urxvt is still in SGR; the
        // last enable wins and only its own disable clears it.
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, {
            sessionId: "s1",
            data: "\x1b[?1006h\x1b[?1015l",
            sequence: 1,
        });
        await settle();
        expect(term.modes.mouseEncoding).toBe("sgr");
        term.dispose();
    });

    test("pixel mouse mode is tracked as its own encoding", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, {
            sessionId: "s1",
            data: "\x1b[?1002h\x1b[?1016h",
            sequence: 1,
        });
        await settle();
        expect(term.modes.mouseEncoding).toBe("sgr-pixels");
        term.dispose();
    });

    test("a child's full reset puts the mouse encoding back to legacy", async () => {
        // RIS is a power-on reset: xterm clears the tracking mode for us, but
        // the encoding is ours to track, and a child that re-enables tracking
        // afterwards without reselecting an extended encoding is parsing
        // legacy bytes again.
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, {
            sessionId: "s1",
            data: "\x1b[?1002h\x1b[?1006h",
            sequence: 1,
        });
        await settle();
        expect(term.modes.mouseEncoding).toBe("sgr");

        // Split from the re-enable so the reset's own effect is visible: the
        // handler returns false, so xterm still runs RIS and clears tracking.
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1bc", sequence: 2 });
        await settle();
        expect(term.modes.mouseTracking).toBe("none");
        expect(term.modes.mouseEncoding).toBe("x10");

        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[?1002h", sequence: 3 });
        await settle();
        expect(term.modes.mouseTracking).toBe("drag");
        expect(term.modes.mouseEncoding).toBe("x10");
        term.dispose();
    });

    test("a child's full reset shows the cursor again", async () => {
        // DECTCEM is the other mode xterm does not expose, so RIS leaves our
        // copy stale the same way: the grid's cursor is back and ours says it
        // is still hidden.
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[?25l", sequence: 1 });
        await settle();
        expect(term.cursorHidden).toBe(true);

        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1bc", sequence: 2 });
        await settle();
        expect(term.cursorHidden).toBe(false);
        term.dispose();
    });

    test("a re-attach does not carry the old tracking mode onto a fresh grid", async () => {
        // The snapshot carries the child's *tracking* mode, so tracking the
        // child dropped while we were away must not be put back by the pre-drop
        // state — the same rule the DEC modes follow. The encoding is the one
        // mode the snapshot cannot speak about, so it is carried over instead;
        // that half is pinned by "a snapshot re-attach keeps the encoding the
        // snapshot cannot carry" above.
        const responses: Record<string, unknown> = {
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "\x1b[?1002h\x1b[?1006h",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
        };
        const net = fakeNet(responses);
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(term.modes.mouseTracking).toBe("drag");
        expect(term.modes.mouseEncoding).toBe("sgr");

        // The child left tracking behind while we were away.
        responses[MSG.SESSION_SNAPSHOT] = {
            snapshot: "",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
        };
        await term.attach();
        expect(term.modes.mouseTracking).toBe("none");
        term.dispose();
    });

    test("a snapshot re-attach keeps the encoding the snapshot cannot carry", async () => {
        // SerializeAddon emits the tracking mode (`?9`/`?1000`/`?1002`/`?1003`)
        // and nothing at all for the encoding — `IModes` has no member for it,
        // so the serializer has nothing to read. Resetting to `x10` on the
        // snapshot path therefore strands an SGR child in legacy bytes after
        // every reconnect. `lastSequence: 1` drops the held-back chunk, so the
        // replay cannot put the encoding back and only the carry-over can.
        const responses: Record<string, unknown> = {
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
        };
        const net = fakeNet(responses);
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, {
            sessionId: "s1",
            data: "\x1b[?1002h\x1b[?1006h",
            sequence: 1,
        });
        await settle();
        expect(term.modes.mouseEncoding).toBe("sgr");

        // Exactly what a real backend snapshot of that child looks like.
        responses[MSG.SESSION_SNAPSHOT] = {
            snapshot: "\x1b[?1002h",
            lastSequence: 1,
            cursorHidden: false,
            kittyStack: [],
        };
        await term.attach();
        expect(term.modes.mouseTracking).toBe("drag");
        expect(term.modes.mouseEncoding).toBe("sgr");
        term.dispose();
    });

    test("a re-attach that falls back to history puts the mouse modes back", async () => {
        // Trimmed scrollback may no longer contain the sequences that set them,
        // and a child that comes back as mouseTracking "none" has every click
        // after the reconnect silently dropped.
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: null,
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
            // lastSequence 1 covers the chunk below, so it is dropped rather
            // than replayed — without that the held-back output would set the
            // modes again and the `restore` string would never be exercised.
            [MSG.SESSION_HISTORY]: { data: "", lastSequence: 1 },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, {
            sessionId: "s1",
            data: "\x1b[?1002h\x1b[?1006h",
            sequence: 1,
        });
        await settle();

        await term.attach();
        expect(term.modes.mouseTracking).toBe("drag");
        expect(term.modes.mouseEncoding).toBe("sgr");
        term.dispose();
    });

    test("history that carries a later mouse mode overrides the replayed one", async () => {
        // `restore` is written before the history, so a child that changed
        // encoding just before the drop still wins — the same ordering the
        // existing DEC-mode replay relies on.
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: {
                snapshot: null,
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
            },
            [MSG.SESSION_HISTORY]: { data: "\x1b[?1015h", lastSequence: 1 },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, {
            sessionId: "s1",
            data: "\x1b[?1000h\x1b[?1006h",
            sequence: 1,
        });
        await settle();

        await term.attach();
        expect(term.modes.mouseEncoding).toBe("urxvt");
        expect(term.modes.mouseTracking).toBe("vt200");
        term.dispose();
    });

    test("a re-attach that fetches nothing leaves the screen it had", async () => {
        // A reconnect over a flaky tunnel can drop again while the snapshot is
        // in flight. The re-attach clears the grid before it knows whether it
        // has anything to put back, so failing both fetches used to leave the
        // pane blank — the child's output is gone from the screen even though
        // the backend still has it, and nothing redraws it until the next
        // reconnect happens to succeed.
        let online = true;
        const net: NetLike = {
            request: <T>(type: string): Promise<T> => {
                if (!online) return Promise.reject<T>(new Error("connection lost"));
                if (type === MSG.SESSION_SNAPSHOT) {
                    return Promise.resolve({
                        snapshot: "HELLO",
                        lastSequence: 5,
                        cursorHidden: false,
                        kittyStack: [],
                    } as T);
                }
                return Promise.reject<T>(new Error(`no stub for ${type}`));
            },
            on: () => () => undefined,
            onStatusChange: () => () => undefined,
        };
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(readRow(term, 0)).toBe("HELLO");

        online = false;
        await term.attach();
        await settle();
        expect(readRow(term, 0)).toBe("HELLO");
        term.dispose();
    });

    test("a second attach cannot start inside the first one's clear", async () => {
        // A flaky tunnel can reconnect again while the first re-attach is still
        // fetching, and App fires one attach per open session per reconnect. Run
        // unserialized, the second one reads `historyLoaded` while the first is
        // mid-clear, mistakes itself for a first attach and skips the reset — so
        // its snapshot lands on the uncleared grid, and the first one's older
        // snapshot is then written after it. The pane ends up showing both, with
        // the stale screen on top.
        const snapshots = ["FIRST", "OLD", "NEW"];
        let taken = 0;
        const gates: Array<() => void> = [];
        let credits = 0;
        // A request may be issued long after the test says to answer it — with
        // attach() serialized the second one does not even reach the net until
        // the first has finished — so an answer is a credit, not a poke.
        const pump = (): void => {
            while (credits > 0 && gates.length > 0) {
                credits -= 1;
                gates.shift()?.();
            }
        };
        const listeners = new Set<(payload: unknown) => void>();
        const net: NetLike = {
            request: <T,>(type: string): Promise<T> => {
                if (type !== MSG.SESSION_SNAPSHOT) {
                    return Promise.reject<T>(new Error(`no stub for ${type}`));
                }
                const snapshot = snapshots[taken] ?? null;
                taken += 1;
                const pending = new Promise<T>((resolve) => {
                    gates.push(() => {
                        resolve({
                            snapshot,
                            lastSequence: 0,
                            cursorHidden: false,
                            kittyStack: [],
                        } as T);
                    });
                });
                pump();
                return pending;
            },
            on: (type, handler) => {
                if (type === MSG.TERMINAL_OUTPUT) listeners.add(handler);
                return () => listeners.delete(handler);
            },
            onStatusChange: () => () => undefined,
        };
        const answer = (): void => {
            credits += 1;
            pump();
        };
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });

        const first = term.attach();
        answer();
        await first;
        expect(readRow(term, 0)).toBe("FIRST");

        // Hold every write, so the clear's queued reset cannot complete and the
        // first attach is parked at exactly the point the second one races.
        const write = term.terminal.write.bind(term.terminal);
        const held: Array<() => void> = [];
        term.terminal.write = (data: string | Uint8Array, callback?: () => void): void => {
            held.push(() => {
                write(data, callback);
            });
        };
        // Something has to be in the write queue ahead of the reset, or the
        // reset resolves without ever reaching a write. It renders nothing.
        for (const handler of listeners) {
            handler({ sessionId: "s1", data: "\x1b[0m", sequence: 1 });
        }

        const a = term.attach();
        answer();
        // Let the first attach reach its clear and park there.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        const b = term.attach();
        answer();

        term.terminal.write = write;
        for (const run of held) run();
        await a;
        await b;
        await settle();

        expect(readRow(term, 0)).toBe("NEW");
        term.dispose();
    });
});
