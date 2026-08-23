import { scanCsi } from "./csi";
import { decodeLegacy, flushCarry, type DecodeResult, type InputEvent } from "./decode-legacy";
import { modsFromParam, type KeyEvent, type KeyName } from "./keys";

const ESC = "\x1b";
const MAX_CODE_POINT = 0x10ffff;

// Space is deliberately absent: the legacy decoder reports it as a char event,
// and one key must have one shape downstream of both decoders.
const CODEPOINT_TO_NAME: Record<number, KeyName | undefined> = {
    9: "tab",
    13: "enter",
    27: "escape",
    127: "backspace",
};

type KittyScan =
    | { kind: "sequence"; params: string; length: number }
    | { kind: "incomplete" }
    | { kind: "none" };

/** True for a kitty parameter list: digits, `;` separators and `:` sub-fields. */
function isKittyParams(params: string): boolean {
    for (let i = 0; i < params.length; i++) {
        const code = params.charCodeAt(i);
        const isDigit = code >= 0x30 && code <= 0x39;
        if (!isDigit && code !== 0x3b && code !== 0x3a) return false;
    }
    return true;
}

/** Scans a kitty `CSI … u` key sequence starting at `start`. */
function scanKitty(buf: string, start: number): KittyScan {
    if (buf[start] !== ESC) return { kind: "none" };
    if (start + 1 >= buf.length) return { kind: "incomplete" };
    if (buf[start + 1] !== "[") return { kind: "none" };

    const scan = scanCsi(buf, start);
    if (scan.kind === "incomplete") return { kind: "incomplete" };
    if (scan.kind === "invalid") return { kind: "none" };
    // A private-parameter `CSI ? … u` is the terminal answering the protocol
    // query, not a key, so isKittyParams rejects it along with anything else
    // this decoder cannot read.
    if (scan.final !== "u" || scan.intermediates !== "" || !isKittyParams(scan.params)) {
        return { kind: "none" };
    }
    return { kind: "sequence", params: scan.params, length: scan.length };
}

/** Index of the next complete kitty sequence at or after `from`, or -1. */
function nextKittyStart(buf: string, from: number): number {
    for (let i = from; i < buf.length; i++) {
        if (scanKitty(buf, i).kind === "sequence") return i;
    }
    return -1;
}

/** The first sub-field of a parameter, as a number, or NaN when absent. */
function subField(params: string[], index: number, sub: number): number {
    return Number.parseInt((params[index] ?? "").split(":")[sub] ?? "", 10);
}

function eventKind(value: number): KeyEvent["kind"] {
    if (value === 2) return "repeat";
    if (value === 3) return "release";
    return "press";
}

/** Builds the key event for one `CSI … u` parameter list, if it names a key. */
function kittyEvent(params: string): KeyEvent | undefined {
    const fields = params.split(";");
    // `unicode-key-code : shifted-key : base-layout-key` — only the first
    // sub-field is the key that was actually pressed.
    const codepoint = subField(fields, 0, 0);
    // Out of range would make String.fromCodePoint throw, which would take the
    // whole input pipeline down over one malformed sequence.
    if (!Number.isInteger(codepoint) || codepoint < 0 || codepoint > MAX_CODE_POINT) {
        return undefined;
    }

    const modParam = subField(fields, 1, 0);
    const mods = modsFromParam(Number.isInteger(modParam) ? modParam : 1);
    const kind = eventKind(subField(fields, 1, 1));

    const name = CODEPOINT_TO_NAME[codepoint];
    if (name !== undefined) return { name, mods, kind };
    return { name: "char", char: String.fromCodePoint(codepoint), mods, kind };
}

/**
 * Decode one read from a terminal with the kitty keyboard protocol pushed.
 * Only `u`-final sequences are kitty-specific; everything else keeps its
 * legacy encoding under flag 1, so it is delegated.
 */
function decodeKitty(input: string, carry: string): DecodeResult {
    const buf = carry + input;
    const events: InputEvent[] = [];
    let i = 0;

    while (i < buf.length) {
        const scan = scanKitty(buf, i);
        if (scan.kind === "incomplete") return { events, carry: buf.slice(i) };
        if (scan.kind === "sequence") {
            const event = kittyEvent(scan.params);
            if (event !== undefined) events.push(event);
            i += scan.length;
            continue;
        }

        // Not a kitty sequence here. Hand the legacy decoder only the run up to
        // the next kitty sequence, so a chunk mixing both kinds keeps all of
        // its keys.
        const next = nextKittyStart(buf, i + 1);
        const chunk = buf.slice(i, next === -1 ? buf.length : next);
        const legacy = decodeLegacy(chunk, "");
        events.push(...legacy.events);
        if (next === -1) return { events, carry: legacy.carry };
        // The chunk ended mid-sequence, but a kitty sequence follows it in the
        // same read, so nothing can ever complete it. Release it as the chord
        // it must have been rather than dropping the keypress.
        events.push(...flushCarry(legacy.carry));
        i = next;
    }

    return { events, carry: "" };
}

export { decodeKitty };
