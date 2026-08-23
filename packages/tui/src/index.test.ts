import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, writeFile, chmod, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { Subprocess } from "bun";

/**
 * End-to-end over the real entry point. `index.ts` runs `main()` on import, so
 * the only way to exercise its process lifecycle — what it releases, and when —
 * is to run it as a process and look at what it leaves behind.
 */

const ENTRY = join(import.meta.dir, "index.ts");
/** Fixed to the stdio the tests spawn with, so `stdin` types as a writable sink. */
type TuiProcess = Subprocess<"pipe", "pipe", "pipe">;

const spawned: TuiProcess[] = [];

afterEach(() => {
    while (spawned.length > 0) spawned.pop()?.kill("SIGKILL");
});

async function fakeBackend(body: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "tui-index-test-"));
    const path = join(dir, "fake-backend.sh");
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    return path;
}

/** A backend that never accepts a WebSocket, so the TUI fails during startup. */
async function deafBackend(pidFile: string): Promise<string> {
    // Port 1 is privileged and unbound, so the connect attempt is refused rather
    // than left hanging.
    return fakeBackend(`echo $$ > "${pidFile}"\necho 1 > "$TASKFLOW_PORT_FILE"\nexec sleep 60`);
}

/**
 * A backend that speaks just enough of the protocol for the TUI to finish
 * starting: it answers every request with empty lists, after `delayMs`.
 */
async function talkingBackend(pidFile: string, delayMs: number): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "tui-index-server-"));
    const server = join(dir, "server.ts");
    await writeFile(
        server,
        `const srv = Bun.serve({
    port: 0,
    fetch: (req, s) => (s.upgrade(req) ? undefined : new Response("no")),
    websocket: {
        message(ws, raw) {
            const req = JSON.parse(String(raw));
            setTimeout(() => {
                ws.send(
                    JSON.stringify({
                        correlationId: req.correlationId,
                        type: req.type,
                        payload: { projects: [], tasks: [] },
                    }),
                );
            }, ${String(delayMs)});
        },
    },
});
await Bun.write(process.env.TASKFLOW_PORT_FILE ?? "", String(srv.port));
`,
    );
    return fakeBackend(`echo $$ > "${pidFile}"\nexec bun ${server}`);
}

function runTui(binary: string): TuiProcess {
    const child = Bun.spawn(["bun", ENTRY], {
        env: { ...process.env, TASKFLOW_BACKEND_BIN: binary },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
    });
    spawned.push(child);
    return child;
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitForPid(pidFile: string): Promise<number> {
    for (let i = 0; i < 200; i++) {
        try {
            const pid = Number.parseInt((await readFile(pidFile, "utf-8")).trim(), 10);
            if (Number.isInteger(pid) && pid > 0) return pid;
        } catch {
            // The backend has not written its pid yet.
        }
        await Bun.sleep(25);
    }
    throw new Error("fake backend never wrote its pid");
}

async function waitUntilDead(pid: number): Promise<boolean> {
    for (let i = 0; i < 80; i++) {
        if (!alive(pid)) return true;
        await Bun.sleep(25);
    }
    return false;
}

describe("tui entry point", () => {
    test("stops the backend when startup fails after it was spawned", async () => {
        const pidFile = join(await mkdtemp(join(tmpdir(), "tui-index-pid-")), "pid");
        const child = runTui(await deafBackend(pidFile));
        const backendPid = await waitForPid(pidFile);

        expect(await child.exited).toBe(1);
        // Without the release the backend outlives the TUI that spawned it, and
        // nothing is left holding a handle on it.
        expect(await waitUntilDead(backendPid)).toBe(true);
    }, 20_000);

    test("stops the backend when the TUI is terminated by a signal", async () => {
        const pidFile = join(await mkdtemp(join(tmpdir(), "tui-index-pid-")), "pid");
        const child = runTui(await talkingBackend(pidFile, 0));
        const backendPid = await waitForPid(pidFile);
        // Let it get past connect, init and into the render loop.
        await Bun.sleep(1500);
        expect(alive(backendPid)).toBe(true);

        child.kill("SIGTERM");
        await child.exited;
        expect(await waitUntilDead(backendPid)).toBe(true);
    }, 20_000);

    test("does not lose a key typed while the first snapshot is still loading", async () => {
        const pidFile = join(await mkdtemp(join(tmpdir(), "tui-index-pid-")), "pid");
        // The snapshot is held back so `Q` lands squarely inside `app.init()`.
        const child = runTui(await talkingBackend(pidFile, 1200));
        await waitForPid(pidFile);

        // After the 150ms kitty negotiation window, whose reply-shaped read would
        // otherwise swallow it, and before the snapshot arrives.
        await Bun.sleep(600);
        await child.stdin.write("Q");
        await child.stdin.flush();

        // `Q` is quit. A dropped keystroke leaves the TUI running until the kill
        // in `afterEach`, which reports as a signal rather than a clean exit.
        expect(await child.exited).toBe(0);
    }, 20_000);
});
