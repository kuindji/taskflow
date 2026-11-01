import { afterEach, describe, expect, it } from "bun:test";
import { KeyEvent, PasteEvent, parseKeypress } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { MSG } from "@taskflow/shared";
import type { SessionSnapshotResponse } from "@taskflow/shared";
import type { NetLike } from "../net/client";
import { SessionBridge } from "./session-bridge";
import { prepareForEmbeddedTerminal } from "./keys";
import type { Osc52Sink } from "./osc52";

class FakeNet implements NetLike {
    readonly requests: Array<{ type: string; payload: unknown }> = [];
    readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
    responses = new Map<string, unknown>();
    requestHandler?: (type: string, payload?: unknown) => Promise<unknown> | undefined;

    on(type: string, handler: (payload: unknown) => void): () => void {
        const handlers = this.handlers.get(type) ?? new Set();
        handlers.add(handler);
        this.handlers.set(type, handlers);
        return () => handlers.delete(handler);
    }

    onStatusChange(): () => void {
        return () => {};
    }

    async request<T>(type: string, payload?: unknown): Promise<T> {
        this.requests.push({ type, payload });
        const deferred = this.requestHandler?.(type, payload);
        if (deferred) return (await deferred) as T;
        if (!this.responses.has(type)) throw new Error(`No response for ${type}`);
        return this.responses.get(type) as T;
    }

    emit(type: string, payload: unknown): void {
        for (const handler of this.handlers.get(type) ?? []) handler(payload);
    }
}

