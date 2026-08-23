import { noMods, type KeyEvent } from "../input/keys";

type Focus = "sidebar" | "session";

type Action =
    | { kind: "none" }
    | { kind: "toggle-focus" }
    | { kind: "move"; delta: -1 | 1 }
    | { kind: "open" }
    | { kind: "select-tab"; index: number }
    | { kind: "zoom" }
    | { kind: "new-task" }
    | { kind: "new-session" }
    | { kind: "close-pane" }
    | { kind: "quit" }
    | { kind: "help" }
    | { kind: "to-child"; events: KeyEvent[] };

interface RouteResult {
    action: Action;
    pendingEscape: boolean;
}

const SIDEBAR_CHARS: Record<string, Action | undefined> = {
    j: { kind: "move", delta: 1 },
    k: { kind: "move", delta: -1 },
    z: { kind: "zoom" },
    n: { kind: "new-task" },
    s: { kind: "new-session" },
    q: { kind: "close-pane" },
    Q: { kind: "quit" },
    "?": { kind: "help" },
};

function isSwitcher(ev: KeyEvent): boolean {
    return ev.name === "escape" && ev.mods.ctrl;
}

/**
 * True when the key is part of a chord rather than a bare press. Shift is
 * excluded: a shifted printable arrives as its shifted character, so `Q` is
 * the quit binding rather than a modified `q`.
 */
function isChorded(ev: KeyEvent): boolean {
    return ev.mods.ctrl || ev.mods.alt || ev.mods.super;
}

/**
 * The complete keymap. `pendingEscape` holds the first half of a double-Esc
 * in legacy mode and is always false when the kitty protocol is available.
 */
function route(
    focus: Focus,
    ev: KeyEvent,
    kittyAvailable: boolean,
    pendingEscape: boolean,
): RouteResult {
    // The double-Esc switcher exists only in legacy mode, so under the kitty
    // protocol there is nothing to hold and a caller that passed one anyway
    // must not have a phantom Escape injected into the child on its behalf.
    const held = kittyAvailable ? false : pendingEscape;

    if (ev.kind === "release") return { action: { kind: "none" }, pendingEscape: held };

    if (kittyAvailable) {
        if (isSwitcher(ev)) return { action: { kind: "toggle-focus" }, pendingEscape: false };
    } else if (ev.name === "escape" && !ev.mods.ctrl && !ev.mods.alt) {
        if (held) return { action: { kind: "toggle-focus" }, pendingEscape: false };
        return { action: { kind: "none" }, pendingEscape: true };
    }

    if (focus === "session") {
        // A held Escape that turned out not to be a double-Esc still belongs to
        // the child, and must arrive before the key that followed it.
        const events = held
            ? [{ name: "escape" as const, mods: noMods(), kind: "press" as const }, ev]
            : [ev];
        return { action: { kind: "to-child", events }, pendingEscape: false };
    }

    if (ev.name === "enter" && !isChorded(ev)) {
        return { action: { kind: "open" }, pendingEscape: false };
    }

    const char = ev.char;
    if (char !== undefined && !isChorded(ev)) {
        if (char >= "1" && char <= "9") {
            return {
                action: { kind: "select-tab", index: Number.parseInt(char, 10) - 1 },
                pendingEscape: false,
            };
        }
        const mapped = SIDEBAR_CHARS[char];
        if (mapped) return { action: mapped, pendingEscape: false };
    }

    return { action: { kind: "none" }, pendingEscape: false };
}

export { route };
export type { Action, Focus };
