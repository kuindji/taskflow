import type { Sink } from "../render/screen";

interface TtyOptions {
    kitty: boolean;
}

const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const MOUSE_OFF = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l";
const KITTY_PUSH = "\x1b[>1u";
const KITTY_POP = "\x1b[<u";
// Exiting the alternate screen restores the saved cursor, which on a compliant
// terminal carries the SGR state with it. Terminals that ignore 1049 do not, so
// the reset is emitted explicitly rather than trusted to the restore.
const SGR_RESET = "\x1b[0m";

function enterSequence(opts: TtyOptions): string {
    return `${ALT_SCREEN_ON}${CURSOR_HIDE}${opts.kitty ? KITTY_PUSH : ""}`;
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
        this.sink.write(enterSequence(this.opts));
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
                process.exit(signal === "SIGINT" ? 130 : 143);
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
