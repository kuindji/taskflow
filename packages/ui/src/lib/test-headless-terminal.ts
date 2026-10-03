import { createRequire } from "node:module";
import type { Terminal } from "@xterm/xterm";

const require = createRequire(import.meta.url);
const { Terminal: HeadlessTerminal } =
    require("../../../../node_modules/.bun/@xterm+headless@5.5.0/node_modules/@xterm/headless/lib-headless/xterm-headless.js") as {
        Terminal: new (options: { cols: number; rows: number; allowProposedApi: boolean }) => {
            write(data: string): void;
        };
    };

export async function createTerminalWithText(text: string, cols = 20): Promise<Terminal> {
    const term = new HeadlessTerminal({ cols, rows: 10, allowProposedApi: true });
    term.write(text);
    await new Promise((resolve) => setTimeout(resolve, 10));
    return term as unknown as Terminal;
}
