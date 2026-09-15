import type { InputRenderable, KeyEvent } from "@opentui/core";

type LineKey = "submit" | "cancel" | "edit" | "ignore";

function isChorded(event: KeyEvent): boolean {
    return Boolean(event.ctrl || event.meta || event.option || event.super || event.hyper);
}

/**
 * The editing every single-line prompt shares: Escape cancels, Enter submits,
 * and any other unchorded key press edits the input.
 */
function editLine(input: InputRenderable, event: KeyEvent): LineKey {
    if (event.eventType !== "press" || isChorded(event)) return "ignore";
    if (event.name === "escape") return "cancel";
    if (event.name === "return" || event.name === "enter") return "submit";
    input.handleKeyPress(event);
    return "edit";
}

export { editLine, isChorded };
