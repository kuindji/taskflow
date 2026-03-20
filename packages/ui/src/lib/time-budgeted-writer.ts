import type { Terminal } from "@xterm/xterm";

const WRITE_BUDGET_MS = 4;
const IDLE_BUDGET_MS = 12;
const HIGH_WATER_BUDGET_MS = 8;
const MAX_CHUNK_SIZE = 64 * 1024; // 64KB per term.write() call
const HIGH_WATER_MARK = 512 * 1024; // 512KB triggers catch-up mode

/**
 * Buffers incoming data and flushes to xterm.js within a per-frame time budget.
 *
 * Instead of calling `term.write()` synchronously for every WebSocket message,
 * data is accumulated and written in controlled chunks each animation frame.
 * This prevents xterm's internal parser queue from growing unbounded during
 * output bursts, eliminating frame drops and visual tearing.
 *
 * This is a pure write-buffering concern — scroll management is handled
 * externally by the consumer (TerminalPane).
 */
class TimeBudgetedWriter {
    private buffer = "";
    private rafHandle: number | null = null;
    private term: Terminal;
    private _visible = true;
    private disposed = false;
    private flushResolvers: Array<() => void> = [];

    /** Called after each frame's writes are flushed to xterm (via sentinel callback). */
    onBeforeWrite: (() => void) | null = null;

    /** Called after each frame's writes are flushed to xterm (via sentinel callback). */
    onDidWrite: (() => void) | null = null;

    constructor(term: Terminal) {
        this.term = term;
    }

    set visible(value: boolean) {
        this._visible = value;
    }

    write(data: string): void {
        if (this.disposed || !data) return;
        this.buffer += data;
        this.scheduleFlush();
    }

    /**
     * Returns a promise that resolves when all currently buffered data
     * has been written to the terminal AND processed by xterm.js.
     * Used before marking history as loaded to ensure snapshot data
     * is fully rendered.
     */
    flush(): Promise<void> {
        if (this.buffer.length === 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
            this.flushResolvers.push(resolve);
            this.scheduleFlush();
        });
    }

    dispose(): void {
        this.disposed = true;
        if (this.rafHandle !== null) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
        }
        // Flush remaining buffer synchronously on disposal
        if (this.buffer.length > 0) {
            this.term.write(this.buffer);
            this.buffer = "";
        }
        this.resolveFlushWaiters();
    }

    private scheduleFlush(): void {
        if (this.rafHandle !== null || this.disposed) return;
        this.rafHandle = requestAnimationFrame(() => this.onFrame());
    }

    private onFrame(): void {
        this.rafHandle = null;
        if (this.disposed || this.buffer.length === 0) {
            this.resolveFlushWaiters();
            return;
        }

        const isHighWater = this.buffer.length > HIGH_WATER_MARK;
        let budget: number;
        if (isHighWater) {
            budget = HIGH_WATER_BUDGET_MS;
        } else if (this._visible) {
            budget = WRITE_BUDGET_MS;
        } else {
            budget = IDLE_BUDGET_MS;
        }

        const start = performance.now();
        this.onBeforeWrite?.();

        while (this.buffer.length > 0 && performance.now() - start < budget) {
            const chunkSize = Math.min(this.buffer.length, MAX_CHUNK_SIZE);
            let end = chunkSize;

            // Try to split on a newline boundary to keep escape sequences intact
            if (end < this.buffer.length) {
                const lastNewline = this.buffer.lastIndexOf("\n", end);
                if (lastNewline > 0) {
                    end = lastNewline + 1;
                }
            }

            const chunk = this.buffer.slice(0, end);
            this.buffer = this.buffer.slice(end);
            this.term.write(chunk);
        }

        // Use a sentinel write with callback to ensure flush resolution and
        // onDidWrite happen after xterm has actually processed all the data
        // written above.
        const bufferDrained = this.buffer.length === 0;

        this.term.write("", () => {
            if (this.disposed) return;
            this.onDidWrite?.();
            if (bufferDrained) {
                this.resolveFlushWaiters();
            }
        });

        if (!bufferDrained) {
            this.scheduleFlush();
        }
    }

    private resolveFlushWaiters(): void {
        if (this.flushResolvers.length > 0) {
            const resolvers = this.flushResolvers;
            this.flushResolvers = [];
            for (const resolve of resolvers) resolve();
        }
    }
}

export { TimeBudgetedWriter };
