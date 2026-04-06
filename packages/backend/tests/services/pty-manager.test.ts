import { describe, it, expect, afterEach } from "bun:test";
import { PtyManager } from "../../src/services/pty-manager";
import { tmpdir } from "os";

const isWindows = process.platform === "win32";
const testShell = isWindows ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh";
const testCwd = isWindows ? tmpdir() : "/tmp";

describe("PtyManager", () => {
    const manager = new PtyManager();

    afterEach(() => {
        manager.closeAll();
    });

    it("spawns a shell session and receives output", async () => {
        let output = "";
        const command = isWindows ? testShell : "echo";
        const args = isWindows ? ["/c", "echo", "hello-pty-test"] : ["hello-pty-test"];
        const sessionId = manager.spawn({
            command,
            args,
            cwd: testCwd,
            onData: (data) => {
                output += data;
            },
            onExit: () => {},
        });

        expect(sessionId).toBeTruthy();
        await new Promise((resolve) => setTimeout(resolve, 3000));
        expect(output).toContain("hello-pty-test");
    });

    it("sends input to a session", async () => {
        let output = "";
        const command = isWindows ? testShell : "/bin/cat";
        const args = isWindows ? [] : [];
        const sessionId = manager.spawn({
            command,
            args,
            cwd: testCwd,
            onData: (data) => {
                output += data;
            },
            onExit: () => {},
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));
        const input = isWindows ? "echo test-input\r\n" : "test-input\n";
        manager.write(sessionId, input);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(output).toContain("test-input");
        const snapshot = manager.getScrollback(sessionId);
        expect(snapshot.data).toContain("test-input");
        expect(snapshot.lastSequence).toBeGreaterThan(0);
        manager.close(sessionId);
    });

    it.skipIf(isWindows)(
        "applies early resize requests before the first screen update",
        async () => {
            let output = "";
            const sessionId = manager.spawn({
                command: testShell,
                args: ["-lc", "sleep 0.2; stty size"],
                cwd: testCwd,
                onData: (data) => {
                    output += data;
                },
                onExit: () => {},
            });

            manager.resize(sessionId, 80, 24);
            await new Promise((resolve) => setTimeout(resolve, 1000));
            expect(output).toContain("24 80");
        },
    );

    it.skipIf(isWindows)("sets COLORTERM=truecolor for PTY sessions", async () => {
        let output = "";
        const sessionId = manager.spawn({
            command: testShell,
            args: ["-lc", 'printf %s "$COLORTERM"'],
            cwd: testCwd,
            onData: (data) => {
                output += data;
            },
            onExit: () => {},
        });

        expect(sessionId).toBeTruthy();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(output).toContain("truecolor");
    });

    it("lists active sessions", async () => {
        const command = isWindows ? testShell : "/bin/cat";
        const id1 = manager.spawn({
            command,
            args: [],
            cwd: testCwd,
            onData: () => {},
            onExit: () => {},
        });
        const id2 = manager.spawn({
            command,
            args: [],
            cwd: testCwd,
            onData: () => {},
            onExit: () => {},
        });
        // On Windows, the bridge needs a moment to start
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const sessions = manager.list();
        expect(sessions).toContain(id1);
        expect(sessions).toContain(id2);
    });

    it("closes a session", async () => {
        const command = isWindows ? testShell : "/bin/cat";
        const sessionId = manager.spawn({
            command,
            args: [],
            cwd: testCwd,
            onData: () => {},
            onExit: () => {},
        });
        // On Windows, wait for bridge to start before closing
        await new Promise((resolve) => setTimeout(resolve, 500));
        manager.close(sessionId);
        expect(manager.list()).not.toContain(sessionId);
    });
});
