import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import { ScreenBuffer, ATTR_BOLD } from "../render/cells";
import { SessionTerminal } from "./session-terminal";
import { blitTerminal } from "./blit";
import type { NetLike } from "../net/client";

function stubNet(): NetLike {
    return {
        request<T>(type: string): Promise<T> {
            if (type === MSG.SESSION_SNAPSHOT) {
                return Promise.resolve({
                    snapshot: null,
                    lastSequence: 0,
                    cursorHidden: false,
                } as unknown as T);
            }
            return Promise.resolve({} as T);
        },
        on: () => () => undefined,
        onStatusChange: () => () => undefined,
    };
}

async function terminalWith(data: string, cols = 20, rows = 5): Promise<SessionTerminal> {
    const term = new SessionTerminal({
        net: stubNet(),
        sessionId: "s1",
        owner: {},
        cols,
        rows,
    });
    await new Promise<void>((resolve) => term.terminal.write(data, resolve));
    return term;
}

describe("blitTerminal", () => {
    test("copies characters at the given offset", async () => {
        const term = await terminalWith("hi");
        const buf = new ScreenBuffer(20, 5);
        blitTerminal(term, buf, 3, 1, 20, 5);
        expect(buf.get(3, 1).ch).toBe("h");
        expect(buf.get(4, 1).ch).toBe("i");
        term.dispose();
    });

    test("preserves a palette color as a palette index, never rgb", async () => {
        const term = await terminalWith("\x1b[31mR");
        const buf = new ScreenBuffer(20, 5);
        blitTerminal(term, buf, 0, 0, 20, 5);
        expect(buf.get(0, 0).fg).toEqual({ kind: "palette", index: 1 });
        term.dispose();
    });

    test("carries a truecolor foreground through as rgb", async () => {
        const term = await terminalWith("\x1b[38;2;10;20;30mX");
        const buf = new ScreenBuffer(20, 5);
        blitTerminal(term, buf, 0, 0, 20, 5);
        expect(buf.get(0, 0).fg).toEqual({ kind: "rgb", r: 10, g: 20, b: 30 });
        term.dispose();
    });

    test("leaves an unstyled cell on the default color", async () => {
        const term = await terminalWith("p");
        const buf = new ScreenBuffer(20, 5);
        blitTerminal(term, buf, 0, 0, 20, 5);
        expect(buf.get(0, 0).fg).toEqual({ kind: "default" });
        term.dispose();
    });

    test("carries bold through as an attribute", async () => {
        const term = await terminalWith("\x1b[1mB");
        const buf = new ScreenBuffer(20, 5);
        blitTerminal(term, buf, 0, 0, 20, 5);
        expect(buf.get(0, 0).attrs & ATTR_BOLD).toBe(ATTR_BOLD);
        term.dispose();
    });

    test("marks the continuation cell of a wide glyph with width zero", async () => {
        const term = await terminalWith("你");
        const buf = new ScreenBuffer(20, 5);
        blitTerminal(term, buf, 0, 0, 20, 5);
        expect(buf.get(0, 0).width).toBe(2);
        expect(buf.get(1, 0).width).toBe(0);
        term.dispose();
    });

    test("returns the cursor in screen coordinates", async () => {
        const term = await terminalWith("abc");
        const buf = new ScreenBuffer(20, 5);
        const cursor = blitTerminal(term, buf, 2, 1, 20, 5);
        expect(cursor).toEqual({ x: 5, y: 1 });
        term.dispose();
    });

    test("returns null when the cursor sits past the last column", async () => {
        // IBuffer.cursorX may equal cols ("after last cell of the row"), which
        // is outside the rect and would bleed into the neighbouring pane.
        const term = await terminalWith("abcde", 5, 2);
        const buf = new ScreenBuffer(10, 4);
        expect(blitTerminal(term, buf, 0, 0, 5, 2)).toBeNull();
        term.dispose();
    });

    test("hides the cursor when scrollback has pushed it below the viewport", async () => {
        // xterm reports cursorY relative to baseY, while the copied rows start
        // at viewportY. Scrolled back, the cursor's absolute row can sit below
        // the viewport entirely and must not be drawn inside the pane.
        const term = await terminalWith("a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh", 10, 5);
        term.terminal.scrollLines(-1);
        const buf = new ScreenBuffer(10, 5);
        expect(blitTerminal(term, buf, 0, 0, 10, 5)).toBeNull();
        term.dispose();
    });

    test("keeps the cursor on its own row when a scrolled viewport still shows it", async () => {
        const term = await terminalWith("a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh\x1b[2A", 10, 5);
        term.terminal.scrollLines(-1);
        const buf = new ScreenBuffer(10, 5);
        const cursor = blitTerminal(term, buf, 0, 0, 10, 5);
        // Viewport shows c,d,e,f,g; the cursor is parked on f, row 3.
        expect(buf.get(0, 3).ch).toBe("f");
        expect(cursor).toEqual({ x: 1, y: 3 });
        term.dispose();
    });

    test("clips a wide glyph that starts at the rect's last column", async () => {
        // Screen.flush emits any cell whose width is not 0, and the real
        // terminal advances two columns for a wide glyph. With the
        // continuation cell outside the rect, that second column belongs to
        // whatever is drawn to the right of this pane.
        const term = await terminalWith("abcd\u4f60Z", 10, 2);
        const buf = new ScreenBuffer(6, 1);
        blitTerminal(term, buf, 0, 0, 5, 1);
        expect(buf.get(4, 0)).toMatchObject({ ch: " ", width: 1 });
        term.dispose();
    });

    test("hides a cursor parked past the source terminal's last column", async () => {
        // The rect is wider than the terminal, so `cursorX === terminal.cols`
        // is still the "after last cell" sentinel even though it is inside the
        // rect.
        const term = await terminalWith("abcde", 5, 2);
        const buf = new ScreenBuffer(10, 2);
        expect(blitTerminal(term, buf, 0, 0, 10, 2)).toBeNull();
        term.dispose();
    });

    test("blanks the rect below the source terminal's own viewport", async () => {
        // A rect taller than the terminal must not keep reading lines past the
        // viewport: those are scrollback the child is not currently showing.
        const term = await terminalWith("a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh", 10, 5);
        term.terminal.scrollToTop();
        const buf = new ScreenBuffer(10, 8);
        const cursor = blitTerminal(term, buf, 0, 0, 10, 8);
        expect(Array.from({ length: 8 }, (_, y) => buf.get(0, y).ch).join("")).toBe("abcde   ");
        expect(cursor).toBeNull();
        term.dispose();
    });

    test("returns null for a hidden cursor", async () => {
        const term = await terminalWith("\x1b[?25labc");
        const buf = new ScreenBuffer(20, 5);
        expect(blitTerminal(term, buf, 0, 0, 20, 5)).toBeNull();
        term.dispose();
    });
});
