import type { KeyEvent, KeyMods, KeyName } from "./keys";

interface ChildModes {
    applicationCursorKeys: boolean;
    bracketedPaste: boolean;
    kittyFlags: number | null;
}

const ARROW_FINALS: Partial<Record<KeyName, string>> = {
    up: "A",
    down: "B",
    right: "C",
    left: "D",
    home: "H",
    end: "F",
};

const TILDE_CODES: Partial<Record<KeyName, number>> = {
    insert: 2,
    delete: 3,
    pageup: 5,
    pagedown: 6,
};

const SIMPLE: Partial<Record<KeyName, string>> = {
    enter: "\r",
    tab: "\t",
    backspace: "\x7f",
    escape: "\x1b",
    space: " ",
};

const KITTY_CODEPOINTS: Partial<Record<KeyName, number>> = {
    enter: 13,
    escape: 27,
    tab: 9,
    backspace: 127,
    space: 32,
};

function modParam(mods: KeyMods): number {
    return (
        1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0) + (mods.super ? 8 : 0)
    );
}

function hasModifier(mods: KeyMods): boolean {
    return mods.ctrl || mods.alt || mods.shift || mods.super;
}

const KITTY_DISAMBIGUATE = 1;
const KITTY_REPORT_EVENT_TYPES = 2;
const KITTY_REPORT_ALL_KEYS = 8;

/** The kitty event-type subparameter: press is the default and has none. */
function eventSuffix(kind: KeyEvent["kind"]): string {
    if (kind === "repeat") return ":2";
    if (kind === "release") return ":3";
    return "";
}

/**
 * Which keys flag 1 ("disambiguate escape codes") moves to CSI u. Per the kitty
 * protocol spec: "the terminal will report the Esc, alt+key, ctrl+key,
 * ctrl+alt+key, shift+alt+key keys using CSI u sequences instead of legacy
 * ones", and "ctrl+c will no longer generate the SIGINT signal, but instead be
 * delivered as a CSI u escape code". Plain text stays literal, and Enter, Tab
 * and Backspace keep their legacy bytes for shell compatibility.
 */
function needsKittyEncoding(ev: KeyEvent): boolean {
    if (ev.mods.ctrl || ev.mods.alt || ev.mods.super) return true;
    if (ev.name === "escape") return true;
    // Unmodified these stay legacy; their shifted forms have no legacy encoding.
    if (ev.name === "enter" || ev.name === "tab" || ev.name === "backspace") {
        return ev.mods.shift;
    }
    return false;
}

const BACK_TAB = "\x1b[Z";

/**
 * `eventTag` is the kitty `:2`/`:3` event-type subparameter, non-empty only
 * for a repeat or release the child asked to see. Arrows and tilde keys carry
 * it in their escape code; every other key has nowhere to put it, so flag 2 is
 * simply ignored for them — the spec reports no release, and a repeat is
 * encoded as another press.
 */
function encodeLegacy(
    ev: KeyEvent,
    modes: { applicationCursorKeys: boolean },
    eventTag = "",
): string {
    const tagged = eventTag !== "";

    const arrow = ARROW_FINALS[ev.name];
    if (arrow !== undefined) {
        if (hasModifier(ev.mods) || tagged) {
            return `\x1b[1;${String(modParam(ev.mods))}${eventTag}${arrow}`;
        }
        return modes.applicationCursorKeys ? `\x1bO${arrow}` : `\x1b[${arrow}`;
    }

    const tilde = TILDE_CODES[ev.name];
    if (tilde !== undefined) {
        if (hasModifier(ev.mods) || tagged) {
            return `\x1b[${String(tilde)};${String(modParam(ev.mods))}${eventTag}~`;
        }
        return `\x1b[${String(tilde)}~`;
    }

    // The keys below have no escape code to carry `eventTag`. The kitty spec
    // does not report their releases at all, and a repeat with nowhere to mark
    // itself is just another press — dropping it would stop auto-repeat.
    if (ev.kind === "release") return "";

    // A legacy terminal reports Shift+Tab as back-tab and has no other way to
    // spell it, so a bare tab byte would drop the direction.
    if (ev.name === "tab" && ev.mods.shift) return ev.mods.alt ? `\x1b${BACK_TAB}` : BACK_TAB;

    const simple = SIMPLE[ev.name];
    if (simple !== undefined) return ev.mods.alt ? `\x1b${simple}` : simple;

    const char = ev.char;
    if (char === undefined) return "";

    if (ev.mods.ctrl) {
        // The C0 byte for a ctrl chord is the character minus 64, which covers
        // Ctrl+A..Ctrl+Z as well as Ctrl+@ (NUL, what Ctrl+Space sends) and
        // Ctrl+\, Ctrl+], Ctrl+^ and Ctrl+_ — the same range decodeControl reads.
        const upper = char.toUpperCase().charCodeAt(0);
        if (upper >= 64 && upper <= 95) {
            const control = String.fromCharCode(upper - 64);
            return ev.mods.alt ? `\x1b${control}` : control;
        }
    }

    return ev.mods.alt ? `\x1b${char}` : char;
}

function encodeKitty(ev: KeyEvent, modes: ChildModes, flags: number): string {
    const reportsEvents = (flags & KITTY_REPORT_EVENT_TYPES) !== 0;
    if (!reportsEvents && ev.kind === "release") return "";
    // Without the report-event-types flag a repeat is indistinguishable from a
    // press, which is what auto-repeat has to look like to the child.
    const kindSuffix = reportsEvents ? eventSuffix(ev.kind) : "";

    // Flag 1 is what asks for ctrl/alt/escape as CSI u; a child that pushed only
    // other flags never negotiated that and still expects the legacy bytes, so
    // Ctrl+C has to stay the interrupt byte for it.
    const disambiguate = (flags & KITTY_DISAMBIGUATE) !== 0;
    const forceAll = (flags & KITTY_REPORT_ALL_KEYS) !== 0;
    if (!forceAll && !(disambiguate && needsKittyEncoding(ev))) {
        return encodeLegacy(ev, modes, kindSuffix);
    }

    const codepoint =
        ev.name === "char" ? (ev.char?.codePointAt(0) ?? 0) : (KITTY_CODEPOINTS[ev.name] ?? 0);
    if (codepoint === 0) return encodeLegacy(ev, modes, kindSuffix);

    const param = modParam(ev.mods);
    if (param === 1 && kindSuffix === "") return `\x1b[${String(codepoint)}u`;
    return `\x1b[${String(codepoint)};${String(param)}${kindSuffix}u`;
}

function encodeForChild(ev: KeyEvent, modes: ChildModes): string {
    if (modes.kittyFlags !== null) return encodeKitty(ev, modes, modes.kittyFlags);
    // A child that never pushed the protocol has no encoding for a release, and
    // reads a repeat as another press.
    if (ev.kind === "release") return "";
    return encodeLegacy(ev, modes);
}

function encodePaste(text: string, modes: ChildModes): string {
    return modes.bracketedPaste ? `\x1b[200~${text}\x1b[201~` : text;
}

export { encodeForChild, encodePaste };
export type { ChildModes };