describe("SessionBridge", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    async function setup(width = 40, height = 8, clipboard?: Osc52Sink) {
        const test = await createTestRenderer({ width, height });
        const net = new FakeNet();
        const bridge = new SessionBridge({
            renderer: test.renderer,
            net,
            sessionId: "s1",
            owner: { projectId: "p1" },
            cols: width,
            rows: height,
            clipboard,
        });
        test.renderer.root.add(bridge.renderable);
        bridge.setActive(true, width, height);
        cleanups.push(
            () => bridge.destroy(),
            () => test.renderer.destroy(),
        );
        return { test, net, bridge };
    }

    function sessionInputs(net: FakeNet): string[] {
        return net.requests
            .filter((request) => request.type === MSG.SESSION_INPUT)
            .map((request) => (request.payload as { data: string }).data);
    }

    function key(
        name: string,
        options: Partial<ConstructorParameters<typeof KeyEvent>[0]> = {},
    ): KeyEvent {
        return prepareForEmbeddedTerminal(
            new KeyEvent({
                name,
                ctrl: false,
                meta: false,
                shift: false,
                option: false,
                sequence: name,
                number: false,
                raw: name,
                eventType: "press",
                source: "kitty",
                ...options,
            }),
        );
    }

    function deferred<T>() {
        let resolve!: (value: T) => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<T>((yes, no) => {
            resolve = yes;
            reject = no;
        });
        return { promise, resolve, reject };
    }
    const snapshot = (text = "base", lastSequence = 4): SessionSnapshotResponse => ({
        snapshot: text,
        lastSequence,
        cursorHidden: false,
        kittyStack: [],
        mouseEncoding: "x10",
    });
    const tick = async () => {
        for (let i = 0; i < 12; i++) await Promise.resolve();
    };
    const count = (net: FakeNet, type: string = MSG.SESSION_SNAPSHOT) =>
        net.requests.filter((r) => r.type === type).length;
    async function recovering(clipboard?: Osc52Sink) {
        const f = await setup(40, 8, clipboard);
        f.net.responses.set(MSG.SESSION_SNAPSHOT, snapshot());
        await f.bridge.attach();
        await f.test.renderOnce();
        const snapshots: Array<ReturnType<typeof deferred<SessionSnapshotResponse>>> = [];
        f.net.requestHandler = (type) => {
            if (type !== MSG.SESSION_SNAPSHOT) return;
            const d = deferred<SessionSnapshotResponse>();
            snapshots.push(d);
            return d.promise;
        };
        return {
            ...f,
            snapshots,
            output(sequence: number, data = ` ${sequence}`, sessionId = "s1") {
                f.net.emit(MSG.TERMINAL_OUTPUT, { sessionId, data, sequence });
            },
            resync(sessionIds = ["s1"]) {
                f.net.emit(MSG.TERMINAL_RESYNC, { sessionIds });
            },
            screen: () => f.bridge.renderable.screen().text,
        };
    }

    it("terminal resync reattaches only the listed bridge session", async () => {
        const f = await recovering();
        f.resync(["s2"]);
        await tick();
        expect(count(f.net)).toBe(1);
        f.resync(["s1", "s2"]);
        await tick();
        expect(count(f.net)).toBe(2);
        f.snapshots[0].resolve(snapshot("replacement"));
        await tick();
        await f.test.renderOnce();
        expect(f.screen()).toContain("replacement");
    });
    it("a live output gap reattaches without waiting for terminal resync", async () => {
        const f = await recovering();
        f.output(5);
        f.output(6);
        f.output(8);
        await tick();
        expect(count(f.net)).toBe(2);
        expect(f.screen()).not.toContain("8");
        f.snapshots[0].resolve(snapshot("complete-through-eight", 8));
        await tick();
        await f.test.renderOnce();
        expect(f.screen()).toContain("complete-through-eight");
        expect(count(f.net, MSG.SESSION_HISTORY)).toBe(0);
    });
    it("output received during resync is buffered until the replacement is applied", async () => {
        const f = await recovering();
        f.resync();
        await tick();
        f.output(5, " five");
        f.output(6, " six");
        await f.test.renderOnce();
        expect(f.screen()).toContain("base");
        expect(f.screen()).not.toContain("five");
        f.snapshots[0].resolve(snapshot("replacement"));
        await tick();
        await f.test.renderOnce();
        expect(f.screen()).toContain("replacement five six");
        f.output(6, " duplicate");
        expect(f.screen()).not.toContain("duplicate");
    });
    it("a lagging replacement snapshot replays recent newer chunks once", async () => {
        const f = await recovering();
        f.output(5, " five");
        f.output(6, " six");
        f.resync();
        await tick();
        f.snapshots[0].resolve(snapshot("replacement"));
        await tick();
        await f.test.renderOnce();
        expect(f.screen()).toContain("replacement five six");
        expect(f.screen().match(/five/g)).toHaveLength(1);
        f.output(7);
        expect(count(f.net)).toBe(2);
        expect(count(f.net, MSG.SESSION_HISTORY)).toBe(0);
    });
    it("unbridgeable snapshot history falls back to session history", async () => {
        const f = await recovering();
        f.output(5);
        f.output(6);
        f.output(8);
        await tick();
        f.net.responses.set(MSG.SESSION_HISTORY, { data: "complete-history", lastSequence: 8 });
        f.snapshots[0].resolve(snapshot("incomplete"));
        await tick();
        await f.test.renderOnce();
        expect(count(f.net, MSG.SESSION_HISTORY)).toBe(1);
        expect(f.screen()).toContain("complete-history");
        expect(f.screen()).not.toContain("incomplete");
    });
    it("repeated resync signals coalesce while attach is pending", async () => {
        const f = await recovering();
        f.resync();
        await tick();
        f.resync();
        f.resync();
        const manual = f.bridge.attach();
        await tick();
        expect(count(f.net)).toBe(2);
        f.snapshots[0].resolve(snapshot());
        await tick();
        expect(count(f.net)).toBe(3);
        f.snapshots[1].resolve(snapshot("latest"));
        await manual;
        await f.test.renderOnce();
        expect(count(f.net)).toBe(3);
        expect(f.screen()).toContain("latest");
    });
    it("an exit marker during resync is displayed once and does not create a gap", async () => {
        const f = await recovering();
        f.resync();
        await tick();
        f.output(5);
        f.net.emit(MSG.SESSION_EXITED, { sessionId: "s1", exitCode: 7 });
        f.output(6);
        f.snapshots[0].resolve(snapshot());
        await tick();
        await f.test.renderOnce();
        expect(f.screen().match(/Process exited with code 7/g)).toHaveLength(1);
        f.output(7);
        expect(count(f.net)).toBe(2);
    });
    it("resync replay suppresses terminal replies and clipboard writes", async () => {
        const copies: string[] = [];
        const clears: string[] = [];
        const f = await recovering({
            copy: (text) => copies.push(text),
            clear: (target) => clears.push(target),
        });
        f.resync();
        await tick();
        f.output(5, "\x1b[5n\x1b[6n\x1b]52;c;cmVwbGF5\x07");
        f.snapshots[0].resolve(snapshot("\x1b[5n\x1b[6n\x1b]52;c;\x07"));
        await tick();
        expect(sessionInputs(f.net)).toEqual([]);
        expect(copies).toEqual([]);
        expect(clears).toEqual([]);
        f.output(6, "\x1b[5n\x1b]52;c;bGl2ZQ==\x07");
        expect(sessionInputs(f.net)).toHaveLength(1);
        expect(copies).toEqual(["live"]);
    });
    it("destroying during resync ignores the late snapshot and removes subscriptions", async () => {
        const f = await recovering();
        f.resync();
        await tick();
        const writes: string[] = [];
        f.bridge.renderable.write = (data) => {
            writes.push(String(data));
        };
        f.bridge.destroy();
        const requests = f.net.requests.length;
        f.snapshots[0].resolve(snapshot("late\x1b[5n"));
        await tick();
        f.net.emit(MSG.TERMINAL_RESYNC, { sessionIds: ["s1"] });
        f.output(8);
        expect(writes).toEqual([]);
        expect(f.net.requests.length).toBe(requests);
        expect(f.net.handlers.get(MSG.TERMINAL_RESYNC)?.size).toBe(0);
        expect(f.net.handlers.get(MSG.TERMINAL_OUTPUT)?.size).toBe(0);
        expect(f.net.handlers.get(MSG.SESSION_EXITED)?.size).toBe(0);
    });
    it("a null snapshot on a resync falls back to session history and repairs a missing tail with no later output", async () => {
        const f = await recovering();
        f.resync();
        await tick();
        f.net.responses.set(MSG.SESSION_HISTORY, {
            data: "base-and-missing-tail",
            lastSequence: 5,
        });
        f.snapshots[0].resolve({ ...snapshot(), snapshot: null, lastSequence: 0 });
        await tick();
        await f.test.renderOnce();
        expect(count(f.net, MSG.SESSION_HISTORY)).toBe(1);
        expect(f.screen()).toContain("base-and-missing-tail");
        f.output(5, "duplicate-tail");
        expect(f.screen()).not.toContain("duplicate-tail");
        expect(sessionInputs(f.net)).toEqual([]);
    });
    it("a failed resync retains the good screen dirty until new output retries", async () => {
        const f = await recovering();
        f.resync();
        await tick();
        f.snapshots[0].reject(new Error("offline"));
        await tick();
        expect(f.screen()).toContain("base");
        f.output(5);
        await tick();
        expect(count(f.net)).toBe(3);
        f.snapshots[1].resolve(snapshot("recovered", 5));
        await tick();
        await f.test.renderOnce();
        expect(f.screen()).toContain("recovered");
    });

    it("subscribes before attach and applies snapshot state before fresh output", async () => {
        const { test, net, bridge } = await setup();
        net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "snapshot",
            lastSequence: 4,
            cursorHidden: true,
            kittyStack: [null, 1],
            mouseEncoding: "sgr",
        });
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: " stale", sequence: 4 });
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: " fresh", sequence: 5 });
        await bridge.attach();
        await test.renderOnce();
        expect(bridge.renderable.screen().text).toContain("snapshot fresh");
        expect(bridge.renderable.screen().text).not.toContain("stale");
        expect(bridge.renderable.screen().cursor.visible).toBe(false);
    });

    it("falls back to history for a null snapshot", async () => {
        const { test, net, bridge } = await setup();
        net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: null,
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
        });
        net.responses.set(MSG.SESSION_HISTORY, { data: "history", lastSequence: 2 });
        await bridge.attach();
        await test.renderOnce();
        expect(bridge.renderable.screen().text).toContain("history");
    });

    it("rejects a non-null snapshot from an old backend", async () => {
        const { net, bridge } = await setup();
        net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "old",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
        });
        expect(bridge.attach()).rejects.toThrow("Upgrade the remote backend");
    });

    it("keeps the last good screen after a failed reconnect", async () => {
        const { test, net, bridge } = await setup();
        net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "good",
            lastSequence: 1,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "x10",
        });
        await bridge.attach();
        net.responses.delete(MSG.SESSION_SNAPSHOT);
        await bridge.attach();
        await test.renderOnce();
        expect(bridge.renderable.screen().text).toContain("good");
    });

    it("suppresses replay responses but sends live responses and process exit markers", async () => {
        const { test, net, bridge } = await setup();
        net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "\x1b[5n",
            lastSequence: 1,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "x10",
        });
        await bridge.attach();
        expect(net.requests.filter((request) => request.type === MSG.SESSION_INPUT)).toHaveLength(
            0,
        );

        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[5n", sequence: 2 });
        net.emit(MSG.SESSION_EXITED, { sessionId: "s1", exitCode: 7 });
        await test.renderOnce();
        expect(net.requests.filter((request) => request.type === MSG.SESSION_INPUT)).toHaveLength(
            1,
        );
        expect(bridge.renderable.screen().text).toContain("Process exited with code 7");
    });

    it("forwards OSC 52 only from live output after attach", async () => {
        const copies: Array<{ text: string; target: string }> = [];
        const clears: string[] = [];
        const { net, bridge } = await setup(40, 8, {
            copy: (text, target) => copies.push({ text, target }),
            clear: (target) => clears.push(target),
        });
        const sequence = "\x1b]52;c;bGl2ZQ==\x07";
        net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: sequence,
            lastSequence: 1,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "x10",
        });
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: sequence, sequence: 1 });
        await bridge.attach();
        expect(copies).toEqual([]);

        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b]52;p;c3BsaX", sequence: 2 });
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "Q=\x1b\\", sequence: 3 });
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b]52;c;\x07", sequence: 4 });
        expect(copies).toEqual([{ text: "split", target: "primary" }]);
        expect(clears).toEqual(["clipboard"]);

        await bridge.attach();
        expect(copies).toHaveLength(1);
        expect(clears).toHaveLength(1);
    });

    it("removes OSC 1 before writing live output to OpenTUI", async () => {
        const { net, bridge } = await setup();
        net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "x10",
        });
        await bridge.attach();

        const writes: string[] = [];
        const write = bridge.renderable.write.bind(bridge.renderable);
        bridge.renderable.write = (data) => {
            writes.push(typeof data === "string" ? data : new TextDecoder().decode(data));
            write(data);
        };

        net.emit(MSG.TERMINAL_OUTPUT, {
            sessionId: "s1",
            data: "before\x1b]1;shell icon",
            sequence: 1,
        });
        net.emit(MSG.TERMINAL_OUTPUT, {
            sessionId: "s1",
            data: "\x07after",
            sequence: 2,
        });

        expect(writes).toEqual(["before", "after"]);
    });

    it("keeps parsing while hidden and resizes once when activated", async () => {
        const { test, net, bridge } = await setup();
        net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "start",
            lastSequence: 1,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "x10",
        });
        await bridge.attach();
        bridge.setActive(false);
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: " hidden", sequence: 2 });
        bridge.setActive(true, 30, 6);
        bridge.setActive(true, 30, 6);
        await test.renderOnce();
        expect(bridge.renderable.screen().text).toContain("start hidden");
        expect(
            net.requests.filter(
                (request) =>
                    request.type === MSG.TERMINAL_RESIZE &&
                    JSON.stringify(request.payload).includes('"cols":30'),
            ),
        ).toHaveLength(1);
    });

    it("resends a resize the backend never received once resizes are reset", async () => {
        const { net, bridge } = await setup(40, 8);
        bridge.setActive(true, 80, 24);
        expect(
            net.requests.filter((request) => request.type === MSG.TERMINAL_RESIZE).at(-1)?.payload,
        ).toEqual({ sessionId: "s1", cols: 80, rows: 24 });

        net.requests.length = 0;
        net.responses.set(MSG.TERMINAL_RESIZE, {});
        bridge.resetResize();
        expect(net.requests).toEqual([
            { type: MSG.TERMINAL_RESIZE, payload: { sessionId: "s1", cols: 80, rows: 24 } },
        ]);
    });

    it("only clears the remembered size of an inactive bridge", async () => {
        const { net, bridge } = await setup(40, 8);
        bridge.setActive(false);
        net.requests.length = 0;
        bridge.resetResize();
        expect(net.requests).toEqual([]);

        bridge.setActive(true, 40, 8);
        expect(net.requests).toEqual([
            { type: MSG.TERMINAL_RESIZE, payload: { sessionId: "s1", cols: 40, rows: 8 } },
        ]);
    });

    it("destroys subscriptions and terminal state idempotently", async () => {
        const { net, bridge } = await setup();
        bridge.destroy();
        bridge.destroy();
        expect(net.handlers.get(MSG.TERMINAL_OUTPUT)?.size).toBe(0);
        expect(bridge.renderable.isDestroyed).toBe(true);
    });

    it("lets OpenTUI encode text, controls, Kitty keys, and application arrows", async () => {
        const { net, bridge } = await setup();
        net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [null, 1],
            mouseEncoding: "x10",
        });
        await bridge.attach();
        net.requests.length = 0;
        bridge.renderable.handleKeyPress(key("a"));
        bridge.renderable.handleKeyPress(key("q", { shift: true, sequence: "Q" }));
        bridge.renderable.handleKeyPress(key("c", { ctrl: true }));
        bridge.renderable.handleKeyPress(key("escape"));
        bridge.renderable.handleKeyPress(key("return", { shift: true }));
        expect(sessionInputs(net)).toEqual(["a", "Q", "\x1b[99;5u", "\x1b[27u", "\x1b[13;2u"]);

        const second = await setup();
        second.net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "\x1b[?1h",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "x10",
        });
        await second.bridge.attach();
        second.net.requests.length = 0;
        second.bridge.renderable.handleKeyPress(key("up"));
        expect(sessionInputs(second.net)).toEqual(["\x1bOA"]);
    });

    it("forwards raw-terminal arrows through the child's application-cursor mode", async () => {
        const { net, bridge } = await setup();
        net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "\x1b[?1h",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "x10",
        });
        await bridge.attach();
        net.requests.length = 0;

        bridge.renderable.handleKeyPress(
            prepareForEmbeddedTerminal(
                new KeyEvent({
                    name: "up",
                    ctrl: false,
                    meta: false,
                    shift: false,
                    option: false,
                    sequence: "\x1b[A",
                    raw: "\x1b[A",
                    code: "[A",
                    number: false,
                    eventType: "press",
                    source: "raw",
                }),
            ),
        );

        expect(sessionInputs(net)).toEqual(["\x1bOA"]);
    });

    it("forwards function keys from raw terminal events", async () => {
        const { net, bridge } = await setup();
        await bridge.attach();
        net.requests.length = 0;
        for (const [name, sequence] of [
            ["f1", "\x1bOP"],
            ["f5", "\x1b[15~"],
            ["f10", "\x1b[21~"],
        ]) {
            bridge.renderable.handleKeyPress(
                prepareForEmbeddedTerminal(
                    new KeyEvent({
                        name,
                        ctrl: false,
                        meta: false,
                        shift: false,
                        option: false,
                        sequence,
                        raw: sequence,
                        code: sequence.slice(1),
                        number: false,
                        eventType: "press",
                        source: "raw",
                    }),
                ),
            );
        }

        expect(sessionInputs(net)).toEqual(["\x1bOP", "\x1b[15~", "\x1b[21~"]);
    });

    it("forwards Alt shortcuts parsed from legacy and Kitty terminals as Alt", async () => {
        const parsed = (sequence: string, useKittyKeyboard: boolean): KeyEvent => {
            const event = parseKeypress(sequence, { useKittyKeyboard });
            if (!event) throw new Error(`unparsed ${JSON.stringify(sequence)}`);
            return prepareForEmbeddedTerminal(new KeyEvent(event));
        };
        for (const kittyStack of [[], [null, 1]]) {
            const { net, bridge } = await setup();
            net.responses.set(MSG.SESSION_SNAPSHOT, {
                snapshot: "",
                lastSequence: 0,
                cursorHidden: false,
                kittyStack,
                mouseEncoding: "x10",
            });
            await bridge.attach();
            net.requests.length = 0;
            bridge.renderable.handleKeyPress(parsed("\x1bb", false));
            bridge.renderable.handleKeyPress(parsed("\x1b[98;3u", true));
            bridge.renderable.handleKeyPress(parsed("\x1b[1;3D", false));
            bridge.renderable.handleKeyPress(parsed("\x1b\x7f", false));
            bridge.renderable.handleKeyPress(parsed("\x1b\x02", false));
            const expected =
                kittyStack.length === 0
                    ? ["\x1bb", "\x1bb", "\x1b[1;3D", "\x1b\x7f", "\x1b\x02"]
                    : ["\x1b[98;3u", "\x1b[98;3u", "\x1b[1;3D", "\x1b[127;3u", "\x1b[98;7u"];
            expect(sessionInputs(net)).toEqual(expected);
        }
    });

    it("lets OpenTUI encode press, repeat, release, and paste from real events", async () => {
        const { net, bridge } = await setup();
        net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "\x1b[?2004h",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [null, 3],
            mouseEncoding: "x10",
        });
        await bridge.attach();
        net.requests.length = 0;
        bridge.renderable.handleKeyPress(key("up", { eventType: "press" }));
        bridge.renderable.handleKeyPress(key("up", { eventType: "repeat", repeated: true }));
        bridge.renderable.handleKeyPress(key("up", { eventType: "release" }));
        bridge.renderable.handlePaste(new PasteEvent(new TextEncoder().encode("猫🙂")));
        expect(sessionInputs(net)).toEqual([
            "\x1b[1;1:1A",
            "\x1b[1;1:2A",
            "\x1b[1;1:3A",
            "\x1b[200~猫🙂\x1b[201~",
        ]);

        const unbracketed = await setup();
        unbracketed.net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "x10",
        });
        await unbracketed.bridge.attach();
        unbracketed.net.requests.length = 0;
        unbracketed.bridge.renderable.handlePaste(
            new PasteEvent(new TextEncoder().encode("plain 猫")),
        );
        expect(sessionInputs(unbracketed.net)).toEqual(["plain 猫"]);
    });

    it("reports child focus changes through SESSION_INPUT", async () => {
        const { net, bridge } = await setup();
        net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "\x1b[?1004h",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "x10",
        });
        await bridge.attach();
        net.requests.length = 0;
        bridge.focus();
        bridge.blur();
        expect(sessionInputs(net)).toEqual(["\x1b[I", "\x1b[O"]);
    });

    it("keeps rendering while input is disabled and drops child-bound bytes", async () => {
        const { test, net, bridge } = await setup();
        net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "transcript",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [null, 1],
            mouseEncoding: "sgr",
        });
        await bridge.attach();
        bridge.setInputEnabled(false);
        net.requests.length = 0;
        bridge.renderable.handleKeyPress(key("a"));
        bridge.renderable.handlePaste(new PasteEvent(new TextEncoder().encode("paste")));
        bridge.focus();
        bridge.blur();
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: " retained", sequence: 1 });
        await test.renderOnce();
        expect(sessionInputs(net)).toEqual([]);
        expect(bridge.renderable.screen().text).toContain("transcript retained");
    });

    it("lets OpenTUI own disabled, X10, SGR, drag, and any-motion mouse modes", async () => {
        const disabled = await setup();
        disabled.net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "x10",
        });
        await disabled.bridge.attach();
        disabled.net.requests.length = 0;
        await disabled.test.renderOnce();
        await disabled.test.mockMouse.click(1, 1);
        expect(sessionInputs(disabled.net)).toEqual([]);

        const x10 = await setup(120, 8);
        x10.net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "\x1b[?9h",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "x10",
        });
        await x10.bridge.attach();
        x10.net.requests.length = 0;
        await x10.test.renderOnce();
        await x10.test.mockMouse.pressDown(94, 0);
        await x10.test.mockMouse.release(94, 0);
        await x10.test.mockMouse.pressDown(95, 0);
        expect(sessionInputs(x10.net)).toEqual(["\x1b[M \x7f!"]);

        const sgr = await setup();
        sgr.net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "\x1b[?1000h",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "sgr",
        });
        await sgr.bridge.attach();
        sgr.net.requests.length = 0;
        await sgr.test.renderOnce();
        await sgr.test.mockMouse.click(1, 1);
        expect(sessionInputs(sgr.net)).toEqual(["\x1b[<0;2;2M", "\x1b[<0;2;2m"]);

        const motion = await setup();
        motion.net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "\x1b[?1003h",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "sgr",
        });
        await motion.bridge.attach();
        motion.net.requests.length = 0;
        await motion.test.renderOnce();
        await motion.test.mockMouse.moveTo(3, 2);
        expect(sessionInputs(motion.net)).toEqual(["\x1b[<35;4;3M"]);

        const drag = await setup();
        drag.net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "\x1b[?1002h",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "sgr",
        });
        await drag.bridge.attach();
        drag.net.requests.length = 0;
        await drag.test.renderOnce();
        await drag.test.mockMouse.drag(1, 1, 4, 1);
        expect(sessionInputs(drag.net).length).toBeGreaterThanOrEqual(3);
    });

    it("refuses SGR pixel mouse input without pixel geometry", async () => {
        const { test, net, bridge } = await setup();
        net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: "\x1b[?1000h",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "sgr-pixels",
        });
        await bridge.attach();
        net.requests.length = 0;
        await test.renderOnce();
        await test.mockMouse.click(1, 1);
        expect(sessionInputs(net)).toEqual([]);
    });

    it("retains 5,000 full lines at 200 columns", async () => {
        const { test, net, bridge } = await setup(200, 6);
        const lines = Array.from({ length: 5005 }, (_, index) => {
            const prefix = `line-${String(index).padStart(4, "0")}`;
            return `${prefix}${"x".repeat(200 - prefix.length)}\r\n`;
        }).join("");
        net.responses.set(MSG.SESSION_SNAPSHOT, {
            snapshot: lines,
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "x10",
        });
        await bridge.attach();
        await test.renderOnce();

        for (let index = 0; index < 1669; index += 1) {
            await test.mockMouse.scroll(1, 1, "up");
            if (index % 50 === 49) await test.flush();
        }
        await test.flush();
        await test.renderOnce();
        expect(bridge.renderable.screen().text).toContain("line-0000");
    });
});
