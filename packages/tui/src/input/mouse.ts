import { isDigits } from "./csi";
import { type KeyMods } from "./keys";

type MouseButton =
    | "left"
    | "middle"
    | "right"
    | "wheel-up"
    | "wheel-down"
    | "wheel-left"
    | "wheel-right"
    | "none";

interface MouseReport {
    kind: "mouse";
    /** "drag" is motion with a button held; bare motion is never generated. */
    action: "press" | "release" | "drag";
    button: MouseButton;
    /** Zero-based, in outer-screen coordinates. */
    col: number;
    row: number;
    mods: KeyMods;
}

const WHEEL_BUTTONS: MouseButton[] = ["wheel-up", "wheel-down", "wheel-left", "wheel-right"];
const PLAIN_BUTTONS: MouseButton[] = ["left", "middle", "right", "none"];

function modsFromButton(b: number): KeyMods {
    return { shift: (b & 4) !== 0, alt: (b & 8) !== 0, ctrl: (b & 16) !== 0, super: false };
}

function buttonOf(b: number): MouseButton {
    // Bit 128 first: xterm encodes mouse buttons 8-11 (thumb, back, forward) as
    // `128 + (n - 8)`, which sets no bit 64 and whose low two bits would
    // otherwise read as left/middle/right. Nothing binds them, so they are
    // reported as an unnamed button rather than a wrong one.
    if ((b & 128) !== 0) return "none";
    if ((b & 64) !== 0) return WHEEL_BUTTONS[b & 3] ?? "none";
    return PLAIN_BUTTONS[b & 3] ?? "none";
}

/** The wire button field is one byte in every encoding this decoder reads. */
const MAX_BUTTON = 0xff;

function build(b: number, x: number, y: number, released: boolean): MouseReport | undefined {
    // Coordinates are one-based on the wire. A zero means the report is
    // malformed, and treating it as a click on the origin would move the
    // sidebar selection on a corrupt frame.
    //
    // The upper bound on `b` is load-bearing for the same reason: `&` coerces
    // through ToInt32, so an SGR button of 256 — or of 2**32 — would truncate
    // to 0 and invent a left click at whatever cell the frame named.
    if (!Number.isInteger(b) || b < 0 || b > MAX_BUTTON) return undefined;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1) return undefined;
    const motion = (b & 32) !== 0;
    return {
        kind: "mouse",
        action: released ? "release" : motion ? "drag" : "press",
        button: buttonOf(b),
        col: x - 1,
        row: y - 1,
        mods: modsFromButton(b),
    };
}

/**
 * Parses the SGR form (`?1006`): `CSI < b ; x ; y M` for press and motion,
 * `… m` for release. `params` is the raw parameter string including its
 * leading `<`, as `scanCsi` reports it.
 */
function parseSgrMouse(params: string, final: string): MouseReport | undefined {
    if (!params.startsWith("<")) return undefined;
    const fields = params.slice(1).split(";");
    if (fields.length !== 3) return undefined;
    // `isDigits` rejects an empty field, so `CSI < ; ; M` cannot decode as 0,0,0.
    if (!fields.every(isDigits)) return undefined;
    const [b, x, y] = fields.map(Number);
    if (b === undefined || x === undefined || y === undefined) return undefined;
    return build(b, x, y, final === "m");
}

/**
 * Parses the X10 form: the three raw bytes following `CSI M`, each `32 +
 * value`. There is no release final here, so `b & 3 === 3` is the release and
 * the button that was let go is unknowable — except on a wheel notch or an
 * extra button, where bit 64 or bit 128 means the low bits mean something else.
 */
function parseX10Mouse(payload: string): MouseReport | undefined {
    if (payload.length !== 3) return undefined;
    const b = payload.charCodeAt(0) - 32;
    const x = payload.charCodeAt(1) - 32;
    const y = payload.charCodeAt(2) - 32;
    // Bit 128 is excluded for the same reason `buttonOf` tests it first: an
    // extra button (8-11) is `128 + (n - 8)`, so button 11 is 131 and its low
    // two bits are the release value by coincidence, not by meaning.
    const released = (b & 3) === 3 && (b & 64) === 0 && (b & 128) === 0;
    return build(b, x, y, released);
}

export { parseSgrMouse, parseX10Mouse };
// `MouseButton` is exported for `encodeMouseForChild`'s button table, which has
// to be exhaustive over it — a partial map would silently spell a new button as
// a left click.
export type { MouseButton, MouseReport };
