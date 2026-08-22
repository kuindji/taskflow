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
