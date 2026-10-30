import { afterEach, describe, expect, it } from "bun:test";
import { TimeBudgetedWriter } from "./time-budgeted-writer";

type WriteCall = { data: string; callback?: () => void };

class FakeTerminal {
    writes: WriteCall[] = [];

    write(data: string, callback?: () => void): void {
        this.writes.push({ data, callback });
    }
}

describe("TimeBudgetedWriter", () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

    let nextAnimationFrameId = 0;
    let scheduledFrame: FrameRequestCallback | null = null;

    afterEach(() => {
        scheduledFrame = null;
        nextAnimationFrameId = 0;
        globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    });

    function setup() {
        globalThis.requestAnimationFrame = (callback) => {
            scheduledFrame = callback;
            return ++nextAnimationFrameId;
        };
        globalThis.cancelAnimationFrame = () => {};
        const term = new FakeTerminal();
        return {
            term,
            writer: new TimeBudgetedWriter(term as never),
            frame: () => scheduledFrame?.(0),
        };
    }

    it("flush waits for xterm when the JavaScript buffer is already empty", async () => {
        const { term, writer, frame } = setup();
        writer.write("hello");
        frame();
        let settled = false;
        const pending = writer.flush().then(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        term.writes[1].callback?.();
        await pending;
        expect(settled).toBe(true);
    });

    it("an earlier sentinel cannot resolve flush while a later frame is unparsed", async () => {
        const { term, writer, frame } = setup();
        writer.write("first");
        frame();
        writer.write("second");
        let settled = false;
        const pending = writer.flush().then(() => {
            settled = true;
        });
        frame();
        term.writes[1].callback?.();
        await Promise.resolve();
        expect(settled).toBe(false);
        term.writes[3].callback?.();
        await pending;
        expect(settled).toBe(true);
    });

    it("an empty animation frame cannot resolve flush before pending sentinels", async () => {
        const { term, writer, frame } = setup();
        writer.write("hello");
        frame();
        let settled = false;
        const pending = writer.flush().then(() => {
            settled = true;
        });
        frame();
        await Promise.resolve();
        expect(settled).toBe(false);
        term.writes[1].callback?.();
        await pending;
        expect(settled).toBe(true);
    });

    it("invokes write hooks around a frame and resolves flush after xterm processes the sentinel", async () => {
        globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
            scheduledFrame = callback;
            nextAnimationFrameId += 1;
            return nextAnimationFrameId;
        };
        globalThis.cancelAnimationFrame = () => {};

        const term = new FakeTerminal();
        const writer = new TimeBudgetedWriter(term as never);
        const events: string[] = [];

        writer.onBeforeWrite = () => {
            events.push("before");
        };
        writer.onDidWrite = (bufferDrained: boolean) => {
            events.push(`after:${bufferDrained ? "drained" : "pending"}`);
        };

        writer.write("hello");
        const flushPromise = writer.flush().then(() => {
            events.push("flushed");
        });

        expect(scheduledFrame).not.toBeNull();
        expect(events).toEqual([]);

        scheduledFrame?.(0);

        expect(term.writes.map((call) => call.data)).toEqual(["hello", ""]);
        expect(events).toEqual(["before"]);

        term.writes[1]?.callback?.();
        await flushPromise;

        expect(events).toEqual(["before", "after:drained", "flushed"]);
    });
});
