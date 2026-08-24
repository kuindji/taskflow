/**
 * A CSI sequence is `ESC [`, then parameter bytes, then intermediate bytes,
 * then one final byte (ECMA-48 5.4). `incomplete` means the tail could still
 * grow into a sequence and belongs in a carry; `invalid` means it never can,
 * so the caller must consume something and move on rather than carry forever.
 * An `invalid` scan reports `length` too: the distance from `start` to the
 * byte that ruled the sequence out, so a caller that knows the scanned run was
 * never keys can discard exactly that run and resume on the offending byte.
 * A body that reaches `MAX_CSI_BODY` is `invalid` for the same reason, with
 * `length` covering the whole run that was ruled out.
 */
type CsiScan =
    | { kind: "sequence"; params: string; intermediates: string; final: string; length: number }
    | { kind: "incomplete" }
    | { kind: "invalid"; length: number };

/**
 * The longest body — parameter bytes plus intermediate bytes — this scanner
 * will hold as a sequence that could still complete. No terminal sends a CSI
 * anywhere near this long; the longest this decoder reads is a kitty key
 * sequence, which is tens of bytes. The cap exists because an incomplete scan
 * is held in a carry until its final byte arrives, and the caller re-scans that
 * carry from the start on every read: without a cap, a stream of parameter
 * bytes that never reaches a final byte grows the carry without bound and
 * makes each read cost more than the last.
 */
const MAX_CSI_BODY = 256;

function inRange(code: number, min: number, max: number): boolean {
    return code >= min && code <= max;
}

/**
 * Scans the CSI sequence starting at `start`, where `buf[start]` is ESC and
 * `buf[start + 1]` is `[`. Written as a character-code scan rather than a
 * regex because `no-control-regex` bans ESC inside a regex literal.
 */
function scanCsi(buf: string, start: number): CsiScan {
    const bodyStart = start + 2;
    // Stop scanning one byte past the cap so an over-long body is recognized
    // without walking the rest of the read.
    const limit = Math.min(buf.length, bodyStart + MAX_CSI_BODY);

    let i = bodyStart;
    while (i < limit && inRange(buf.charCodeAt(i), 0x30, 0x3f)) i++;
    const params = buf.slice(bodyStart, i);

    const intermediateStart = i;
    while (i < limit && inRange(buf.charCodeAt(i), 0x20, 0x2f)) i++;
    const intermediates = buf.slice(intermediateStart, i);

    // The body filled the cap without reaching a final byte. Reporting this as
    // `incomplete` is what would let a stream of parameter bytes grow a
    // caller's carry without bound, so it is ruled out here instead.
    if (i === bodyStart + MAX_CSI_BODY) return { kind: "invalid", length: i - start };
    if (i >= buf.length) return { kind: "incomplete" };
    if (!inRange(buf.charCodeAt(i), 0x40, 0x7e)) return { kind: "invalid", length: i - start };
    return { kind: "sequence", params, intermediates, final: buf[i] ?? "", length: i + 1 - start };
}

/** True when every character of `params` is a digit. */
function isDigits(params: string): boolean {
    if (params === "") return false;
    for (let i = 0; i < params.length; i++) {
        if (!inRange(params.charCodeAt(i), 0x30, 0x39)) return false;
    }
    return true;
}

export { scanCsi, inRange, isDigits };
export type { CsiScan };
