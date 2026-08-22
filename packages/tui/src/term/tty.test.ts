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
});
