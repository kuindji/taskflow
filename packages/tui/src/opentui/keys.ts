import type { KeyEvent } from "@opentui/core";

type FocusTarget = "ui" | "session";

type UiCommand =
    | { kind: "move"; delta: -1 | 1 }
    | { kind: "open" }
    | { kind: "select-tab"; index: number }
    | { kind: "zoom" }
    | { kind: "quit" }
    | { kind: "create" }
    | { kind: "close" }
    | { kind: "resume" }
    | { kind: "flows" }
    | { kind: "schedules" }
    | { kind: "task-detail" }
    | { kind: "task-create" }
    | { kind: "git" }
    | { kind: "settings" }
    | { kind: "notifications" }
    | { kind: "deferred" };

type KeyRoute =
    | { kind: "pass"; before?: KeyEvent }
    | { kind: "hold-escape" }
    | { kind: "switch-focus" }
    | { kind: "command"; command: UiCommand; before?: KeyEvent }
    | { kind: "consume" };

const NAMED_PHYSICAL_KEYS: Readonly<Record<string, string>> = {
    backspace: "Backspace",
    delete: "Delete",
    down: "ArrowDown",
    end: "End",
    enter: "Enter",
    escape: "Escape",
    home: "Home",
    insert: "Insert",
    left: "ArrowLeft",
    pagedown: "PageDown",
    pageup: "PageUp",
    return: "Enter",
    right: "ArrowRight",
    space: "Space",
    tab: "Tab",
    up: "ArrowUp",
};

function isExactCtrlEscape(event: KeyEvent): boolean {
    return (
        event.source === "kitty" &&
        event.name === "escape" &&
        event.ctrl &&
        !event.meta &&
        !event.option &&
        !event.shift &&
        !event.super &&
        !event.hyper
    );
}

function isRawBareEscape(event: KeyEvent): boolean {
    return (
        event.source === "raw" &&
        event.name === "escape" &&
        !event.ctrl &&
        !event.meta &&
        !event.option &&
        !event.shift &&
        !event.super &&
        !event.hyper
    );
}

class KeyRouter {
    private heldEscape: KeyEvent | null = null;

    route(focus: FocusTarget, event: KeyEvent): KeyRoute {
        if (isExactCtrlEscape(event)) {
            if (event.eventType === "press" && event.repeated !== true) {
                this.heldEscape = null;
                return { kind: "switch-focus" };
            }
            return { kind: "consume" };
        }

        const before = this.heldEscape ?? undefined;
        this.heldEscape = null;
        if (isRawBareEscape(event) && event.eventType === "press") {
            if (before !== undefined) return { kind: "switch-focus" };
            this.heldEscape = event;
            return { kind: "hold-escape" };
        }

        if (focus === "session") return { kind: "pass", before };

        if (event.eventType !== "press") return before ? { kind: "consume" } : { kind: "pass" };
        const chorded = event.ctrl || event.meta || event.option || event.super || event.hyper;
        if (!chorded && !event.shift && (event.name === "down" || event.name === "j")) {
            return { kind: "command", command: { kind: "move", delta: 1 }, before };
        }
        if (!chorded && !event.shift && (event.name === "up" || event.name === "k")) {
            return { kind: "command", command: { kind: "move", delta: -1 }, before };
        }
        if (!chorded && !event.shift && (event.name === "return" || event.name === "enter")) {
            return { kind: "command", command: { kind: "open" }, before };
        }
        const text = event.sequence.length === 1 ? event.sequence : "";
        if (!chorded && text >= "1" && text <= "9") {
            return {
                kind: "command",
                command: { kind: "select-tab", index: Number.parseInt(text, 10) - 1 },
                before,
            };
        }
        if (!chorded && text === "z") {
            return { kind: "command", command: { kind: "zoom" }, before };
        }
        if (!chorded && text === "l") {
            return { kind: "command", command: { kind: "open" }, before };
        }
        if (!chorded && text === "Q") {
            return { kind: "command", command: { kind: "quit" }, before };
        }
        if (!chorded && text === "s") {
            return { kind: "command", command: { kind: "create" }, before };
        }
        if (!chorded && text === "q") {
            return { kind: "command", command: { kind: "close" }, before };
        }
        if (!chorded && text === "r") {
            return { kind: "command", command: { kind: "resume" }, before };
        }
        if (!chorded && text === "f") {
            return { kind: "command", command: { kind: "flows" }, before };
        }
        if (!chorded && text === "c") {
            return { kind: "command", command: { kind: "schedules" }, before };
        }
        if (!chorded && text === "t") {
            return { kind: "command", command: { kind: "task-detail" }, before };
        }
        if (!chorded && text === "n") {
            return { kind: "command", command: { kind: "task-create" }, before };
        }
        if (!chorded && text === "g") {
            return { kind: "command", command: { kind: "git" }, before };
        }
        if (!chorded && text === ",") {
            return { kind: "command", command: { kind: "settings" }, before };
        }
        if (!chorded && text === "!") {
            return { kind: "command", command: { kind: "notifications" }, before };
        }
        if (!chorded && text === "?") {
            return { kind: "command", command: { kind: "deferred" }, before };
        }
        return before ? { kind: "consume" } : { kind: "pass" };
    }

    takeHeldEscape(): KeyEvent | null {
        const held = this.heldEscape;
        this.heldEscape = null;
        return held;
    }

    clear(): void {
        this.heldEscape = null;
    }
}

/**
 * OpenTUI 0.5.7 exposes raw and Kitty escape tokens in `code`, while its
 * embedded terminal expects a physical-key name. Normalize that public event
 * shape and leave byte encoding to EmbeddedTerminalRenderable.
 */
function prepareForEmbeddedTerminal(event: KeyEvent): KeyEvent {
    const modified = event.ctrl || event.meta || event.option || event.super || event.hyper;
    const printable = Array.from(event.name).length === 1 && !modified;
    if (printable) {
        // OpenTUI already decoded the text, including Shift and the active keyboard layout.
        event.code = undefined;
        return event;
    }

    const named = NAMED_PHYSICAL_KEYS[event.name.toLowerCase()];
    if (named) event.code = named;
    else if (/^[a-z]$/i.test(event.name)) event.code = `Key${event.name.toUpperCase()}`;
    else if (/^[0-9]$/.test(event.name)) event.code = `Digit${event.name}`;
    else event.code = undefined;

    if (event.source === "kitty") event.sequence = "";
    return event;
}

export { KeyRouter, prepareForEmbeddedTerminal };
export type { FocusTarget, KeyRoute, UiCommand };
