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

    it("returns null snapshot for unknown session", () => {
        const result = manager.getSnapshot("nonexistent");
        expect(result.snapshot).toBeNull();
        expect(result.lastSequence).toBe(0);
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

        const result = manager.getSnapshot(sessionId);
        expect(result.snapshot).not.toBeNull();
        expect(result.snapshot).toContain("snapshot-test");
        expect(result.lastSequence).toBeGreaterThan(0);
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
        expect(manager.getSnapshot(sessionId).kittyStack).toEqual([null, 5]);
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
        expect(manager.getSnapshot(sessionId).kittyStack).toEqual([null, 1]);
        manager.close(sessionId);
    });

    it("does not claim a sequence the restored log has not been parsed into yet", () => {
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
        const immediate = manager.getSnapshot(sessionId);
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
        const settled = manager.getSnapshot(sessionId);
        expect(settled.kittyStack).toEqual([null, 5]);
        expect(settled.lastSequence).toBe(7);

        manager.close(sessionId);
    });

    it("does not claim a live batch the headless terminal has not parsed", async () => {
        let sessionId = "";
        const seen: Array<{ sequence: number; reported: number }> = [];
        sessionId = manager.spawn({
            command: testShell,
            args: [],
            cwd: testCwd,
            onData: (_data, sequence) => {
                // Skipped only for output that beats spawn() returning.
                if (sessionId === "") return;
                seen.push({ sequence, reported: manager.getSnapshot(sessionId).lastSequence });
            },
            onExit: () => {},
        });

        await new Promise((resolve) => setTimeout(resolve, 300));
        manager.write(sessionId, isWindows ? "echo live\r\n" : "live\n");
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect(seen.length).toBeGreaterThan(0);
        // At the instant a batch is handed to subscribers it has only been
        // queued into the headless terminal, so the snapshot must report the
        // sequence it has actually caught up to, not the one just issued.
        for (const entry of seen) expect(entry.reported).toBeLessThan(entry.sequence);

        manager.close(sessionId);
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
