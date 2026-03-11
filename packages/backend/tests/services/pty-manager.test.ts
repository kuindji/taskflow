import { describe, it, expect, afterEach } from "bun:test";
import { PtyManager } from "../../src/services/pty-manager";

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
            command: "/bin/cat",
            args: [],
            cwd: "/tmp",
            onData: (data) => {
                output += data;
            },
            onExit: () => {},
        });

        manager.write(sessionId, "test-input\n");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(output).toContain("test-input");
        manager.close(sessionId);
    });

    it("lists active sessions", () => {
        const id1 = manager.spawn({
            command: "/bin/cat",
            args: [],
            cwd: "/tmp",
            onData: () => {},
            onExit: () => {},
        });
        const id2 = manager.spawn({
            command: "/bin/cat",
            args: [],
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
            command: "/bin/cat",
            args: [],
            cwd: "/tmp",
            onData: () => {},
            onExit: () => {},
        });
        manager.close(sessionId);
        expect(manager.list()).not.toContain(sessionId);
    });
});
