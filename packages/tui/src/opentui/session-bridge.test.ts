import { afterEach, describe, expect, it } from "bun:test";
import { KeyEvent, PasteEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { MSG } from "@taskflow/shared";
import type { NetLike } from "../net/client";
import { SessionBridge } from "./session-bridge";
import { prepareForEmbeddedTerminal } from "./keys";
import type { Osc52Sink } from "./osc52";

class FakeNet implements NetLike {
    readonly requests: Array<{ type: string; payload: unknown }> = [];
    readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
    responses = new Map<string, unknown>();

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
