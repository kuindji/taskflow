import { describe, it, expect, afterEach } from "bun:test";
import { PtyManager } from "../../src/services/pty-manager";

const isWindows = process.platform === "win32";
const testShell = isWindows ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh";
const catCommand = isWindows ? "cmd.exe" : "/bin/cat";
const catArgs = isWindows ? ["/c", "type", "CON"] : [];

describe("PtyManager", () => {
    const manager = new PtyManager();

    afterEach(() => {
        manager.closeAll();
    });

    it("spawns a shell session and receives output", async () => {
        let output = "";
        const sessionId = manager.spawn({
            command: "echo",
            args: ["hello-pty-test"],
            cwd: "/tmp",
            onData: (data) => {
                output += data;
            },
            onExit: () => {},
        });

        expect(sessionId).toBeTruthy();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        expect(output).toContain("hello-pty-test");
    });

    it("sends input to a session", async () => {
        let output = "";
        const sessionId = manager.spawn({
            command: catCommand,
            args: catArgs,
            cwd: "/tmp",
            onData: (data) => {
                output += data;
            },
            onExit: () => {},
        });

        manager.write(sessionId, "test-input\n");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(output).toContain("test-input");
        const snapshot = manager.getScrollback(sessionId);
        expect(snapshot.data).toContain("test-input");
        expect(snapshot.lastSequence).toBeGreaterThan(0);
        manager.close(sessionId);
    });

    it("applies early resize requests before the first screen update", async () => {
        let output = "";
        const sessionId = manager.spawn({
            command: testShell,
            args: ["-lc", "sleep 0.2; stty size"],
            cwd: "/tmp",
            onData: (data) => {
                output += data;
            },
            onExit: () => {},
        });

        manager.resize(sessionId, 80, 24);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(output).toContain("24 80");
    });

    it("sets COLORTERM=truecolor for PTY sessions", async () => {
        let output = "";
        const sessionId = manager.spawn({
            command: testShell,
            args: ["-lc", 'printf %s "$COLORTERM"'],
            cwd: "/tmp",
            onData: (data) => {
                output += data;
            },
            onExit: () => {},
        });

        expect(sessionId).toBeTruthy();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(output).toContain("truecolor");
    });

    it("lists active sessions", () => {
        const id1 = manager.spawn({
            command: catCommand,
            args: catArgs,
            cwd: "/tmp",
            onData: () => {},
            onExit: () => {},
        });
        const id2 = manager.spawn({
            command: catCommand,
            args: catArgs,
            cwd: "/tmp",
            onData: () => {},
            onExit: () => {},
        });
        const sessions = manager.list();
        expect(sessions).toContain(id1);
        expect(sessions).toContain(id2);
    });

    it("closes a session", () => {
        const sessionId = manager.spawn({
            command: catCommand,
            args: catArgs,
            cwd: "/tmp",
            onData: () => {},
            onExit: () => {},
        });
        manager.close(sessionId);
        expect(manager.list()).not.toContain(sessionId);
    });
});
