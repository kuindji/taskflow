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

/** OpenTUI's `InputRenderable` default: longer values are cut on load. */
const LINE_INPUT_MAX_LENGTH = 1000;

/**
 * Whether a stored value survives a round trip through a single-line input,
 * which drops line breaks and cuts the value at `LINE_INPUT_MAX_LENGTH`.
 */
function fitsLineInput(value: string): boolean {
    return value.length <= LINE_INPUT_MAX_LENGTH && !/[\n\r]/.test(value);
}

export { editLine, fitsLineInput, isChorded };
