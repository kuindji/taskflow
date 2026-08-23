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

    test("does not let a TASKFLOW_DEV_BRANCH in its own env reach a devBranch-null child", async () => {
        // `devBranch` is what decides the child's instance. Inheriting the variable
        // would silently put the backend on a dev instance the caller said not to use.
        const previous = process.env.TASKFLOW_DEV_BRANCH;
        process.env.TASKFLOW_DEV_BRANCH = "stale";
        try {
            const binary = await writeFakeBackend(
                'if [ -z "$TASKFLOW_DEV_BRANCH" ]; then echo 4332 > "$TASKFLOW_PORT_FILE"; else echo 9999 > "$TASKFLOW_PORT_FILE"; fi; exec sleep 30',
            );
            const handle = await start({ binary, args: [], devBranch: null });
            expect(handle.port).toBe(4332);
        } finally {
            if (previous === undefined) {
                delete process.env.TASKFLOW_DEV_BRANCH;
            } else {
                process.env.TASKFLOW_DEV_BRANCH = previous;
            }
        }
    });

    test("does not let a TASKFLOW_DEV in its own env make a devBranch-null child dev", async () => {
        // TASKFLOW_DEV alone is enough: the backend derives a dev branch from git HEAD
        // when it sees it. The TUI's own `bun run dev` script sets it, so a TUI started
        // that way would silently talk to a dev instance while asking for none.
        const previous = process.env.TASKFLOW_DEV;
        process.env.TASKFLOW_DEV = "1";
        try {
            const binary = await writeFakeBackend(
                'if [ -z "$TASKFLOW_DEV" ] && [ -z "$TASKFLOW_DEV_BRANCH" ]; then echo 4333 > "$TASKFLOW_PORT_FILE"; else echo 9999 > "$TASKFLOW_PORT_FILE"; fi; exec sleep 30',
            );
            const handle = await start({ binary, args: [], devBranch: null });
            expect(handle.port).toBe(4333);
        } finally {
            if (previous === undefined) {
                delete process.env.TASKFLOW_DEV;
            } else {
                process.env.TASKFLOW_DEV = previous;
            }
        }
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
            handles.push(
                await startBackend({ binary, args: [], devBranch: null, timeoutMs: 2000 }),
            );
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
            handles.push(
                await startBackend({ binary, args: [], devBranch: null, timeoutMs: 2000 }),
            );
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
        const slow = await writeFakeBackend(
            'sleep 1; echo 4329 > "$TASKFLOW_PORT_FILE"; exec sleep 30',
        );
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

    test("reports the backend's stderr when startup times out", async () => {
        // Without this the only thing the user sees is "startup timeout", even though
        // the backend already said exactly why it could not come up.
        const binary = await writeFakeBackend(
            'echo "bind: address already in use" >&2; exec sleep 30',
        );
        let message = "";
        try {
            handles.push(
                await startBackend({ binary, args: [], devBranch: null, timeoutMs: 1500 }),
            );
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }
        expect(message).toMatch(/timeout/);
        expect(message).toMatch(/bind: address already in use/);
    }, 10_000);

    test("kills a backend that ignores SIGTERM when startup times out", async () => {
        // A wedged backend left alive keeps the port, so the next start fails too.
        const dir = await mkdtemp(join(tmpdir(), "tui-backend-sigterm-"));
        const pidFile = join(dir, "pid");
        const binary = await writeFakeBackend(
            `trap '' TERM; printf '%s' "$$" > ${pidFile}; while :; do sleep 0.2; done`,
        );
        let message = "";
        try {
            handles.push(
                await startBackend({ binary, args: [], devBranch: null, timeoutMs: 1500 }),
            );
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }
        expect(message).toMatch(/timeout/);
        expect(existsSync(pidFile)).toBe(true);
        const pid = Number((await readFile(pidFile, "utf-8")).trim());
        // SIGKILL delivery and reaping are asynchronous, so give the pid a bounded
        // window to disappear. A child that only ever received SIGTERM never does.
        const stillAlive = (): boolean => {
            try {
                process.kill(pid, 0);
                return true;
            } catch {
                return false;
            }
        };
        const until = Date.now() + 2000;
        let alive = stillAlive();
        while (alive && Date.now() < until) {
            await Bun.sleep(50);
            alive = stillAlive();
        }
        try {
            expect(alive).toBe(false);
        } finally {
            if (alive) {
                try {
                    process.kill(pid, "SIGKILL");
                } catch {
                    // already gone
                }
            }
        }
    }, 15_000);

    test("does not let port-file cleanup mask the backend's own startup error", async () => {
        // The child leaves a directory where the port file should be. A non-recursive
        // rm throws EISDIR there, and an unguarded cleanup would report that instead of
        // the reason the backend actually failed.
        const binary = await writeFakeBackend(
            'mkdir "$TASKFLOW_PORT_FILE"; echo "bind: address already in use" >&2; exit 3',
        );
        let message = "";
        try {
            handles.push(
                await startBackend({ binary, args: [], devBranch: null, timeoutMs: 2000 }),
            );
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }
        expect(message).toMatch(/exited before startup \(code 3\)/);
        expect(message).toMatch(/bind: address already in use/);
    });

    test("reports a spawn failure that lands while the port file is being read", async () => {
        // The failure arrives during the poll's await. Reporting a timeout there tells
        // the user the backend hung when it never started at all.
        let message = "";
        try {
            handles.push(
                await startBackend({
                    binary: join(tmpdir(), "taskflow-tui-no-such-binary-race"),
                    args: [],
                    devBranch: null,
                    timeoutMs: 1,
                }),
            );
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }
        expect(message).toMatch(/failed to start/);
        expect(message).toMatch(/ENOENT/);
    });

    test("kills the backend when the onSpawn hook throws", async () => {
        // The hook runs after the child exists but before anything else holds a
        // handle on it. Letting its throw leave the function is the one exit that
        // skips both `terminate()` and the port-file cleanup, so the backend is
        // left running with nothing able to stop it.
        const dir = await mkdtemp(join(tmpdir(), "tui-backend-onspawn-"));
        const keepalive = join(dir, "keepalive");
        await writeFile(keepalive, "");
        const binary = join(dir, "fake-backend.sh");
        // Both the script path and the `tail -f` target live in this one temp
        // directory, so `pgrep -f dir` identifies the child continuously — before
        // the `exec` replaces the shell's command line and after.
        await writeFile(
            binary,
            `#!/bin/sh\necho 4331 > "$TASKFLOW_PORT_FILE"\nexec tail -f "${keepalive}"\n`,
        );
        await chmod(binary, 0o755);
        const stillRunning = async (): Promise<boolean> => {
            const proc = Bun.spawn(["pgrep", "-f", dir], { stdout: "pipe", stderr: "ignore" });
            const out = await new Response(proc.stdout).text();
            await proc.exited;
            return out.trim() !== "";
        };

        let message = "";
        try {
            handles.push(
                await startBackend({
                    binary,
                    args: [],
                    devBranch: null,
                    timeoutMs: 2000,
                    onSpawn: () => {
                        throw new Error("hook failed");
                    },
                }),
            );
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }
        // The hook's own error is the real reason startup did not happen, so it
        // is what the caller has to see.
        expect(message).toBe("hook failed");

        let gone = false;
        for (let i = 0; i < 120 && !gone; i++) {
            gone = !(await stillRunning());
            if (!gone) await Bun.sleep(25);
        }
        // Left behind on a red run, where nothing else can reach the child.
        if (!gone) Bun.spawnSync(["pkill", "-f", dir]);
        expect(gone).toBe(true);
    }, 15_000);

    test("names the signal when the backend is killed before startup", async () => {
        const binary = await writeFakeBackend("kill -TERM $$");
        let message = "";
        try {
            handles.push(
                await startBackend({ binary, args: [], devBranch: null, timeoutMs: 2000 }),
            );
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }
        expect(message).toMatch(/exited before startup \(signal SIGTERM\)/);
    });
});
