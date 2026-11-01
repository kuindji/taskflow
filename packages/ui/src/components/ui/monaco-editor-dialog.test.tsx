import { expect, test, beforeEach, afterEach, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The expanded editor of a task field stays open while an agent or another
 * client updates that field. Closing it untouched must not write the text it
 * opened with back over the newer value; closing it edited still reports the
 * edit.
 */

let editorText = "";
await mock.module("monaco-editor", () => ({
    editor: {
        defineTheme: () => {},
        create: (_node: HTMLElement, options: { value: string }) => {
            editorText = options.value;
            return {
                getValue: () => editorText,
                focus: () => {},
                dispose: () => {},
            };
        },
    },
}));

const { MonacoEditorDialog } = await import("./monaco-editor-dialog");

let container: HTMLDivElement;
let root: Root;
let closed: string[];

function render(value: string, open: boolean) {
    act(() => {
        root.render(
            <MonacoEditorDialog
                open={open}
                onOpenChange={() => {}}
                value={value}
                onClose={(next) => closed.push(next)}
            />,
        );
    });
}

function clickClose() {
    const button = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "Close",
    );
    if (!button) throw new Error("close button not rendered");
    act(() => {
        button.click();
    });
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    closed = [];
    editorText = "";
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

test("closing untouched after the value changed reports nothing", () => {
    render("Original description", true);
    expect(editorText).toBe("Original description");
    render("Agent updated description", true);
    clickClose();
    expect(closed).toEqual([]);
});

test("closing after an edit reports the edited text", () => {
    render("Original description", true);
    editorText = "User edit";
    clickClose();
    expect(closed).toEqual(["User edit"]);
});
