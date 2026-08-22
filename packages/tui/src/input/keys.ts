interface KeyMods {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    super: boolean;
}

type KeyName =
    | "char"
    | "enter"
    | "escape"
    | "tab"
    | "backspace"
    | "space"
    | "up"
    | "down"
    | "left"
    | "right"
    | "home"
    | "end"
    | "pageup"
    | "pagedown"
    | "delete"
    | "insert";

interface KeyEvent {
    name: KeyName;
    char?: string;
    mods: KeyMods;
    kind: "press" | "repeat" | "release";
}

function noMods(): KeyMods {
    return { ctrl: false, alt: false, shift: false, super: false };
}

/**
 * Decodes an xterm modifier parameter (1 + bitmask) into KeyMods. Anything
 * below 1 — a malformed `CSI 1;0 C`, or a parameter that failed to parse — has
 * no bitmask to read, so it means no modifiers rather than `-1`, which would
 * report every modifier as held.
 */
function modsFromParam(param: number): KeyMods {
    const bits = param >= 1 ? param - 1 : 0;
    return {
        shift: (bits & 1) !== 0,
        alt: (bits & 2) !== 0,
        ctrl: (bits & 4) !== 0,
        super: (bits & 8) !== 0,
    };
}

export { noMods, modsFromParam };
export type { KeyEvent, KeyMods, KeyName };
