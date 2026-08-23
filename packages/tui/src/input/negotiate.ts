import { isDigits, scanCsi } from "./csi";

interface NegotiateIo {
    write(data: string): void;
    /** Resolves with the next chunk of input, or `""` once `timeoutMs` elapses. */
    waitForData(timeoutMs: number): Promise<string>;
}

interface NegotiateResult {
    kitty: boolean;
    /**
     * Everything read during the query window that was not the reply itself.
     * That window is the only time anything reads stdin before the decoder
     * exists, so whatever the user typed into it either comes back here or is
     * lost — a `Q` pressed the instant the TUI starts would simply do nothing.
     */
    rest: string;
}

const ESC = "\x1b";
const QUERY = "\x1b[?u";
const DEFAULT_TIMEOUT_MS = 150;

/** The span of `CSI ? <flags> u` within `buf`, or null while it is not there. */
function findFlagsReply(buf: string): { start: number; end: number } | null {
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== ESC || buf[i + 1] !== "[") continue;
        const scan = scanCsi(buf, i);
        if (scan.kind !== "sequence") continue;
        if (scan.final !== "u" || scan.intermediates !== "") continue;
        if (scan.params.startsWith("?") && isDigits(scan.params.slice(1))) {
            return { start: i, end: i + scan.length };
        }
    }
    return null;
}

/**
 * Ask the outer terminal whether it speaks the kitty keyboard protocol.
 * A terminal that does replies `CSI ? <flags> u`; one that does not stays
 * silent, so the timeout is the negative answer.
 *
 * Reads are repeated until the reply is found or the budget runs out, because
 * a keystroke can arrive as its own chunk ahead of the reply: stopping at the
 * first chunk would read that as silence and downgrade a capable terminal.
 * The reply is cut out of what was read and the remainder handed back, so the
 * keystrokes around it can still reach the decoder.
 */
async function negotiateKitty(
    io: NegotiateIo,
    timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<NegotiateResult> {
    io.write(QUERY);
    const deadline = Date.now() + timeoutMs;
    let buf = "";
    for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const chunk = await io.waitForData(remaining);
        // The reader reports its own timeout as an empty chunk: nothing more is
        // coming inside this window, so waiting out the rest of it is dead time.
        if (chunk === "") break;
        buf += chunk;
        const reply = findFlagsReply(buf);
        if (reply !== null) {
            return { kitty: true, rest: buf.slice(0, reply.start) + buf.slice(reply.end) };
        }
    }
    return { kitty: false, rest: buf };
}

export { negotiateKitty };
export type { NegotiateResult };
