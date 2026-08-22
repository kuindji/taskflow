import { ScreenBuffer, cellsEqual, copyCell, type Cell } from "./cells";
import { sgrDiff } from "./sgr";

interface Sink {
    write(data: string): void;
}

interface CursorPos {
    x: number;
    y: number;
}

class Screen {
    private front: ScreenBuffer;
    private cursor: CursorPos | null = null;
    private lastCursor: CursorPos | null = null;
    private cursorInitialised = false;
    private forceRepaint = true;

    public back: ScreenBuffer;

    constructor(
        private readonly sink: Sink,
        cols: number,
        rows: number,
    ) {
        this.front = new ScreenBuffer(cols, rows);
        this.back = new ScreenBuffer(cols, rows);
    }

    setCursor(pos: CursorPos | null): void {
        this.cursor = pos;
    }

    resize(cols: number, rows: number): void {
        this.front = new ScreenBuffer(cols, rows);
        this.back = new ScreenBuffer(cols, rows);
        this.forceRepaint = true;
        // A full repaint leaves the real cursor wherever the last run ended, so
        // it must be re-emitted even if its logical position did not change.
        this.cursorInitialised = false;
        this.lastCursor = null;
    }

    flush(): void {
        let out = "";
        let pen: Cell | null = null;
        let painted = false;

        for (let y = 0; y < this.back.rows; y++) {
            let x = 0;
            while (x < this.back.cols) {
                const next = this.back.get(x, y);
                if (!this.forceRepaint && cellsEqual(this.front.get(x, y), next)) {
                    x++;
                    continue;
                }

                out += `\x1b[${String(y + 1)};${String(x + 1)}H`;
                painted = true;
                // Emit the contiguous run of changed cells starting here.
                while (x < this.back.cols) {
                    const cell = this.back.get(x, y);
                    if (!this.forceRepaint && cellsEqual(this.front.get(x, y), cell)) break;
                    const sgr = sgrDiff(pen, cell);
                    if (sgr !== "") out += sgr;
                    pen = cell;
                    if (cell.width !== 0) out += cell.ch;
                    this.front.set(x, y, cell);
                    x++;
                }
            }
        }

        out += this.cursorSequence(painted);

        if (out !== "") this.sink.write(out);
        this.forceRepaint = false;
        this.back = this.cloneFront();
    }

    private cursorSequence(painted: boolean): string {
        const cursor = this.cursor;
        const moved = cursor?.x !== this.lastCursor?.x || cursor?.y !== this.lastCursor?.y;
        // Painting a run leaves the real cursor at the end of that run, so any
        // frame that drew something has to re-state a visible cursor even when
        // its logical position did not change. A hidden one needs no re-state:
        // where it sits is not observable.
        const changed = !this.cursorInitialised || moved || (painted && cursor !== null);
        this.cursorInitialised = true;
        // Copied, not aliased: a caller that keeps mutating the object it passed
        // to setCursor would otherwise drag lastCursor along with it and every
        // move would compare equal.
        this.lastCursor = cursor === null ? null : { ...cursor };
        if (!changed) return "";
        if (cursor === null) return "\x1b[?25l";
        return `\x1b[${String(cursor.y + 1)};${String(cursor.x + 1)}H\x1b[?25h`;
    }

    private cloneFront(): ScreenBuffer {
        const next = new ScreenBuffer(this.front.cols, this.front.rows);
        for (let y = 0; y < this.front.rows; y++) {
            // Copy each cell, colours included: sharing any reference would
            // make an in-place edit to the back buffer invisible to the next
            // frame's diff.
            for (let x = 0; x < this.front.cols; x++) next.set(x, y, copyCell(this.front.get(x, y)));
        }
        return next;
    }
}

export { Screen };
export type { Sink };
