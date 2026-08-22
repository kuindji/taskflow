import { inRange, scanCsi } from "./csi";
import { noMods, modsFromParam, type KeyEvent, type KeyName } from "./keys";

const ESC = "\x1b";

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

interface DecodeResult {
    events: KeyEvent[];
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
    const events: KeyEvent[] = [];
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
                // Nothing here can complete a CSI sequence, so the ESC was a
                // real Escape press and the rest is separate input. Carrying it
                // instead would wedge the decoder on every later read.
                events.push(press("escape"));
                i++;
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

export { decodeLegacy, flushCarry };
export type { DecodeResult };
