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

describe("PtyManager initialInput", () => {
    const manager = new PtyManager();

    afterEach(() => {
        manager.closeAll();
    });

    it.skipIf(isWindows)(
        "injects initial input once startup output goes quiet, then submits it",
        async () => {
            let output = "";
            manager.spawn({
                // prints startup output like a TUI, then waits for a submitted line;
                // `stty -echo` + `read` proves the trailing Enter actually arrived —
                // PTY echo alone would show the paste without the submit.
                command: "/bin/sh",
                args: [
                    "-c",
                    "stty -echo; echo booting; IFS= read -r line; printf 'got:%s\\n' \"$line\"",
                ],
                cwd: testCwd,
                onData: (data) => {
                    output += data;
                },
                onExit: () => {},
                initialInput: "hello injected world",
            });
            // startup output + quiet window (500ms) + submit delay (50ms) + slack
            await new Promise((resolve) => setTimeout(resolve, 2000));
            expect(output).toContain("booting");
            // the payload only appears after "got:" once read receives the newline
            // (the bracketed-paste escape bytes may surround it inside the line)
            expect(output).toMatch(/got:.*hello injected world/);
        },
    );

    it.skipIf(isWindows)("does not write when no initialInput is given", async () => {
        let output = "";
        manager.spawn({
            command: "/bin/cat",
            args: [],
            cwd: testCwd,
            onData: (data) => {
                output += data;
            },
            onExit: () => {},
        });
        await new Promise((resolve) => setTimeout(resolve, 800));
        expect(output).toBe("");
    });

    it.skipIf(isWindows)(
        "close() before the quiet window elapses cancels the pending injection",
        async () => {
            let output = "";
            const id = manager.spawn({
                command: "/bin/sh",
                args: ["-c", "echo booting; exec cat"],
                cwd: testCwd,
                onData: (data) => {
                    output += data;
                },
                onExit: () => {},
                initialInput: "should never appear",
            });
            // close while the quiet window is still pending
            await new Promise((resolve) => setTimeout(resolve, 200));
            manager.close(id);
            await new Promise((resolve) => setTimeout(resolve, 800));
            expect(output).not.toContain("should never appear");
        },
    );
});
