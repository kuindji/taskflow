import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, writeFile, chmod, readFile, rm } from "fs/promises";
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
/**
 * Everything the harness itself created. A failing assertion skips the rest of
 * its test, and SIGKILLing the TUI runs none of its cleanup, so a test that
 * goes red would otherwise leave both a fake backend and a temp tree behind.
 */
const backendPids: number[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
    while (spawned.length > 0) spawned.pop()?.kill("SIGKILL");
    while (backendPids.length > 0) {
        const pid = backendPids.pop();
        if (pid === undefined) continue;
        try {
            process.kill(pid, "SIGKILL");
        } catch {
            // Already gone, which is the outcome most of these tests assert.
        }
    }
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir === undefined) continue;
        await rm(dir, { recursive: true, force: true });
    }
});

async function tempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

async function fakeBackend(body: string): Promise<string> {
    const dir = await tempDir("tui-index-test-");
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
 * A backend that publishes its pid at once but takes its time over the port
 * file, so the TUI is still inside `startBackend` when the test acts on it.
 */
async function slowBackend(pidFile: string, delaySeconds: number): Promise<string> {
    return fakeBackend(
        `echo $$ > "${pidFile}"\nsleep ${String(delaySeconds)}\n` +
            `echo 1 > "$TASKFLOW_PORT_FILE"\nexec sleep 60`,
    );
}

/**
 * A backend that speaks just enough of the protocol for the TUI to finish
 * starting: it answers every request with empty lists, after `delayMs`. It
 * touches `readyFile` as the first request arrives — which the TUI only sends
 * once it is inside `app.init()`, past connect and past kitty negotiation — so
 * a test can aim at that window without guessing at a sleep.
 */
async function talkingBackend(
    pidFile: string,
    delayMs: number,
    readyFile: string,
): Promise<string> {
    const dir = await tempDir("tui-index-server-");
    const server = join(dir, "server.ts");
    await writeFile(
        server,
        `const srv = Bun.serve({
    port: 0,
    fetch: (req, s) => (s.upgrade(req) ? undefined : new Response("no")),
    websocket: {
        message(ws, raw) {
            void Bun.write(${JSON.stringify(readyFile)}, "1");
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

/**
 * A backend that ignores SIGTERM, so only an escalation can ever stop it.
 * `SIG_IGN` survives `exec`, so the `sleep` inherits the ignored disposition.
 */
async function stubbornBackend(pidFile: string): Promise<string> {
    return fakeBackend(
        `trap '' TERM\necho $$ > "${pidFile}"\necho 1 > "$TASKFLOW_PORT_FILE"\nexec sleep 60`,
    );
}

/**
 * A backend that connects but fails the first snapshot, so `app.init()` rejects
 * after the terminal has already been entered.
 */
async function erroringBackend(pidFile: string): Promise<string> {
    const dir = await tempDir("tui-index-server-");
    const server = join(dir, "server.ts");
    await writeFile(
        server,
        `const srv = Bun.serve({
    port: 0,
    fetch: (req, s) => (s.upgrade(req) ? undefined : new Response("no")),
    websocket: {
        message(ws, raw) {
            const req = JSON.parse(String(raw));
            ws.send(
                JSON.stringify({
                    correlationId: req.correlationId,
                    type: req.type,
                    error: "snapshot failed",
                }),
            );
        },
    },
});
await Bun.write(process.env.TASKFLOW_PORT_FILE ?? "", String(srv.port));
`,
    );
    return fakeBackend(`echo $$ > "${pidFile}"\nexec bun ${server}`);
}

/** The parts of the leave sequence that undo a mode, rather than reset colour. */
const ALT_SCREEN_OFF = "\x1b[?1049l";
const MOUSE_OFF_FIRST = "\x1b[?1000l";
const CURSOR_SHOW = "\x1b[?25h";

function countOf(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
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

async function waitForFile(path: string, what: string): Promise<string> {
    for (let i = 0; i < 400; i++) {
        try {
            const raw = (await readFile(path, "utf-8")).trim();
            if (raw !== "") return raw;
        } catch {
            // Not written yet.
        }
        await Bun.sleep(25);
    }
    throw new Error(`fake backend never wrote its ${what}`);
}

async function waitForPid(pidFile: string): Promise<number> {
    const pid = Number.parseInt(await waitForFile(pidFile, "pid"), 10);
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("fake backend wrote a bad pid");
    backendPids.push(pid);
    return pid;
}

async function waitUntilDead(pid: number): Promise<boolean> {
    for (let i = 0; i < 120; i++) {
        if (!alive(pid)) return true;
        await Bun.sleep(25);
    }
    return false;
}

describe("tui entry point", () => {
    test("stops the backend when startup fails after it was spawned", async () => {
        const pidFile = join(await tempDir("tui-index-pid-"), "pid");
        const child = runTui(await deafBackend(pidFile));
        const backendPid = await waitForPid(pidFile);

        expect(await child.exited).toBe(1);
        // Without the release the backend outlives the TUI that spawned it, and
        // nothing is left holding a handle on it.
        expect(await waitUntilDead(backendPid)).toBe(true);
    }, 20_000);

    test("stops the backend when a signal lands while the port is still awaited", async () => {
        const pidFile = join(await tempDir("tui-index-pid-"), "pid");
        const child = runTui(await slowBackend(pidFile, 5));
        const backendPid = await waitForPid(pidFile);

        // The TUI is parked in `startBackend`'s poll loop: the child exists but
        // has not published a port, so the handle that owns `stop` does not
        // exist yet either.
        child.kill("SIGTERM");
        await child.exited;
        expect(await waitUntilDead(backendPid)).toBe(true);
    }, 20_000);

    test("reports a hangup with the conventional exit code", async () => {
        const pidFile = join(await tempDir("tui-index-pid-"), "pid");
        const child = runTui(await slowBackend(pidFile, 5));
        await waitForPid(pidFile);

        // 128 + the signal number, which every shell and supervisor reads as
        // "killed by SIGHUP". Reporting SIGTERM's 143 instead misattributes it.
        child.kill("SIGHUP");
        expect(await child.exited).toBe(129);
    }, 20_000);

    test("stops the backend when the TUI is terminated by a signal", async () => {
        const dir = await tempDir("tui-index-pid-");
        const pidFile = join(dir, "pid");
        const readyFile = join(dir, "ready");
        const child = runTui(await talkingBackend(pidFile, 0, readyFile));
        const backendPid = await waitForPid(pidFile);
        // The first request means connect and negotiation are done and the TUI
        // is inside `init()`; the snapshot is served at once, so the render loop
        // follows immediately.
        await waitForFile(readyFile, "ready marker");
        await Bun.sleep(200);
        expect(alive(backendPid)).toBe(true);

        child.kill("SIGTERM");
        await child.exited;
        expect(await waitUntilDead(backendPid)).toBe(true);
    }, 20_000);

    test("does not lose a key typed before the kitty query goes out", async () => {
        const dir = await tempDir("tui-index-pid-");
        const pidFile = join(dir, "pid");
        const readyFile = join(dir, "ready");
        const child = runTui(await talkingBackend(pidFile, 0, readyFile));

        // Written before the TUI has read a byte, so it is already sitting in the
        // pipe when the negotiation window opens — the one moment something reads
        // stdin before the decoder exists.
        await child.stdin.write("Q");
        await child.stdin.flush();

        // `Q` is quit. Swallowed by the negotiation read, it leaves the TUI
        // running until the harness kills it.
        expect(await child.exited).toBe(0);
    }, 20_000);

    test("does not merge an escape from the negotiation window with a later key", async () => {
        const dir = await tempDir("tui-index-pid-");
        const pidFile = join(dir, "pid");
        const readyFile = join(dir, "ready");
        // The snapshot is held back so the two keys land seconds apart.
        const child = runTui(await talkingBackend(pidFile, 2000, readyFile));

        // An Escape pressed into the negotiation window. It comes back as the
        // leftover, and a lone ESC is held as a carry rather than decoded.
        await child.stdin.write("\x1b");
        await child.stdin.flush();
        await waitForPid(pidFile);

        // Pressed much later, while the first snapshot is still loading, so the
        // paused stream is holding it. Released next to the carried ESC it
        // decodes as Alt+Q, which is bound to nothing, and the TUI never quits.
        await waitForFile(readyFile, "ready marker");
        await child.stdin.write("Q");
        await child.stdin.flush();

        expect(await child.exited).toBe(0);
    }, 20_000);

    test("pops the kitty keyboard stack once for the push when startup fails", async () => {
        const pidFile = join(await tempDir("tui-index-pid-"), "pid");
        const child = runTui(await erroringBackend(pidFile));

        // The protocol reply, already in the pipe when the query goes out, so
        // negotiation succeeds and the TUI pushes the keyboard stack exactly once.
        await child.stdin.write("\x1b[?1u");
        await child.stdin.flush();

        expect(await child.exited).toBe(1);
        const out = await new Response(child.stdout).text();
        expect(countOf(out, "\x1b[>1u")).toBe(1);
        // `CSI < u` pops a stack entry. A second pop for one push takes the
        // entry belonging to whatever the TUI was launched from with it.
        expect(countOf(out, "\x1b[<u")).toBe(1);
    }, 20_000);

    test("writes no leave sequence when startup fails before the terminal is entered", async () => {
        const pidFile = join(await tempDir("tui-index-pid-"), "pid");
        const child = runTui(await deafBackend(pidFile));
        await waitForPid(pidFile);

        expect(await child.exited).toBe(1);
        const out = await new Response(child.stdout).text();
        // Nothing was entered on this path, so every byte of the leave sequence
        // would be undoing a mode belonging to whatever the TUI was launched
        // from: `\x1b[?1049l` restores that program's saved cursor, and the
        // mouse-off run turns its tracking off.
        expect(countOf(out, ALT_SCREEN_OFF)).toBe(0);
        expect(countOf(out, MOUSE_OFF_FIRST)).toBe(0);
        expect(countOf(out, CURSOR_SHOW)).toBe(0);
    }, 20_000);

    test("arms the escalating reaper from its exit handler", async () => {
        const pidFile = join(await tempDir("tui-index-pid-"), "pid");
        const child = runTui(await stubbornBackend(pidFile));
        const backendPid = await waitForPid(pidFile);

        expect(await child.exited).toBe(1);
        // The only backend cleanup an `exit` handler can reach is `stop()`, and
        // `stop()` has no time left to watch whether its SIGTERM was honoured. A
        // backend that ignores it survives unless something outliving this exit
        // escalates — so the reaper has to have been spawned from inside the exit
        // handler itself, which is the part only an end-to-end run can show.
        // (That the reaper then kills is `manager.test.ts`'s "kills a backend that
        // ignores SIGTERM when the caller stops it", which runs it on a 1s grace.)
        expect(alive(backendPid)).toBe(true);
        const probe = Bun.spawn(["pgrep", "-f", `kill -0 ${String(backendPid)}`], {
            stdout: "pipe",
            stderr: "ignore",
        });
        const reapers = (await new Response(probe.stdout).text()).trim();
        await probe.exited;
        expect(reapers).not.toBe("");
    }, 20_000);

    test("does not lose a key typed while the first snapshot is still loading", async () => {
        const dir = await tempDir("tui-index-pid-");
        const pidFile = join(dir, "pid");
        const readyFile = join(dir, "ready");
        // The snapshot is held back so `Q` lands squarely inside `app.init()`.
        const child = runTui(await talkingBackend(pidFile, 2000, readyFile));
        await waitForPid(pidFile);

        // The marker is written when the first request arrives, which is after
        // the kitty negotiation window whose reply-shaped read would otherwise
        // swallow the keystroke, and before the snapshot answers it.
        await waitForFile(readyFile, "ready marker");
        await child.stdin.write("Q");
        await child.stdin.flush();

        // `Q` is quit. A dropped keystroke leaves the TUI running until the kill
        // in `afterEach`, which reports as a signal rather than a clean exit.
        expect(await child.exited).toBe(0);
    }, 20_000);

    test("does not quit on the payload of a click split by the escape timeout", async () => {
        const dir = await tempDir("tui-index-pid-");
        const pidFile = join(dir, "pid");
        const readyFile = join(dir, "ready");
        const child = runTui(await talkingBackend(pidFile, 0, readyFile));
        await waitForPid(pidFile);
        await waitForFile(readyFile, "ready marker");

        // An X10 mouse header, whose three payload characters are still in
        // flight. A read boundary here is rare but the sequence is six bytes,
        // so it is not impossible.
        await child.stdin.write("\x1b[M\x20");
        await child.stdin.flush();
        // Long enough for the escape idle timer to fire on the held header.
        await Bun.sleep(200);
        // Column 49 encodes as `Q`. Reaching the keymap it quits the TUI; it
        // belongs to the click and must be consumed as payload instead.
        await child.stdin.write("\x51\x21");
        await child.stdin.flush();

        await Bun.sleep(300);
        expect(child.exitCode).toBeNull();
    }, 20_000);
});
