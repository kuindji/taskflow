import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, writeFile, chmod, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { startBackend, type BackendHandle } from "./manager";

const handles: BackendHandle[] = [];

afterEach(() => {
    while (handles.length > 0) {
        handles.pop()?.stop();
    }
});

async function writeFakeBackend(body: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "tui-backend-test-"));
    const path = join(dir, "fake-backend.sh");
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    return path;
}

async function start(...args: Parameters<typeof startBackend>): Promise<BackendHandle> {
    const handle = await startBackend(...args);
    handles.push(handle);
    return handle;
}

describe("startBackend", () => {
    test("resolves with the port the backend writes to its port file", async () => {
        const binary = await writeFakeBackend('echo 4321 > "$TASKFLOW_PORT_FILE"; exec sleep 30');
        const handle = await start({ binary, args: [], devBranch: null });
        expect(handle.port).toBe(4321);
    });

    test("passes TASKFLOW_DEV_BRANCH through to the child", async () => {
        // The fake backend encodes the branch it received into the port digits,
        // so a backend that never received it cannot make this assertion pass.
        const binary = await writeFakeBackend(
            'if [ "$TASKFLOW_DEV_BRANCH" = "my-branch" ]; then echo 4322 > "$TASKFLOW_PORT_FILE"; else echo 9999 > "$TASKFLOW_PORT_FILE"; fi; exec sleep 30',
        );
        const handle = await start({ binary, args: [], devBranch: "my-branch" });
        expect(handle.port).toBe(4322);
    });

    test("does not set TASKFLOW_DEV_BRANCH when devBranch is null", async () => {
        const binary = await writeFakeBackend(
            'if [ -z "$TASKFLOW_DEV_BRANCH" ]; then echo 4323 > "$TASKFLOW_PORT_FILE"; else echo 9999 > "$TASKFLOW_PORT_FILE"; fi; exec sleep 30',
        );
        const handle = await start({ binary, args: [], devBranch: null });
        expect(handle.port).toBe(4323);
    });

    test("strips the Claude Code session markers from the child environment", async () => {
        const previous = {
            CLAUDECODE: process.env.CLAUDECODE,
            CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT,
        };
        process.env.CLAUDECODE = "1";
        process.env.CLAUDE_CODE_ENTRYPOINT = "cli";
        try {
            const binary = await writeFakeBackend(
                'if [ -z "$CLAUDECODE" ] && [ -z "$CLAUDE_CODE_ENTRYPOINT" ]; then echo 4324 > "$TASKFLOW_PORT_FILE"; else echo 9999 > "$TASKFLOW_PORT_FILE"; fi; exec sleep 30',
            );
            const handle = await start({ binary, args: [], devBranch: null });
            expect(handle.port).toBe(4324);
        } finally {
            if (previous.CLAUDECODE === undefined) {
                delete process.env.CLAUDECODE;
            } else {
                process.env.CLAUDECODE = previous.CLAUDECODE;
            }
            if (previous.CLAUDE_CODE_ENTRYPOINT === undefined) {
                delete process.env.CLAUDE_CODE_ENTRYPOINT;
            } else {
                process.env.CLAUDE_CODE_ENTRYPOINT = previous.CLAUDE_CODE_ENTRYPOINT;
            }
        }
    });

    test("passes extra args through to the child", async () => {
        const binary = await writeFakeBackend(
            'if [ "$1" = "--flag" ]; then echo 4325 > "$TASKFLOW_PORT_FILE"; else echo 9999 > "$TASKFLOW_PORT_FILE"; fi; exec sleep 30',
        );
        const handle = await start({ binary, args: ["--flag"], devBranch: null });
        expect(handle.port).toBe(4325);
    });

    test("rejects when the backend exits before writing a port", async () => {
        const binary = await writeFakeBackend("exit 3");
        let message = "";
        try {
            handles.push(await startBackend({ binary, args: [], devBranch: null, timeoutMs: 2000 }));
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }
        expect(message).toMatch(/exited/);
    });

    test("rejects when the binary does not exist", async () => {
        let message = "";
        try {
            handles.push(
                await startBackend({
                    binary: join(tmpdir(), "taskflow-tui-no-such-binary"),
                    args: [],
                    devBranch: null,
                    timeoutMs: 2000,
                }),
            );
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }
        expect(message).toMatch(/failed to start/);
    });

    test("rejects when the backend never writes a port", async () => {
        const binary = await writeFakeBackend("exec sleep 30");
        let message = "";
        try {
            handles.push(await startBackend({ binary, args: [], devBranch: null, timeoutMs: 300 }));
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }
        expect(message).toMatch(/timeout/);
    });
    test("keeps a chatty backend running instead of wedging its stderr pipe", async () => {
        // 4MB of stderr before the port is written. Undrained, the pipe fills and
        // the child blocks forever on write(), so the port never appears.
        const binary = await writeFakeBackend(
            'yes xxxxxxxxxxxxxxxx | head -c 4000000 >&2; echo 4326 > "$TASKFLOW_PORT_FILE"; exec sleep 30',
        );
        const handle = await start({ binary, args: [], devBranch: null, timeoutMs: 4000 });
        expect(handle.port).toBe(4326);
    }, 20_000);

    test("reports the backend's stderr when it exits before startup", async () => {
        const binary = await writeFakeBackend('echo "bind: address already in use" >&2; exit 3');
        let message = "";
        try {
            handles.push(await startBackend({ binary, args: [], devBranch: null, timeoutMs: 2000 }));
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }
        expect(message).toMatch(/bind: address already in use/);
    });
    test("rejects when the backend writes a port and then dies", async () => {
        const binary = await writeFakeBackend('echo 4321 > "$TASKFLOW_PORT_FILE"; exit 7');
        let message = "";
        let port = 0;
        try {
            const handle = await startBackend({
                binary,
                args: [],
                devBranch: null,
                timeoutMs: 2000,
            });
            handles.push(handle);
            port = handle.port;
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }
        expect(port).toBe(0);
        expect(message).toMatch(/exited before startup \(code 7\)/);
    });

    test("ignores port-file contents that are not a bare port number", async () => {
        const binary = await writeFakeBackend(
            'printf "43x\\n" > "$TASKFLOW_PORT_FILE"; sleep 1; echo 4327 > "$TASKFLOW_PORT_FILE"; exec sleep 30',
        );
        const handle = await start({ binary, args: [], devBranch: null, timeoutMs: 4000 });
        expect(handle.port).toBe(4327);
    }, 10_000);

    test("gives concurrent starts their own port file", async () => {
        const slow = await writeFakeBackend('sleep 1; echo 4329 > "$TASKFLOW_PORT_FILE"; exec sleep 30');
        const fast = await writeFakeBackend('echo 4328 > "$TASKFLOW_PORT_FILE"; exec sleep 30');
        const [a, b] = await Promise.all([
            start({ binary: fast, args: [], devBranch: null, timeoutMs: 4000 }),
            start({ binary: slow, args: [], devBranch: null, timeoutMs: 4000 }),
        ]);
        expect(a.port).toBe(4328);
        expect(b.port).toBe(4329);
    }, 15_000);

    test("stop() removes the port file before it returns", async () => {
        // The fake backend echoes the port-file path it was given so the test can
        // watch it; a caller that exits right after stop() must leave nothing behind.
        const dir = await mkdtemp(join(tmpdir(), "tui-backend-portfile-"));
        const echoed = join(dir, "which-port-file");
        const binary = await writeFakeBackend(
            `printf '%s' "$TASKFLOW_PORT_FILE" > ${echoed}; echo 4331 > "$TASKFLOW_PORT_FILE"; exec sleep 30`,
        );
        const handle = await start({ binary, args: [], devBranch: null });
        const portFile = (await readFile(echoed, "utf-8")).trim();
        expect(existsSync(portFile)).toBe(true);
        handle.stop();
        expect(existsSync(portFile)).toBe(false);
    });

    test("does not accept a port that only appears after the deadline", async () => {
        // The backend never writes a port itself; the test writes it one poll interval
        // after the deadline has passed, which a loop that polls past its budget would
        // still accept.
        const dir = await mkdtemp(join(tmpdir(), "tui-backend-late-"));
        const echoed = join(dir, "which-port-file");
        const binary = await writeFakeBackend(
            `printf '%s' "$TASKFLOW_PORT_FILE" > ${echoed}; exec sleep 30`,
        );
        const timeoutMs = 1000;
        const started = Date.now();
        const pending = startBackend({ binary, args: [], devBranch: null, timeoutMs });
        const late = (async (): Promise<void> => {
            while (!existsSync(echoed)) await Bun.sleep(10);
            const portFile = (await readFile(echoed, "utf-8")).trim();
            await Bun.sleep(started + timeoutMs + 25 - Date.now());
            await writeFile(portFile, "4330");
        })();

        let message = "";
        let port = 0;
        try {
            const handle = await pending;
            handles.push(handle);
            port = handle.port;
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }
        await late;
        expect(port).toBe(0);
        expect(message).toMatch(/timeout/);
    }, 10_000);

    test("names the signal when the backend is killed before startup", async () => {
        const binary = await writeFakeBackend("kill -TERM $$");
        let message = "";
        try {
            handles.push(await startBackend({ binary, args: [], devBranch: null, timeoutMs: 2000 }));
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }
        expect(message).toMatch(/exited before startup \(signal SIGTERM\)/);
    });
});
