import type { KeyEvent, KeyMods, KeyName } from "./keys";
import type { MouseButton, MouseReport } from "./mouse";

interface ChildModes {
    applicationCursorKeys: boolean;
    bracketedPaste: boolean;
    kittyFlags: number | null;
    /**
     * Which mouse events the child asked to see. The names are xterm's own, as
     * `IModes.mouseTrackingMode` reports them.
     */
    mouseTracking: "none" | "x10" | "vt200" | "drag" | "any";
    /**
     * How it asked for them to be spelled: `?1005`, `?1006`, `?1015`, `?1016`,
     * or the unnumbered original. `IModes` has no member for this one, so
     * `SessionTerminal` tracks it by hand.
     */
    mouseEncoding: "x10" | "utf8" | "sgr" | "urxvt" | "sgr-pixels";
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

/**
 * Chords whose control byte does not follow the minus-64 rule. xterm sends the
 * unshifted digit row as the C0 bytes its shifted symbols would produce —
 * Ctrl+2 is NUL like Ctrl+@, Ctrl+6 is 0x1e like Ctrl+^ — and `/` and `?` are
 * the other two conventional spellings of 0x1f and DEL. A kitty terminal
 * reports the physical key, so Ctrl+6 arrives as the digit `6` and would
 * otherwise be typed into the child as text.
 */
const CTRL_ALIASES: Record<string, string | undefined> = {
    " ": "\x00",
    "2": "\x00",
    "3": "\x1b",
    "4": "\x1c",
    "5": "\x1d",
    "6": "\x1e",
    "7": "\x1f",
    "8": "\x7f",
    "/": "\x1f",
    "?": "\x7f",
};

/**
 * The C0 byte a ctrl chord sends, or undefined for a key that has none. The
 * byte is the character minus 64, covering Ctrl+A..Ctrl+Z, Ctrl+@ and Ctrl+\,
 * Ctrl+], Ctrl+^ and Ctrl+_ — the same range decodeControl reads. Every other
 * chord that carries a control byte is in CTRL_ALIASES.
 */
function controlByte(char: string | undefined): string | undefined {
    if (char === undefined) return undefined;
    const alias = CTRL_ALIASES[char];
    if (alias !== undefined) return alias;
    const upper = char.toUpperCase().charCodeAt(0);
    if (upper >= 64 && upper <= 95) return String.fromCharCode(upper - 64);
    return undefined;
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

    // Ahead of the SIMPLE table, which would spell Ctrl+Space as a bare space.
    if (ev.mods.ctrl) {
        const control = controlByte(ev.name === "space" ? " " : ev.char);
        if (control !== undefined) return ev.mods.alt ? `\x1b${control}` : control;
    }

    const simple = SIMPLE[ev.name];
    if (simple !== undefined) return ev.mods.alt ? `\x1b${simple}` : simple;

    const char = ev.char;
    if (char === undefined) return "";

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

/**
 * The wire value of each button, before the drag and modifier bits. Wheel
 * notches live above bit 64; an unnamed button has no value at all, which is
 * why the map is partial rather than defaulting to a left click.
 */
const BUTTON_VALUES: Record<MouseButton, number | undefined> = {
    left: 0,
    middle: 1,
    right: 2,
    "wheel-up": 64,
    "wheel-down": 65,
    "wheel-left": 66,
    "wheel-right": 67,
    none: undefined,
};

/** The button value a non-SGR encoding uses for "something was let go". */
const RELEASE_VALUE = 3;

const MOUSE_DRAG_BIT = 32;

/** Every encoding but SGR offsets its fields by this, to keep them printable. */
const MOUSE_OFFSET = 32;

/**
 * The highest code unit `SESSION_INPUT` can carry as a single byte. `data` is a
 * JavaScript string that the backend hands to `pty.write`, which UTF-8-encodes
 * it, so 128 arrives as two bytes: the child reads a wrong coordinate and the
 * byte that followed leaks out of the report as a keystroke.
 */
const MAX_TRANSPORT_BYTE = 127;

/**
 * Whether the child's tracking mode asked to see this event at all. `x10` is
 * press-only, `vt200` adds release, and `drag`/`any` add motion with a button
 * held — bare motion is never generated, so the last two are the same here.
 */
function tracks(action: MouseReport["action"], tracking: ChildModes["mouseTracking"]): boolean {
    switch (tracking) {
        case "none":
            return false;
        case "x10":
            return action === "press";
        case "vt200":
            return action !== "drag";
        default:
            return true;
    }
}

/**
 * The button field, or undefined for a report with nothing to put in it. A
 * release has a value under every encoding but SGR, where the field must name
 * the button that was let go and an unnamed one cannot be spelled.
 */
function buttonValue(report: MouseReport, modes: ChildModes): number | undefined {
    const base =
        report.action === "release" && modes.mouseEncoding !== "sgr"
            ? RELEASE_VALUE
            : BUTTON_VALUES[report.button];
    if (base === undefined) return undefined;

    const drag = report.action === "drag" ? MOUSE_DRAG_BIT : 0;
    // X10 tracking predates the modifier bits, so a child in it reads them as
    // part of the button number.
    if (modes.mouseTracking === "x10") return base + drag;

    const { mods } = report;
    return (
        base + drag + (mods.shift ? 4 : 0) + (mods.alt ? 8 : 0) + (mods.ctrl ? 16 : 0)
    );
}

/**
 * A decoded mouse report as the focused child would have received it from a
 * real terminal, or `""` for one it never asked for and one it could not read.
 *
 * `col`/`row` are zero-based and relative to the child's own grid; the caller
 * translates out of screen coordinates, and every wire encoding is one-based.
 */
function encodeMouseForChild(report: MouseReport, modes: ChildModes): string {
    if (!tracks(report.action, modes.mouseTracking)) return "";
    // SGR-Pixels sends the same shape with pixel coordinates, and this client
    // has cell geometry and no pixel geometry. Guessing a cell size would put
    // every click in the child's top-left corner; silence is the honest answer.
    if (modes.mouseEncoding === "sgr-pixels") return "";

    const button = buttonValue(report, modes);
    if (button === undefined) return "";

    const x = report.col + 1;
    const y = report.row + 1;

    switch (modes.mouseEncoding) {
        case "sgr": {
            const final = report.action === "release" ? "m" : "M";
            return `\x1b[<${String(button)};${String(x)};${String(y)}${final}`;
        }
        case "urxvt":
            return `\x1b[${String(button + MOUSE_OFFSET)};${String(x)};${String(y)}M`;
        case "utf8":
            // ?1005 asks for the fields as UTF-8, which is exactly the encoding
            // pty.write applies to the string — so there is nothing to cap.
            return `\x1b[M${offsetChars([button, x, y])}`;
        default: {
            const fields = [button, x, y];
            if (fields.some((value) => value + MOUSE_OFFSET > MAX_TRANSPORT_BYTE)) return "";
            return `\x1b[M${offsetChars(fields)}`;
        }
    }
}

function offsetChars(fields: number[]): string {
    return fields.map((value) => String.fromCharCode(value + MOUSE_OFFSET)).join("");
}

export { encodeForChild, encodeMouseForChild, encodePaste };
export type { ChildModes };
