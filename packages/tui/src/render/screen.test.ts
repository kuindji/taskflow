import { describe, test, expect } from "bun:test";
import { Screen, type Sink } from "./screen";
import { blankCell, ATTR_BOLD, type Cell } from "./cells";

function collectingSink(): Sink & { output: string } {
    return {
        output: "",
        write(data: string) {
            this.output += data;
        },
    };
}

function textCell(ch: string, patch: Partial<Cell> = {}): Cell {
    return { ...blankCell(), ch, ...patch };
}

function writeText(screen: Screen, x: number, y: number, text: string): void {
    for (let i = 0; i < text.length; i++) {
        screen.back.set(x + i, y, textCell(text[i] ?? " "));
    }
}

describe("Screen", () => {
    test("repaints the whole screen on the first frame", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 4, 2);
        screen.setCursor(null);
        screen.flush();
        expect(sink.output).toContain("\x1b[1;1H");
        expect(sink.output).toContain("\x1b[2;1H");
    });

    test("emits nothing when nothing changed between frames", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 3);
        writeText(screen, 0, 0, "hi");
        screen.flush();
        sink.output = "";
        screen.flush();
        expect(sink.output).toBe("");
    });

    test("positions the cursor once per changed run and writes the text", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 3);
        screen.setCursor(null);
        screen.flush(); // first frame repaints everything and seeds the front buffer
        sink.output = "";
        writeText(screen, 2, 1, "abc");
        screen.flush();
        expect(sink.output).toContain("\x1b[2;3H");
        expect(sink.output).toContain("abc");
    });

    test("coalesces adjacent cells that share attributes into one SGR", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 1);
        for (let i = 0; i < 3; i++) {
            screen.back.set(i, 0, textCell("x", { attrs: ATTR_BOLD }));
        }
        screen.setCursor(null);
        screen.flush();
        const sgrCount = sink.output.split("\x1b[0;1m").length - 1;
        expect(sgrCount).toBe(1);
        expect(sink.output).toContain("xxx");
    });

    test("redraws only the cells that changed", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 2);
        writeText(screen, 0, 0, "aaaa");
        writeText(screen, 0, 1, "bbbb");
        screen.flush();
        sink.output = "";
        screen.back.set(2, 1, textCell("Z"));
        screen.flush();
        expect(sink.output).toContain("Z");
        expect(sink.output).not.toContain("aaaa");
        expect(sink.output).not.toContain("bbbb");
    });

    test("hides the cursor when set to null and shows it at a position", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 3);
        screen.setCursor(null);
        screen.flush();
        expect(sink.output).toContain("\x1b[?25l");

        sink.output = "";
        screen.setCursor({ x: 4, y: 2 });
        screen.flush();
        expect(sink.output).toContain("\x1b[3;5H");
        expect(sink.output).toContain("\x1b[?25h");
    });

    test("does not share cell objects between frames", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 4, 1);
        screen.setCursor(null);
        screen.flush();
        sink.output = "";
        screen.back.get(0, 0).ch = "X"; // mutated in place, not via set()
        screen.flush();
        expect(sink.output).toContain("X");
    });

    test("re-emits the cursor after a resize even if it did not move", () => {
        // A full repaint leaves the real cursor wherever the last painted run
        // ended, so an unchanged logical position still has to be re-sent.
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 3);
        screen.setCursor({ x: 2, y: 1 });
        screen.flush();
        screen.resize(12, 4);
        sink.output = "";
        screen.setCursor({ x: 2, y: 1 });
        screen.flush();
        expect(sink.output).toContain("\x1b[2;3H");
    });

    test("repaints everything after a resize", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 2);
        writeText(screen, 0, 0, "keep");
        screen.flush();
        sink.output = "";
        screen.resize(12, 3);
        writeText(screen, 0, 0, "keep");
        screen.flush();
        expect(sink.output).toContain("keep");
    });
    test("re-states the cursor after a frame that painted elsewhere", () => {
        // Painting moves the real cursor to the end of the last run, so a frame
        // that drew anything has to send the cursor back even if it did not move.
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 3);
        screen.setCursor({ x: 4, y: 2 });
        screen.back.set(0, 0, textCell("a"));
        screen.flush();
        sink.output = "";
        screen.back.set(7, 0, textCell("Z"));
        screen.flush();
        expect(sink.output).toContain("Z");
        expect(sink.output.endsWith("\x1b[3;5H\x1b[?25h")).toBe(true);
    });

    test("stays silent on an unchanged frame with a visible cursor", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 3);
        screen.setCursor({ x: 4, y: 2 });
        writeText(screen, 0, 0, "hi");
        screen.flush();
        sink.output = "";
        screen.flush();
        expect(sink.output).toBe("");
    });

    test("tracks a cursor object the caller keeps mutating", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 3);
        const pos = { x: 1, y: 1 };
        screen.setCursor(pos);
        screen.flush();
        sink.output = "";
        pos.x = 5;
        screen.setCursor(pos);
        screen.flush();
        expect(sink.output).toContain("\x1b[2;6H");
    });

    test("does not share colour objects between frames", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 4, 1);
        screen.setCursor(null);
        screen.back.set(0, 0, textCell("x", { fg: { kind: "palette", index: 1 } }));
        screen.flush();
        sink.output = "";
        const fg = screen.back.get(0, 0).fg; // mutated in place, not via set()
        if (fg.kind === "palette") fg.index = 5;
        screen.flush();
        expect(sink.output).toContain("38;5;5");
    });
});
