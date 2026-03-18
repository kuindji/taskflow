import { describe, it, expect, afterEach } from "bun:test";
import { PtyManager } from "../../src/services/pty-manager";

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
            command: "/bin/cat",
            args: [],
            cwd: "/tmp",
            onData: (data) => {
                output += data;
            },
            onExit: () => {},
        });

        manager.write(sessionId, "snapshot-test\n");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(output).toContain("snapshot-test");

        const result = manager.getSnapshot(sessionId);
        expect(result.snapshot).not.toBeNull();
        expect(result.snapshot).toContain("snapshot-test");
        expect(result.lastSequence).toBeGreaterThan(0);
        manager.close(sessionId);
    });

    it("returns null snapshot after session exits", async () => {
        let exited = false;
        manager.spawn({
            command: "echo",
            args: ["exits-quickly"],
            cwd: "/tmp",
            onData: () => {},
            onExit: () => {
                exited = true;
            },
        });

        await new Promise((resolve) => setTimeout(resolve, 2000));
        expect(exited).toBe(true);
    });
});
