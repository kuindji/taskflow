import { isDigits, scanCsi } from "./csi";

interface NegotiateIo {
    write(data: string): void;
    waitForData(timeoutMs: number): Promise<string>;
}

const ESC = "\x1b";
const QUERY = "\x1b[?u";
const DEFAULT_TIMEOUT_MS = 150;

/** True for `CSI ? <flags> u`, the reply a kitty-capable terminal sends. */
function isFlagsReply(reply: string): boolean {
    for (let i = 0; i < reply.length; i++) {
        if (reply[i] !== ESC || reply[i + 1] !== "[") continue;
        const scan = scanCsi(reply, i);
        if (scan.kind !== "sequence") continue;
        if (scan.final !== "u" || scan.intermediates !== "") continue;
        if (scan.params.startsWith("?") && isDigits(scan.params.slice(1))) return true;
    }
    return false;
}

/**
 * Ask the outer terminal whether it speaks the kitty keyboard protocol.
 * A terminal that does replies `CSI ? <flags> u`; one that does not stays
 * silent, so the timeout is the negative answer. The reply can arrive with
 * ordinary keystrokes around it, so it is searched for rather than matched.
 */
async function negotiateKitty(io: NegotiateIo, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
    io.write(QUERY);
    const reply = await io.waitForData(timeoutMs);
    return isFlagsReply(reply);
}

export { negotiateKitty };
