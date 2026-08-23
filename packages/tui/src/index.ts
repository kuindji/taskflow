import { startBackend } from "./backend/manager";
import { WsClient } from "./net/client";
import { Store } from "./state/store";
import { Screen } from "./render/screen";
import { Tty, leaveSequence } from "./term/tty";
import { negotiateKitty } from "./input/negotiate";
import { decodeKitty } from "./input/decode-kitty";
import { decodeLegacy, flushCarry } from "./input/decode-legacy";
import { App } from "./ui/app";

const FRAME_INTERVAL_MS = 16;
/** How long a held ESC waits for a continuation before counting as a real Escape. */
const ESCAPE_IDLE_MS = 25;

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

function setRawMode(enabled: boolean): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(enabled);
}

/**
 * Undo raw mode if the process ends between entering it and `Tty` taking over.
 * `Tty.installExitHandlers` cannot cover this window: every handler it installs
 * calls `leave()`, which returns immediately until `enter()` has run, so nothing
 * would take raw mode back off and the user would be left with a dead shell.
 * Returns a disposer to call once the real `Tty` owns the terminal.
 */
function armRawModeGuard(): () => void {
    const restore = (): void => {
        setRawMode(false);
    };
    const onSignal = (signal: NodeJS.Signals): void => {
        restore();
        process.exit(signal === "SIGINT" ? 130 : 143);
    };
    process.on("exit", restore);
    for (const signal of SIGNALS) process.on(signal, onSignal);
    return () => {
        process.off("exit", restore);
        for (const signal of SIGNALS) process.off(signal, onSignal);
    };
}

/**
 * Release a resource when the process ends, whatever ends it. `Tty` restores the
 * terminal from its own signal and `uncaughtException` handlers, but each of
 * those calls `process.exit` immediately afterwards, so anything else that is
 * owed has to hang off `exit` to be reached at all. Registered per resource as
 * it is created, because `main` can throw in between them.
 */
function releaseOnExit(release: () => void): void {
    process.on("exit", () => {
        try {
            release();
        } catch {
            // Exit is the last chance for every other resource too, so one that
            // fails to close must not strand the rest.
        }
    });
}

function readOnce(timeoutMs: number): Promise<string> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            process.stdin.off("data", onData);
            resolve("");
        }, timeoutMs);
        const onData = (chunk: Buffer): void => {
            clearTimeout(timer);
            process.stdin.off("data", onData);
            resolve(chunk.toString("utf-8"));
        };
        process.stdin.on("data", onData);
    });
}

async function main(): Promise<void> {
    const devBranch = process.env.TASKFLOW_DEV_BRANCH ?? null;
    const binary = process.env.TASKFLOW_BACKEND_BIN ?? "taskflow-backend";
    const backend = await startBackend({ binary, args: [], devBranch });
    releaseOnExit(backend.stop);

    const net = new WsClient(backend.port);
    // Registered before the connect so a socket that fails midway through
    // opening is still torn down rather than left to the event loop.
    releaseOnExit(() => {
        net.close();
    });
    await net.connect();

    const sink = { write: (data: string) => void process.stdout.write(data) };

    // The kitty query is answered on stdin, so raw mode has to be on before it
    // goes out — otherwise the reply is line-buffered and echoed into the shell.
    // Nothing has been drawn yet, so raw mode is the only thing owed back if this
    // window is cut short, and the guard is armed before the query can fail.
    setRawMode(true);
    process.stdin.resume();
    const disarmRawGuard = armRawModeGuard();

    const kittyAvailable = await negotiateKitty({ write: sink.write, waitForData: readOnce });
    // `readOnce` drops its listener but leaves the stream flowing, so anything
    // typed between here and the decode loop below would be emitted with nothing
    // listening and lost. A paused stream buffers it instead, and the loop
    // resumes the stream once it is able to receive it.
    process.stdin.pause();

    const tty = new Tty(sink, { kitty: kittyAvailable });
    tty.installExitHandlers();
    tty.enter();
    // Only now is the terminal owned by something that restores it in full.
    disarmRawGuard();

    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const screen = new Screen(sink, cols, rows);
    const store = new Store(net);
    const app = new App({ net, store, screen, cols, rows, kittyAvailable });
    await app.init();

    let carry = "";
    let carryTimer: ReturnType<typeof setTimeout> | null = null;

    process.stdin.on("data", (chunk: Buffer) => {
        if (carryTimer !== null) {
            clearTimeout(carryTimer);
            carryTimer = null;
        }
        const decode = kittyAvailable ? decodeKitty : decodeLegacy;
        const result = decode(chunk.toString("utf-8"), carry);
        carry = result.carry;
        for (const ev of result.events) app.handleKey(ev);

        // A held ESC is only a real Escape press if nothing follows it.
        if (carry !== "") {
            carryTimer = setTimeout(() => {
                carryTimer = null;
                const stranded = carry;
                carry = "";
                for (const ev of flushCarry(stranded)) app.handleKey(ev);
            }, ESCAPE_IDLE_MS);
        }
    });
    process.stdin.resume();

    const timer = setInterval(() => {
        if (!app.running) {
            clearInterval(timer);
            tty.leave();
            // `net` and `backend` are released by their `exit` handlers, which
            // this reaches and every other way out of the process reaches too.
            process.exit(0);
        }
        app.render();
    }, FRAME_INTERVAL_MS);
}

void main().catch((err: unknown) => {
    // Restore unconditionally: main() may have thrown before its own handlers
    // were armed, and a half-configured terminal is unusable.
    process.stdout.write(leaveSequence({ kitty: true }));
    setRawMode(false);
    console.error(err);
    process.exit(1);
});
