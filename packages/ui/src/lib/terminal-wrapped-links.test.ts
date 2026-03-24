import { describe, expect, it } from "bun:test";
import { createRequire } from "node:module";
import type { Terminal } from "@xterm/xterm";
import { getWrappedLineWindow, getWrappedRangeForMatch } from "./terminal-wrapped-links";

const require = createRequire(import.meta.url);
const { Terminal: HeadlessTerminal } =
    require("../../../../node_modules/.bun/@xterm+headless@5.5.0/node_modules/@xterm/headless/lib-headless/xterm-headless.js") as {
        Terminal: new (options: { cols: number; rows: number; allowProposedApi: boolean }) => {
            write(data: string): void;
        };
    };

async function createTerminalWithText(text: string, cols = 20): Promise<Terminal> {
    const term = new HeadlessTerminal({ cols, rows: 10, allowProposedApi: true });
    term.write(text);
    await new Promise((resolve) => setTimeout(resolve, 10));
    return term as unknown as Terminal;
}

describe("terminal wrapped links", () => {
    it("reconstructs a wrapped relative file path from a continuation row", async () => {
        const path = "./src/components/panes/TerminalPane.tsx:291:7";
        const term = await createTerminalWithText(`error ${path}`, 18);

        const row0 = term.buffer.active.getLine(0);
        const row1 = term.buffer.active.getLine(1);

        expect(row0?.isWrapped).toBe(false);
        expect(row1?.isWrapped).toBe(true);

        const wrapped = getWrappedLineWindow(term, 1);
        expect(wrapped?.text).toBe(`error ${path}`);
    });

    it("maps a wrapped file path match back to a multi-row buffer range", async () => {
        const path = "./src/components/panes/TerminalPane.tsx:291:7";
        const term = await createTerminalWithText(`error ${path}`, 18);
        const wrapped = getWrappedLineWindow(term, 1);

        if (!wrapped) {
            expect(wrapped).not.toBeNull();
            return;
        }
        const matchIndex = wrapped.text.indexOf(path);
        expect(matchIndex).toBeGreaterThanOrEqual(0);

        const range = getWrappedRangeForMatch(
            term,
            wrapped.startLineIndex,
            matchIndex,
            path.length,
        );
        if (!range) {
            expect(range).not.toBeNull();
            return;
        }
        expect(range.start.y).toBe(1);
        expect(range.end.y).toBeGreaterThan(1);
    });
});
