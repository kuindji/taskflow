import { constants } from "os";

import { startBackend } from "./backend/manager";
import { WsClient } from "./net/client";
import { Store } from "./state/store";
import { Screen } from "./render/screen";
import { Tty } from "./term/tty";
import { negotiateKitty } from "./input/negotiate";
import { decodeKitty } from "./input/decode-kitty";
import { decodeLegacy, flushCarry, isPartialMouseReport } from "./input/decode-legacy";
import { App } from "./ui/app";

const FRAME_INTERVAL_MS = 16;
/** How long a held ESC waits for a continuation before counting as a real Escape. */
const ESCAPE_IDLE_MS = 25;
/**
 * How long the first half of a mouse report waits for the rest of itself
 * before it is discarded. Far longer than `ESCAPE_IDLE_MS` because the tail is
 * the rest of a write the terminal has already started, so it is coming unless
 * the link dropped it; short enough that a report that truly lost its tail
 * cannot outlive the click and claim characters typed afterwards.
 */
const MOUSE_REPORT_IDLE_MS = 1000;

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

function setRawMode(enabled: boolean): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(enabled);
}

/**
 * Route every terminating signal through `process.exit` so that the `exit`
 * handlers below are reached at all. A signal's default disposition kills the
 * process outright and runs none of them, which would strand whatever had been
 * registered — so this is installed before the first resource exists rather
 * than alongside the first one that needs it.
 *
 * Handlers registered later for the same signals never run, because this one
 * exits first. That is deliberate and costs nothing: `Tty` restores the
 * terminal from its own `exit` handler, which this path does reach.
 */
