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
 * The complete keymap. `pendingEscape` holds the first half of a double-Esc
 * in legacy mode and is always false when the kitty protocol is available.
 */
function route(
    focus: Focus,
    ev: KeyEvent,
    kittyAvailable: boolean,
    pendingEscape: boolean,
): RouteResult {
    if (ev.kind === "release") return { action: { kind: "none" }, pendingEscape };

    if (kittyAvailable) {
        if (isSwitcher(ev)) return { action: { kind: "toggle-focus" }, pendingEscape: false };
    } else if (ev.name === "escape" && !ev.mods.ctrl && !ev.mods.alt) {
        if (pendingEscape) return { action: { kind: "toggle-focus" }, pendingEscape: false };
        return { action: { kind: "none" }, pendingEscape: true };
    }

    if (focus === "session") {
        // A held Escape that turned out not to be a double-Esc still belongs to
        // the child, and must arrive before the key that followed it.
        const events = pendingEscape
            ? [{ name: "escape" as const, mods: noMods(), kind: "press" as const }, ev]
            : [ev];
        return { action: { kind: "to-child", events }, pendingEscape: false };
    }

    if (ev.name === "enter") return { action: { kind: "open" }, pendingEscape: false };

    const char = ev.char;
    if (char !== undefined && !ev.mods.ctrl && !ev.mods.alt) {
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
