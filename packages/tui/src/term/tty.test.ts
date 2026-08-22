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

// Runs `body` with a stubbed TTY stdin and hands it the recorded setRawMode calls.
function withStubbedTtyStdin(body: (modes: boolean[]) => void): void {
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
        body(modes);
    } finally {
        restore(stdin, "setRawMode", savedSetRawMode);
        restore(stdin, "isTTY", savedIsTTY);
    }
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
        withStubbedTtyStdin((modes) => {
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
        });
    });

    // The same guarantee on the way in. `enter()` may run before
    // `installExitHandlers()`, so a failing entry write has no handler to fall back
    // on — raw mode has to come off inline or it outlives the process.
    test("clears raw mode even when the enter write throws", () => {
        withStubbedTtyStdin((modes) => {
            const tty = new Tty(
                {
                    write() {
                        throw new Error("stdout closed");
                    },
                },
                { kitty: false },
            );
            expect(() => {
                tty.enter();
            }).toThrow("stdout closed");
            expect(modes).toEqual([true, false]);
        });
    });

    // ...and the leave sequence is still owed afterwards: part of the entry
    // sequence may have reached the terminal before the write failed.
    test("still emits the leave sequence after a failed enter write", () => {
        withStubbedTtyStdin(() => {
            let failing = true;
            const sink: Sink & { output: string } = {
                output: "",
                write(data: string) {
                    if (failing) throw new Error("stdout closed");
                    this.output += data;
                },
            };
            const tty = new Tty(sink, { kitty: false });
            expect(() => {
                tty.enter();
            }).toThrow("stdout closed");
            failing = false;
            tty.leave();
            expect(sink.output).toContain("\x1b[?1049l");
        });
    });
});