function installSignalExit(): void {
    for (const signal of SIGNALS) {
        process.on(signal, () => {
            // 128 + the signal number is what a shell or supervisor reads back as
            // "killed by this signal". Collapsing them onto one code would report
            // a hangup as a termination.
            process.exit(128 + constants.signals[signal]);
        });
    }
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
    process.on("exit", restore);
    return () => {
        process.off("exit", restore);
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

/**
 * Set once `Tty` owns the terminal, which is the moment it will restore it from
 * its own `exit` handler. Until then nothing writes the leave sequence, so the
 * top-level catch has to; afterwards the catch must go through the same `Tty`,
 * because a second `CSI < u` for one push pops the keyboard-stack entry
 * belonging to whatever the TUI was launched from.
 */
let terminalOwner: Tty | null = null;

async function main(): Promise<void> {
    installSignalExit();

    const devBranch = process.env.TASKFLOW_DEV_BRANCH ?? null;
    const binary = process.env.TASKFLOW_BACKEND_BIN ?? "taskflow-backend";
    // Registered from inside the spawn rather than from the resolved handle:
    // awaiting the port file is the longest window in startup, and a signal
    // during it must still take the backend down.
    const backend = await startBackend({ binary, args: [], devBranch, onSpawn: releaseOnExit });

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

    const negotiated = await negotiateKitty({ write: sink.write, waitForData: readOnce });
    const kittyAvailable = negotiated.kitty;
    // `readOnce` drops its listener but leaves the stream flowing, so anything
    // typed between here and the decode loop below would be emitted with nothing
    // listening and lost. A paused stream buffers it instead, and the loop
    // resumes the stream once it is able to receive it.
    process.stdin.pause();

    const tty = new Tty(sink, { kitty: kittyAvailable });
    tty.installExitHandlers();
    terminalOwner = tty;
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
    /**
     * When the half-written mouse report in `carry` stops being worth waiting
     * for, or `null` when the carry is not one. It is a deadline rather than a
     * timer duration because a stranded report goes on absorbing whatever is
     * typed after it — parameter bytes join the carry and decode to nothing —
     * so restarting the wait on each read would let those very keystrokes hold
     * the report open for as long as the user keeps typing, and every one of
     * them would be swallowed. Only a read that actually decoded something has
     * made progress, and only that earns a fresh deadline.
     */
    let mouseCarryDeadline: number | null = null;

    /**
     * Discard the first half of a mouse report whose tail never arrived.
     * Nothing is emitted: no part of a report is a key and the rest of it is
     * lost, so there is no event to make of it. Held any longer it would stay
     * live indefinitely and take the next characters typed as its own tail,
     * fabricating a click at whatever cell they happen to encode.
     */
    const dropStrandedMouseReport = (): void => {
        carryTimer = null;
        if (isPartialMouseReport(carry)) carry = "";
        mouseCarryDeadline = null;
    };

    /** Release a held ESC as a real Escape press, rather than waiting it out. */
    const flushHeldEscape = (): void => {
        if (carryTimer !== null) {
            clearTimeout(carryTimer);
            carryTimer = null;
        }
        if (carry === "") return;
        // Half a mouse report owes the other half. Waiting cannot turn it into
        // a key, so releasing it would strip the front of the report and let
        // the tail land on the keymap as typed characters. Give it a window of
        // its own instead, and drop it once that has run out too.
        if (isPartialMouseReport(carry)) {
            const remaining = (mouseCarryDeadline ?? 0) - Date.now();
            if (remaining > 0) {
                carryTimer = setTimeout(dropStrandedMouseReport, remaining);
                return;
            }
            carry = "";
            mouseCarryDeadline = null;
            return;
        }
        const stranded = carry;
        carry = "";
        for (const ev of flushCarry(stranded)) app.handleKey(ev);
    };

    const feed = (text: string): void => {
        if (carryTimer !== null) {
            clearTimeout(carryTimer);
            carryTimer = null;
        }
        // The timer cleared just above is the only thing that ever retires a
        // stranded report, and every read cancels it before it can fire. So a
        // read that arrives past the deadline has to retire the report itself:
        // otherwise keys typed closer together than `ESCAPE_IDLE_MS` keep
        // cancelling the timer, the deadline is never consulted, and the dead
        // report goes on eating them for as long as the typing lasts.
        if (mouseCarryDeadline !== null && Date.now() >= mouseCarryDeadline) {
            dropStrandedMouseReport();
        }
        // How long the carry was before this read. Both decoders return a
        // suffix of `carry + text`, so a carry exactly this much longer is the
        // same run with the new bytes appended and nothing consumed; any other
        // length means the decoder moved past the start of what was held, and
        // whatever it is holding now is a different run.
        const heldLength = carry.length;
        const decode = kittyAvailable ? decodeKitty : decodeLegacy;
        const result = decode(text, carry);
        carry = result.carry;
        for (const ev of result.events) {
            // 19.2 is what turns tracking on, so no report can reach here yet;
            // between 19.2 and 19.4 a click is silently ignored rather than
            // leaking its payload bytes as keystrokes.
            if (ev.kind === "mouse") continue; // wired up in 19.4
            app.handleKey(ev);
        }

        if (!isPartialMouseReport(carry)) {
            mouseCarryDeadline = null;
        } else if (
            mouseCarryDeadline === null ||
            result.events.length > 0 ||
            carry.length !== heldLength + text.length
        ) {
            // Either this is a newly held report, or the read that carried it
            // also decoded something and so was a report arriving rather than a
            // dead one being padded, or the carry is no longer the run that was
            // being held at all. The last case is a second click landing while
            // the first is still stranded: the dead one is discarded and this
            // report takes its place, so it is as new as one held from an empty
            // carry and owed the same window. Testing that by prefix would miss
            // it for X10, where the dead header and the fresh one are both
            // `CSI M`; testing that the read consumed nothing catches every
            // shape, because padding a dead run never consumes anything.
            mouseCarryDeadline = Date.now() + MOUSE_REPORT_IDLE_MS;
        }

        // A held ESC is only a real Escape press if nothing follows it.
        if (carry !== "") carryTimer = setTimeout(flushHeldEscape, ESCAPE_IDLE_MS);
    };

    process.stdin.on("data", (chunk: Buffer) => {
        feed(chunk.toString("utf-8"));
    });
    // Whatever the user typed into the negotiation window was consumed by
    // `readOnce` and is not coming again, so it goes through the decoder here
    // or it is dropped. It precedes anything the stream is about to deliver.
    if (negotiated.rest !== "") {
        feed(negotiated.rest);
        // The negotiation window has already closed, so a trailing ESC cannot be
        // the head of a chord whose tail is only now being let through: the two
        // can be seconds apart, because the stream stayed paused across the whole
        // of `init()`. Left on the idle timer, `resume()` below would release the
        // next key inside it and the pair would decode as one Alt chord — an
        // Escape at startup followed by `Q` would come out as Alt+Q, which is
        // bound to nothing, and the quit would simply be lost.
        flushHeldEscape();
    }
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
    // Restore before the error is printed either way: on the alternate screen it
    // would be wiped by the leave that follows, and the user would be told
    // nothing about why the TUI would not start.
    if (terminalOwner !== null) {
        // Idempotent, so the `exit` handler's own call becomes a no-op and the
        // terminal is left exactly one leave sequence for the one it entered.
        terminalOwner.leave();
    } else {
        // Nothing has been entered, so there is nothing to leave. Writing the
        // leave sequence anyway would undo modes belonging to whatever the TUI
        // was launched from: `CSI ? 1049 l` restores that program's saved cursor
        // and the mouse-off run turns its tracking off — the same defect as the
        // stray kitty pop, in the other direction. Raw mode is the one thing
        // this process did change, and its guard only runs at exit, after the
        // error is printed, so it comes off here.
        setRawMode(false);
    }
    console.error(err);
    process.exit(1);
});
