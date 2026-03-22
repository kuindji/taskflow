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
