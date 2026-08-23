import { noMods, type KeyEvent, type KeyName } from "../input/keys";
import type { MouseReport } from "../input/mouse";
import type { Layout } from "./layout";
import { tabSpans, type TabSpec } from "./session-pane";

type Focus = "sidebar" | "session";

type Action =
    | { kind: "none" }
    | { kind: "toggle-focus" }
    | { kind: "move"; delta: -1 | 1 }
    | { kind: "open" }
    | { kind: "select"; index: number }
    | { kind: "select-tab"; index: number }
    | { kind: "open-tab"; index: number }
    | { kind: "scroll"; delta: number }
    | { kind: "focus"; target: Focus }
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

/**
 * Arrows alias `j`/`k`, which is what a hand reaches for before it learns the
 * vim keys. Left and right are deliberately absent: the spec gives `h`/`l` the
 * job of moving between the sidebar and the main area, and neither exists yet,
 * so binding the arrows to it would be binding them to nothing.
 */
const SIDEBAR_KEYS: Partial<Record<KeyName, Action>> = {
    down: { kind: "move", delta: 1 },
    up: { kind: "move", delta: -1 },
};

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

/**
 * The focus switch under the kitty protocol is exactly `Ctrl+Escape`. Any
 * further modifier makes it a different chord, which belongs to the child:
 * `Ctrl+Alt+Escape` reaches us as `CSI 27;7u` and must not be swallowed.
 */
function isSwitcher(ev: KeyEvent): boolean {
    return ev.name === "escape" && ev.mods.ctrl && !ev.mods.alt && !ev.mods.super && !ev.mods.shift;
}

/**
 * A bare Escape press — the half of a legacy double-Esc. Shift counts here,
 * unlike on a printable, because Escape has no shifted character to arrive as.
 */
function isBareEscape(ev: KeyEvent): boolean {
    return (
        ev.name === "escape" && !ev.mods.ctrl && !ev.mods.alt && !ev.mods.super && !ev.mods.shift
    );
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
    } else if (isBareEscape(ev)) {
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

    if (!isChorded(ev)) {
        // Keyed by name, so it is reached before the char map: an arrow carries
        // no `char` at all and would otherwise fall through to "none".
        const named = SIDEBAR_KEYS[ev.name];
        if (named) return { action: named, pendingEscape: false };
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

/** How far one wheel notch moves a scrollback view. */
const WHEEL_LINES = 3;

/**
 * What a mouse report means to the UI, and nothing more: whether it should
 * instead go to a child depends on that child's modes, which live in `App`.
 *
 * Pure, and given the layout the frame was drawn with rather than reading any
 * geometry itself, so the strip that was painted and the strip that is clicked
 * are the same numbers.
 */
function routeMouse(
    report: MouseReport,
    layout: Layout,
    ctx: { rows: number; tabs: TabSpec[] },
): Action {
    const { col, row, button } = report;
    const pressed = report.action === "press" || report.action === "drag";

    // The sidebar is tested first: `drawSidebar` paints its first list row on
    // row 0, so a click there selects that row rather than falling into the
    // tab strip, which only ever writes from `paneX` rightwards.
    if (layout.sidebarWidth > 0 && col < layout.sidebarWidth) {
        if (button === "wheel-down") return { kind: "move", delta: 1 };
        if (button === "wheel-up") return { kind: "move", delta: -1 };
        if (button === "left" && pressed && row < ctx.rows) return { kind: "select", index: row };
        return { kind: "none" };
    }

    if (row === layout.tabRow) {
        if (button !== "left" || report.action !== "press") return { kind: "none" };
        const x = col - layout.paneX;
        const index = tabSpans(layout.paneWidth, ctx.tabs).findIndex(
            (span) => x >= span.start && x < span.end,
        );
        return index === -1 ? { kind: "none" } : { kind: "open-tab", index };
    }

    const inPane =
        col >= layout.paneX &&
        col < layout.paneX + layout.paneWidth &&
        row >= layout.paneY &&
        row < layout.paneY + layout.paneHeight;
    if (inPane) {
        if (button === "wheel-up") return { kind: "scroll", delta: -WHEEL_LINES };
        if (button === "wheel-down") return { kind: "scroll", delta: WHEEL_LINES };
        if (button === "left" && report.action === "press") {
            return { kind: "focus", target: "session" };
        }
    }
    return { kind: "none" };
}

export { route, routeMouse };
export type { Action, Focus };
