import { describe, expect, it } from "bun:test";
import type { SessionHistoryResponse, SessionSnapshotResponse } from "@taskflow/shared";
import { createTerminalAttachment } from "./terminal-attachment";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
const snapshot = (text = "screen", lastSequence = 4): SessionSnapshotResponse => ({
    snapshot: text,
    lastSequence,
    cursorHidden: false,
    kittyStack: [],
    mouseEncoding: "x10",
});
const tick = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
};

function fixture() {
    const snapshots: Array<ReturnType<typeof deferred<SessionSnapshotResponse>>> = [];
    const histories: Array<ReturnType<typeof deferred<SessionHistoryResponse>>> = [];
    const flushes: Array<ReturnType<typeof deferred<undefined>>> = [];
    const writes: string[] = [],
        input: string[] = [],
        actions: string[] = [];
    let holdFlush = false;
    let onWrite = (_data: string) => {};
    const attachment = createTerminalAttachment({
        sessionId: "s1",
        requestSnapshot() {
            const d = deferred<SessionSnapshotResponse>();
            snapshots.push(d);
            return d.promise;
        },
        requestHistory() {
            const d = deferred<SessionHistoryResponse>();
            histories.push(d);
            return d.promise;
        },
        writer: {
            write(data) {
                writes.push(data);
                actions.push(`write:${data}`);
                onWrite(data);
            },
            flush() {
                actions.push("flush");
                if (!holdFlush) return Promise.resolve();
                const d = deferred<undefined>();
                flushes.push(d);
                return d.promise;
            },
        },
        reset() {
            actions.push("reset");
            writes.length = 0;
        },
        scrollToBottom() {
            actions.push("scroll");
        },
    });
    const send = (data: string) => input.push(data);
    return {
        attachment,
        snapshots,
        histories,
        flushes,
        writes,
        input,
        actions,
        send,
        hold() {
            holdFlush = true;
        },
        release() {
            holdFlush = false;
            for (const d of flushes.splice(0)) d.resolve(undefined);
        },
        onWrite(fn: (data: string) => void) {
            onWrite = fn;
        },
        output(sequence: number, data = `chunk${sequence}`, sessionId = "s1") {
            attachment.receiveOutput({ sessionId, sequence, data });
        },
        async load() {
            const p = attachment.ensureLoaded();
            snapshots[snapshots.length - 1].resolve(snapshot());
            await p;
        },
    };
}

describe("terminal attachment replay", () => {
    it("snapshot replay drops terminal replies and user keys until parsing completes", async () => {
        const f = fixture();
        f.onWrite(() => {
            for (const data of ["\x1b[0n", "\x1b[1;1R", "x"])
                f.attachment.forwardInput(data, f.send);
        });
        const pending = f.attachment.ensureLoaded();
        f.hold();
        f.snapshots[0].resolve(snapshot("\x1b[5n\x1b[6n"));
        await tick();
        f.flushes.shift()?.resolve(undefined);
        await tick();
        f.output(5, "\x1b[5n\x1b[6n");
        expect(f.input).toEqual([]);
        f.attachment.forwardInput("x", f.send);
        expect(f.input).toEqual([]);
        f.release();
        await pending;
        expect(f.input).toEqual([]);
        f.attachment.forwardInput("\x1b[0n", f.send);
        expect(f.input).toEqual(["\x1b[0n"]);
    });
    it("history replay drops terminal replies until its final flush completes", async () => {
        const f = fixture();
        f.onWrite(() => f.attachment.forwardInput("\x1b[1;1R", f.send));
        const pending = f.attachment.ensureLoaded();
        f.snapshots[0].resolve({ ...snapshot(), snapshot: null });
        await tick();
        f.hold();
        f.histories[0].resolve({ data: "\x1b[5n\x1b[6n", lastSequence: 4 });
        await tick();
        f.flushes.shift()?.resolve(undefined);
        await tick();
        f.attachment.forwardInput("x", f.send);
        expect(f.input).toEqual([]);
        f.release();
        await pending;
    });
    it("supplemental snapshot state remains inside the replay suppression window", async () => {
        const f = fixture();
        f.onWrite(() => f.attachment.forwardInput("x", f.send));
        const pending = f.attachment.ensureLoaded();
        f.snapshots[0].resolve({
            ...snapshot(),
            cursorHidden: true,
            kittyStack: [null, 5],
            mouseEncoding: "sgr",
        });
        await pending;
        expect(f.writes.join("")).toContain("\x1b[?1006h");
        expect(f.writes.join("")).toContain("\x1b[?25l");
        expect(f.input).toEqual([]);
    });
    it("live terminal replies are sent once after replay completes", async () => {
        const f = fixture();
        await f.load();
        f.onWrite(() => f.attachment.forwardInput("\x1b[0n", f.send));
        f.output(5, "\x1b[5n");
        expect(f.input).toEqual(["\x1b[0n"]);
    });
    it("a failed replacement preserves the last good screen and releases suppression", async () => {
        const f = fixture();
        await f.load();
        const good = [...f.writes];
        const pending = f.attachment.resync();
        f.snapshots[1].reject(new Error("offline"));
        await tick();
        f.histories[0].reject(new Error("offline"));
        await pending.then(
            () => {
                throw new Error("Expected rejection");
            },
            (error: unknown) => {
                expect(error).toMatchObject({ message: "offline" });
            },
        );
        expect(f.writes).toEqual(good);
        f.attachment.forwardInput("x", f.send);
        expect(f.input).toEqual(["x"]);
    });
    it("disposing during a pending snapshot never writes to the terminal", async () => {
        const f = fixture();
        const pending = f.attachment.ensureLoaded();
        f.attachment.dispose();
        f.snapshots[0].resolve(snapshot());
        await pending;
        expect(f.writes).toEqual([]);
        expect(f.actions).toEqual([]);
        f.attachment.forwardInput("x", f.send);
        expect(f.input).toEqual([]);
    });
    it("ensureLoaded is idempotent but resync fetches a fresh snapshot", async () => {
        const f = fixture();
        await f.load();
        await f.attachment.ensureLoaded();
        expect(f.snapshots.length).toBe(1);
        const pending = f.attachment.resync();
        f.snapshots[1].resolve(snapshot("new"));
        await pending;
        expect(f.snapshots.length).toBe(2);
        expect(f.writes[0]).toBe("new");
    });
});
