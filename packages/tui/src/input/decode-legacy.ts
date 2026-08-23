import { inRange, scanCsi } from "./csi";
import { noMods, modsFromParam, type KeyEvent, type KeyName } from "./keys";
import { parseSgrMouse, parseX10Mouse, type MouseReport } from "./mouse";

const ESC = "\x1b";
/** `CSI M` is followed by exactly three raw payload characters. */
const X10_PAYLOAD_LENGTH = 3;
/** Every X10 payload character is `32 + value`, so nothing below this is one. */
const X10_BIAS = 32;

/**
 * Index of the first character of an X10 payload that cannot be one, or -1.
 * The case that matters is ESC, which opens the next report or a real key: a
 * header whose payload was lost would otherwise take those bytes as its own and
 * leave the sequence they started to decode as typed characters.
 */
function impossibleX10Byte(payload: string): number {
    for (let n = 0; n < payload.length; n++) {
        if (payload.charCodeAt(n) < X10_BIAS) return n;
    }
    return -1;
}

const FINAL_TO_NAME: Record<string, KeyName | undefined> = {
    A: "up",
    B: "down",
    C: "right",
    D: "left",
    H: "home",
    F: "end",
};

const TILDE_TO_NAME: Record<number, KeyName | undefined> = {
    1: "home",
    2: "insert",
    3: "delete",
    4: "end",
    5: "pageup",
    6: "pagedown",
    // rxvt and the Linux console report Home and End as 7 and 8 rather than
    // the 1 and 4 xterm uses, so both encodings have to be recognized.
    7: "home",
    8: "end",
};

type InputEvent = KeyEvent | MouseReport;

interface DecodeResult {
    events: InputEvent[];
    carry: string;
}

function press(name: KeyName, mods = noMods(), char?: string): KeyEvent {
    return char === undefined
        ? { name, mods, kind: "press" }
        : { name, char, mods, kind: "press" };
}

function decodeControl(code: number): KeyEvent {
    if (code === 13 || code === 10) return press("enter");
    if (code === 9) return press("tab");
    if (code === 127 || code === 8) return press("backspace");
    if (code === 32) return press("char", noMods(), " ");
    // A C0 byte is Ctrl plus the ASCII character `code + 64`: NUL is Ctrl+@
    // (what Ctrl+Space sends), 0x01-0x1a are Ctrl+A..Ctrl+Z, and 0x1c-0x1f are
    // Ctrl+\, Ctrl+], Ctrl+^ and Ctrl+_. Letters are reported lowercase so a
    // ctrl chord reads the way it is typed and written.
    const upper = code + 64;
    const isLetter = upper >= 65 && upper <= 90;
    const letter = String.fromCharCode(isLetter ? upper + 32 : upper);
    return press("char", { ...noMods(), ctrl: true }, letter);
}

/** True for the plain numeric parameter list this decoder knows how to read. */
function isNumericParams(params: string): boolean {
    for (let i = 0; i < params.length; i++) {
        const code = params.charCodeAt(i);
        if (!inRange(code, 0x30, 0x39) && code !== 0x3b) return false;
    }
    return true;
}

/**
 * Decode one read from a legacy terminal. `carry` holds bytes left over from
 * the previous call because they formed an incomplete escape sequence.
 */
