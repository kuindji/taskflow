/**
 * A CSI sequence is `ESC [`, then parameter bytes, then intermediate bytes,
 * then one final byte (ECMA-48 5.4). `incomplete` means the tail could still
 * grow into a sequence and belongs in a carry; `invalid` means it never can,
 * so the caller must consume something and move on rather than carry forever.
 */
type CsiScan =
    | { kind: "sequence"; params: string; intermediates: string; final: string; length: number }
    | { kind: "incomplete" }
    | { kind: "invalid" };

function inRange(code: number, min: number, max: number): boolean {
    return code >= min && code <= max;
}

/**
 * Scans the CSI sequence starting at `start`, where `buf[start]` is ESC and
 * `buf[start + 1]` is `[`. Written as a character-code scan rather than a
 * regex because `no-control-regex` bans ESC inside a regex literal.
 */
function scanCsi(buf: string, start: number): CsiScan {
    let i = start + 2;
    while (i < buf.length && inRange(buf.charCodeAt(i), 0x30, 0x3f)) i++;
    const params = buf.slice(start + 2, i);

    const intermediateStart = i;
    while (i < buf.length && inRange(buf.charCodeAt(i), 0x20, 0x2f)) i++;
    const intermediates = buf.slice(intermediateStart, i);

    if (i >= buf.length) return { kind: "incomplete" };
    if (!inRange(buf.charCodeAt(i), 0x40, 0x7e)) return { kind: "invalid" };
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
