import { describe, test, expect } from "bun:test";
import { Tty, enterSequence, leaveSequence } from "./tty";
import type { Sink } from "../render/screen";

function collectingSink(): Sink & { output: string } {
    return {
        output: "",
        write(data: string) {
            this.output += data;
        },
    };
}

// `process.stdin` is not a TTY under `bun test`, so `isTTY`/`setRawMode` are
// stubbed onto it and then put back exactly as they were — deleting the stub
// when the property did not exist before, rather than leaving `undefined` behind.
function restore(target: object, key: string, saved: PropertyDescriptor | undefined): void {
    if (saved === undefined) Reflect.deleteProperty(target, key);
    else Object.defineProperty(target, key, saved);
}

describe("enterSequence", () => {
    test("enters the alternate screen and hides the cursor", () => {
        const out = enterSequence({ kitty: false });
        expect(out).toContain("\x1b[?1049h");
        expect(out).toContain("\x1b[?25l");
    });

    test("pushes kitty keyboard flags only when the protocol is available", () => {
        expect(enterSequence({ kitty: true })).toContain("\x1b[>1u");
        expect(enterSequence({ kitty: false })).not.toContain("\x1b[>1u");
    });
});

describe("leaveSequence", () => {
    test("reverses everything enterSequence set", () => {
        const out = leaveSequence({ kitty: true });
        expect(out).toContain("\x1b[<u");
        expect(out).toContain("\x1b[?1049l");
        expect(out).toContain("\x1b[?25h");
        expect(out).toContain("\x1b[?1000l");
    });

    test("does not pop kitty flags that were never pushed", () => {
        expect(leaveSequence({ kitty: false })).not.toContain("\x1b[<u");
    });
});

describe("Tty", () => {
    test("leave is idempotent", () => {
        const sink = collectingSink();
        const tty = new Tty(sink, { kitty: true });
        tty.enter();
        sink.output = "";
        tty.leave();
        const first = sink.output;
        sink.output = "";
        tty.leave();
        expect(first).not.toBe("");
        expect(sink.output).toBe("");
    });

    test("leave without enter emits nothing", () => {
        const sink = collectingSink();
        new Tty(sink, { kitty: false }).leave();
        expect(sink.output).toBe("");
    });

    // The whole point of this module is that the shell never survives in raw mode.
    // A sink that throws on the way out is the one path where that could still
    // happen, so raw mode has to be cleared even when the write fails.
    test("clears raw mode even when the leave write throws", () => {
        const stdin: NodeJS.ReadStream = process.stdin;
        const savedIsTTY = Object.getOwnPropertyDescriptor(stdin, "isTTY");
        const savedSetRawMode = Object.getOwnPropertyDescriptor(stdin, "setRawMode");
        const modes: boolean[] = [];
        stdin.isTTY = true;
        stdin.setRawMode = (mode: boolean): NodeJS.ReadStream => {
            modes.push(mode);
            return stdin;
        };
        try {
            let failing = false;
            const tty = new Tty(
                {
                    write() {
                        if (failing) throw new Error("stdout closed");
                    },
                },
                { kitty: false },
            );
            tty.enter();
            failing = true;
            expect(() => {
                tty.leave();
            }).toThrow("stdout closed");
            expect(modes).toEqual([true, false]);
        } finally {
            restore(stdin, "setRawMode", savedSetRawMode);
            restore(stdin, "isTTY", savedIsTTY);
        }
    });
});
