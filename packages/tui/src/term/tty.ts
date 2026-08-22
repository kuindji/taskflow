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

function enterSequence(opts: TtyOptions): string {
    return `${ALT_SCREEN_ON}${CURSOR_HIDE}${opts.kitty ? KITTY_PUSH : ""}`;
}

function leaveSequence(opts: TtyOptions): string {
    return `${opts.kitty ? KITTY_POP : ""}${MOUSE_OFF}${CURSOR_SHOW}${ALT_SCREEN_OFF}`;
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
        this.sink.write(leaveSequence(this.opts));
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
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
