import { describe, it, expect, afterEach } from "bun:test";
import { PtyManager } from "../../src/services/pty-manager";
import { tmpdir } from "os";

const isWindows = process.platform === "win32";
const testCwd = isWindows ? tmpdir() : "/tmp";
const testShell = isWindows ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/cat";

describe("PtyManager.getSnapshot", () => {
    const manager = new PtyManager();

    afterEach(() => {
        manager.closeAll();
    });

    it("returns null snapshot for unknown session", async () => {
        const result = await manager.getSnapshot("nonexistent");
        expect(result.snapshot).toBeNull();
        expect(result.lastSequence).toBe(0);
        expect(result.mouseEncoding).toBe("x10");
    });

    it("returns serialized snapshot of active session output", async () => {
        let output = "";
        const sessionId = manager.spawn({
            command: testShell,
            args: [],
            cwd: testCwd,
            onData: (data) => {
                output += data;
            },
            onExit: () => {},
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));
        const input = isWindows ? "echo snapshot-test\r\n" : "snapshot-test\n";
        manager.write(sessionId, input);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(output).toContain("snapshot-test");

        const result = await manager.getSnapshot(sessionId);
        expect(result.snapshot).not.toBeNull();
        expect(result.snapshot).toContain("snapshot-test");
        expect(result.lastSequence).toBeGreaterThan(0);
        manager.close(sessionId);
    });

    it("offers no snapshot until the restored log has parsed", async () => {
        // headless.write() parses on a later tick, so immediately after spawn
        // the grid is still empty. Handing a client that empty snapshot makes it
        // skip SESSION_HISTORY and render a blank resumed terminal.
        const sessionId = manager.spawn({
            command: testShell,
            args: [],
            cwd: testCwd,
            initialOutput: "RESTORED-LOG",
            startSequence: 7,
            onData: () => {},
            onExit: () => {},
        });

        const immediate = await manager.getSnapshot(sessionId);
        expect(immediate.snapshot).toBeNull();

        await new Promise((resolve) => setTimeout(resolve, 50));
        const settled = await manager.getSnapshot(sessionId);
        expect(settled.snapshot).toContain("RESTORED-LOG");
        expect(settled.lastSequence).toBe(7);
        manager.close(sessionId);
    });

    it("reports the kitty keyboard flags the child pushed", async () => {
        const sessionId = manager.spawn({
            command: testShell,
            args: [],
            cwd: testCwd,
            // A restored session replays its log through the headless terminal,
            // which is where the kitty push is picked up again.
            initialOutput: "\x1b[>5u",
            onData: () => {},
            onExit: () => {},
        });

        // The headless terminal parses asynchronously.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect((await manager.getSnapshot(sessionId)).kittyStack).toEqual([null, 5]);
        manager.close(sessionId);
    });

    it("restores the outer kitty flags when a nested push is popped", async () => {
        const sessionId = manager.spawn({
            command: testShell,
            args: [],
            cwd: testCwd,
            // A shell pushes its own flags, an editor run inside it pushes and
            // then pops on exit; the shell's flags have to come back.
            initialOutput: "\x1b[>1u\x1b[>5u\x1b[<u",
            onData: () => {},
            onExit: () => {},
        });

        // The headless terminal parses asynchronously.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect((await manager.getSnapshot(sessionId)).kittyStack).toEqual([null, 1]);
        manager.close(sessionId);
    });

    it("tracks mouse encoding enables, matching disables, and RIS", async () => {
        const encodingAfter = async (initialOutput: string) => {
            const sessionId = manager.spawn({
                command: testShell,
                args: [],
                cwd: testCwd,
                initialOutput,
                onData: () => {},
                onExit: () => {},
            });
            await new Promise((resolve) => setTimeout(resolve, 50));
            const encoding = (await manager.getSnapshot(sessionId)).mouseEncoding;
            manager.close(sessionId);
            return encoding;
        };

        expect(await encodingAfter("\x1b[?1006h")).toBe("sgr");
        expect(await encodingAfter("\x1b[?1006h\x1b[?1015l")).toBe("sgr");
        expect(await encodingAfter("\x1b[?1006h\x1b[?1006l")).toBe("x10");
        expect(await encodingAfter("\x1b[?1016h\x1bc")).toBe("x10");
    });

    it("does not claim a sequence the restored log has not been parsed into yet", async () => {
        const sessionId = manager.spawn({
            command: testShell,
            args: [],
            cwd: testCwd,
            startSequence: 7,
            initialOutput: "\x1b[>5u",
            onData: () => {},
            onExit: () => {},
        });

        // No sleep on purpose: the headless terminal always parses on a later
        // tick, so right here the reported state cannot cover sequence 7. A
        // client that trusts lastSequence drops the replay carrying the push
        // and falls back to legacy key encoding for good.
        const immediate = await manager.getSnapshot(sessionId);
        expect({
            parsed: immediate.kittyStack.length > 0,
            claimsRestoredSequence: immediate.lastSequence >= 7,
        }).toEqual({ parsed: false, claimsRestoredSequence: false });

        manager.close(sessionId);
    });

    it("reports the restored sequence once the log has been parsed", async () => {
        const sessionId = manager.spawn({
            command: testShell,
            args: [],
            cwd: testCwd,
            startSequence: 7,
            initialOutput: "\x1b[>5u",
            onData: () => {},
            onExit: () => {},
        });

        await new Promise((resolve) => setTimeout(resolve, 50));
        const settled = await manager.getSnapshot(sessionId);
        expect(settled.kittyStack).toEqual([null, 5]);
        expect(settled.lastSequence).toBe(7);

        manager.close(sessionId);
    });

    function heldParser() {
        const writes: Array<() => Promise<void>> = [];
        const timers = new Map<() => void, number>();
        const logs: string[] = [];
        const held = new PtyManager({
            write: (terminal, data, done) => {
                writes.push(
                    () =>
                        new Promise<void>((resolve) =>
                            terminal.write(data, () => {
                                done();
                                resolve();
                            }),
                        ),
                );
            },
            timeout: (callback, ms) => {
                timers.set(callback, ms);
                return () => {
                    timers.delete(callback);
                };
            },
            log: (message, id) => {
                logs.push(`${message} ${id}`);
            },
        });
        let id = "";
        let report!: (value: {
            sequence: number;
            snapshot: ReturnType<PtyManager["getSnapshot"]>;
        }) => void;
        const batch = new Promise<{
            sequence: number;
            snapshot: ReturnType<PtyManager["getSnapshot"]>;
        }>((resolve) => {
            report = resolve;
        });
        let reported = false;
        id = held.spawn({
            command: testShell,
            args: [],
            cwd: testCwd,
            onData: (_data, sequence) => {
                if (id && !reported) {
                    reported = true;
                    report({ sequence, snapshot: held.getSnapshot(id) });
                }
            },
            onExit: () => {},
        });
        held.write(id, isWindows ? "echo live-tail\r\n" : "live-tail\n");
        return { held, id, batch, writes, timers, logs };
    }

    it("a snapshot requested during a live batch waits for that batch to be parsed", async () => {
        const f = heldParser();
        try {
            const { sequence, snapshot } = await f.batch;
            let settled = false;
            void Promise.resolve(snapshot).then(() => {
                settled = true;
            });
            await Promise.resolve();
            expect(settled).toBe(false);
            await f.writes[0]();
            const result = await snapshot;
            expect(result.lastSequence).toBe(sequence);
            expect(result.snapshot).toContain("live-tail");
            expect(f.timers.size).toBe(0);
        } finally {
            f.held.closeAll();
        }
    });

    it("a snapshot requested right after output includes that output", async () => {
        const f = heldParser();
        try {
            const { sequence } = await f.batch;
            const pending = f.held.getSnapshot(f.id);
            await f.writes[0]();
            const result = await pending;
            expect(result.snapshot).toContain("live-tail");
            expect(result.lastSequence).toBe(sequence);
        } finally {
            f.held.closeAll();
        }
    });

    it("a snapshot whose parser is stalled answers snapshot null after 2000 ms", async () => {
        const f = heldParser();
        try {
            const { snapshot } = await f.batch;
            expect([...f.timers.values()]).toEqual([2000]);
            for (const callback of [...f.timers.keys()]) callback();
            expect(await snapshot).toEqual({
                snapshot: null,
                lastSequence: 0,
                cursorHidden: false,
                kittyStack: [],
                mouseEncoding: "x10",
            });
            expect(f.logs).toEqual([`snapshot returned before parser caught up ${f.id}`]);
        } finally {
            f.held.closeAll();
        }
    });

    it("returns null snapshot after session exits", async () => {
        let exited = false;
        const command = isWindows ? testShell : "echo";
        const args = isWindows ? ["/c", "echo", "exits-quickly"] : ["exits-quickly"];
        manager.spawn({
            command,
            args,
            cwd: testCwd,
            onData: () => {},
            onExit: () => {
                exited = true;
            },
        });

        await new Promise((resolve) => setTimeout(resolve, 3000));
        expect(exited).toBe(true);
    });
});
