import { constants } from "os";

import type { Sink } from "../render/screen";

interface TtyOptions {
    kitty: boolean;
    mouse: boolean;
}

const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const MOUSE_OFF = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l";
// Press-and-release, then motion while a button is held, then SGR encoding.
// The encoding mode goes last on purpose: it changes only how reports are
// written, so a terminal that does not understand it is left with the tracking
// modes before it enabled rather than swallowing the whole run.
const MOUSE_ON = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
const KITTY_PUSH = "\x1b[>1u";
const KITTY_POP = "\x1b[<u";
// Exiting the alternate screen restores the saved cursor, which on a compliant
// terminal carries the SGR state with it. Terminals that ignore 1049 do not, so
// the reset is emitted explicitly rather than trusted to the restore.
const SGR_RESET = "\x1b[0m";

function enterSequence(opts: TtyOptions): string {
    return `${ALT_SCREEN_ON}${CURSOR_HIDE}${opts.kitty ? KITTY_PUSH : ""}${opts.mouse ? MOUSE_ON : ""}`;
}

function leaveSequence(opts: TtyOptions): string {
    return `${opts.kitty ? KITTY_POP : ""}${SGR_RESET}${MOUSE_OFF}${CURSOR_SHOW}${ALT_SCREEN_OFF}`;
}

class Tty {
    private entered = false;
    private handlersInstalled = false;

    constructor(
        private readonly sink: Sink,
        private readonly opts: TtyOptions,
    ) {}

    enter(): void {
        if (this.entered) return;
        this.entered = true;
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        try {
            this.sink.write(enterSequence(this.opts));
        } catch (err) {
            // Raw mode must not outlive a failed entry write, and the exit handlers
            // may not be installed yet. `entered` deliberately stays set: part of the
            // entry sequence may have landed, so the leave sequence is still owed.
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
            throw err;
        }
    }

    leave(): void {
        if (!this.entered) return;
        this.entered = false;
        // Raw mode has to come off even when the write fails. A shell left in raw
        // mode is unusable; a leave sequence that never reached it is cosmetic.
        try {
            this.sink.write(leaveSequence(this.opts));
        } finally {
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
        }
    }

    installExitHandlers(): void {
        if (this.handlersInstalled) return;
        this.handlersInstalled = true;
        const restore = (): void => {
            this.leave();
        };
        process.on("exit", restore);
        for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
            process.on(signal, () => {
                restore();
                // 128 + the signal number, which is how a shell reports a
                // signalled exit; one code for every signal would misname it.
                process.exit(128 + constants.signals[signal]);
            });
        }
        process.on("uncaughtException", (err: unknown) => {
            restore();
            console.error(err);
            process.exit(1);
        });
    }
}

export { Tty, enterSequence, leaveSequence };
export type { TtyOptions };
