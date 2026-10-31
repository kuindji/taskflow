import { describe, it, expect, spyOn, afterEach, type Mock } from "bun:test";
import { tmpdir } from "os";
import { WindowsPtySession } from "../../src/services/pty-session-win";

/**
 * Stands in for the node-pty bridge process: records the NDJSON messages it
 * receives on stdin and answers `kill` the way pty-bridge.mjs does, with an
 * `exit` line followed by the bridge exiting.
 */
function fakeBridge() {
    const received: Array<{ type: string }> = [];
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let stdout!: ReadableStreamDefaultController<Uint8Array>;
    let exit!: (code: number) => void;
    const exited = new Promise<number>((resolve) => {
        exit = resolve;
    });
    let killed = false;
    const proc = {
        stdout: new ReadableStream<Uint8Array>({
            start(controller) {
                stdout = controller;
            },
        }),
        stdin: {
            write(bytes: Uint8Array): number {
                for (const line of decoder.decode(bytes).split("\n")) {
                    if (!line) continue;
                    const msg = JSON.parse(line) as { type: string };
                    received.push(msg);
                    if (msg.type === "kill") {
                        stdout.enqueue(
                            encoder.encode(`${JSON.stringify({ type: "exit", exitCode: 0 })}\n`),
                        );
                        setTimeout(() => exit(0), 10);
                    }
                }
                return bytes.length;
            },
        },
        exited,
        kill() {
            killed = true;
            exit(1);
        },
    };
    return { proc, received, wasForceKilled: () => killed };
}

describe("WindowsPtySession", () => {
    const spies: Array<Mock<(...args: never[]) => unknown>> = [];
    afterEach(() => {
        for (const spy of spies.splice(0)) spy.mockRestore();
    });

    it("kill() asks the bridge to kill the child and reports the exit once", async () => {
        const bridge = fakeBridge();
        spies.push(
            spyOn(Bun, "which").mockReturnValue("/usr/bin/node"),
            spyOn(Bun, "spawn").mockReturnValue(bridge.proc as never),
        );
        let exitCount = 0;
        const session = new WindowsPtySession({
            command: "cmd.exe",
            args: [],
            cwd: tmpdir(),
            env: {},
            cols: 80,
            rows: 24,
            onData: () => {},
            onExit: () => {
                exitCount += 1;
            },
        });

        session.kill();
        await new Promise((resolve) => setTimeout(resolve, 700));

        expect(bridge.received.map((msg) => msg.type)).toEqual(["spawn", "kill"]);
        expect(bridge.wasForceKilled()).toBe(false);
        expect(exitCount).toBe(1);
    });
});