function decodeLegacy(input: string, carry: string): DecodeResult {
    const buf = carry + input;
    const events: InputEvent[] = [];
    let i = 0;

    while (i < buf.length) {
        const ch = buf[i] ?? "";

        if (ch !== ESC) {
            const code = ch.charCodeAt(0);
            if (code < 32 || code === 127) {
                events.push(decodeControl(code));
                i++;
                continue;
            }
            // Astral characters (emoji, less common CJK) arrive as a UTF-16
            // surrogate pair. Stepping one code unit at a time would emit two
            // lone surrogates, which re-encode to U+FFFD on the way to a child.
            const codePoint = buf.codePointAt(i);
            const text = codePoint === undefined ? ch : String.fromCodePoint(codePoint);
            events.push(press("char", noMods(), text));
            i += text.length;
            continue;
        }

        const remaining = buf.length - i;

        if (remaining === 1) return { events, carry: buf.slice(i) };

        if (buf[i + 1] === "[") {
            const scan = scanCsi(buf, i);
            if (scan.kind === "incomplete") return { events, carry: buf.slice(i) };
            if (scan.kind === "invalid") {
                // A `CSI <` run is the front of a mouse report whose tail was
                // lost, and every byte of it is a parameter rather than a key.
                // Falling through to the Escape recovery below would put the
                // whole run on the keymap one character at a time: digits pick
                // a session tab, and under session focus the run is forwarded
                // to the agent as if it had been typed. Discard the run and
                // resume on the byte that ruled it out, which is real input.
                if (buf.startsWith(`${ESC}[<`, i)) {
                    i += scan.length;
                    continue;
                }
                // Nothing here can complete a CSI sequence, so the ESC was a
                // real Escape press and the rest is separate input. Carrying it
                // instead would wedge the decoder on every later read.
                events.push(press("escape"));
                i++;
                continue;
            }
            if (scan.final === "M" && scan.params === "" && scan.intermediates === "") {
                // The X10 form: three raw payload bytes follow the sequence and
                // are not part of it. Left unconsumed they decode as ordinary
                // characters — a click in column 49 sends `Q`, the quit binding.
                const payloadStart = i + scan.length;
                const end = payloadStart + X10_PAYLOAD_LENGTH;
                const payload = buf.slice(payloadStart, end);
                // A byte below the bias is proof this report is never
                // completing, so the header is dropped and the byte is left to
                // decode as whatever it really is. Waiting for the payload
                // instead would swallow the click or keypress it belongs to.
                const impossible = impossibleX10Byte(payload);
                if (impossible !== -1) {
                    i = payloadStart + impossible;
                    continue;
                }
                if (payload.length < X10_PAYLOAD_LENGTH) return { events, carry: buf.slice(i) };
                i = end;
                const report = parseX10Mouse(payload);
                if (report !== undefined) events.push(report);
                continue;
            }
            // Intermediates are excluded for the same reason the X10 branch
            // above excludes them: a CSI carrying one is not a mouse report,
            // however much its parameters read like one, and decoding it as
            // one fabricates a click at whatever cell it names.
            if (
                scan.params.startsWith("<") &&
                scan.intermediates === "" &&
                (scan.final === "M" || scan.final === "m")
            ) {
                i += scan.length;
                const report = parseSgrMouse(scan.params, scan.final);
                if (report !== undefined) events.push(report);
                continue;
            }
            i += scan.length;
            // Private parameters (`CSI ? … u`, a late kitty-protocol reply) and
            // intermediate bytes are terminal replies rather than keys: consumed
            // above, dropped here.
            if (scan.intermediates !== "" || !isNumericParams(scan.params)) continue;
            const params = scan.params
                .split(";")
                .filter((p) => p !== "")
                .map(Number);
            const mods = params.length > 1 ? modsFromParam(params[1] ?? 1) : noMods();
            if (scan.final === "~") {
                const name = TILDE_TO_NAME[params[0] ?? 0];
                if (name !== undefined) events.push(press(name, mods));
            } else if (scan.final === "Z") {
                // `CSI Z` is back-tab, which is how a legacy terminal reports
                // Shift+Tab. It carries no modifier parameter of its own, so
                // the shift bit is implied by the sequence.
                events.push(press("tab", { ...mods, shift: true }));
            } else {
                const name = FINAL_TO_NAME[scan.final];
                if (name !== undefined) events.push(press(name, mods));
            }
            continue;
        }

        if (buf[i + 1] === "O") {
            if (remaining < 3) return { events, carry: buf.slice(i) };
            const name = FINAL_TO_NAME[buf[i + 2] ?? ""];
            if (name !== undefined) events.push(press(name));
            i += 3;
            continue;
        }

        // ESC followed by a printable character is Alt + that character.
        const next = buf[i + 1] ?? "";
        const code = next.charCodeAt(0);
        if (code >= 32 && code !== 127) {
            events.push(press("char", { ...noMods(), alt: true }, next));
            i += 2;
            continue;
        }

        events.push(press("escape"));
        i++;
    }

    return { events, carry: "" };
}

/**
 * True when `carry` is the first half of a mouse report and can be nothing
 * else. The idle timeout must not clear such a carry: `flushCarry` has no
 * event to make of it, so clearing only strips the front of the report and
 * leaves its tail to decode as typed characters. Held instead, the tail
 * completes the report on the next read.
 *
 * Two shapes qualify. A complete `CSI M` still owed X10 payload bytes — the
 * payload is raw printables, so a click in column 49 sends `Q`, which quits.
 * And an incomplete `CSI <` …, the SGR form, whose tail is parameter digits
 * and a final: `1` through `9` select a session tab, and under session focus
 * the whole run is forwarded to the child as if it had been typed. `CSI <` is
 * a private-parameter prefix that no key sequence uses, so holding it cannot
 * delay a keystroke; an ordinary partial CSI such as `CSI 1;5` stays
 * flushable, because that one really can be the head of a chord.
 */
function isPartialMouseReport(carry: string): boolean {
    const x10Header = `${ESC}[M`;
    if (carry.startsWith(x10Header)) {
        return carry.length < x10Header.length + X10_PAYLOAD_LENGTH;
    }
    if (!carry.startsWith(`${ESC}[<`)) return false;
    return scanCsi(carry, 0).kind === "incomplete";
}

/**
 * Convert a carry that has gone stale into events. `decodeLegacy` cannot know
 * whether a trailing ESC starts a longer sequence or is a real Escape press, so
 * it holds it; the caller calls this after a short idle timeout to release it.
 */
function flushCarry(carry: string): KeyEvent[] {
    if (carry === "") return [];
    if (carry === ESC) return [press("escape")];
    // `ESC [` and `ESC O` open a CSI and an SS3 sequence, and they are also
    // exactly what Alt+[ and Alt+O send. decodeLegacy has to carry them in case
    // the rest is still in flight; once the idle timer has expired, the chord
    // is all they can have been. These are the only two-byte carries it emits.
    if (carry.length === 2 && carry.startsWith(ESC)) {
        const next = carry[1] ?? "";
        const code = next.charCodeAt(0);
        if (code >= 32 && code !== 127) {
            return [press("char", { ...noMods(), alt: true }, next)];
        }
    }
    // A partial CSI/SS3 that never completed: drop it rather than emit garbage.
    return [];
}

export { decodeLegacy, flushCarry, isPartialMouseReport };
export type { DecodeResult, InputEvent };
