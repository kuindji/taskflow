import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingInput } from "./SettingInput";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;
let sent: string[] = [];

function render(value: string) {
    if (!root) {
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    }
    const target = root;
    act(() =>
        target.render(
            <SettingInput
                id="setting"
                value={value}
                onChange={(event) => sent.push(event.target.value)}
            />,
        ),
    );
}

function input(): HTMLInputElement {
    const found = container.querySelector<HTMLInputElement>("#setting");
    if (!found) throw new Error("no input");
    return found;
}

function type(text: string) {
    act(() => {
        // React 19 installs its own value setter; go through the native one so
        // the synthetic change event carries the new value.
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input(), text);
        input().dispatchEvent(new Event("input", { bubbles: true }));
    });
}

afterEach(() => {
    if (root) {
        const current = root;
        act(() => current.unmount());
        root = null;
        container.remove();
    }
    sent = [];
});

test("keystrokes typed before the saved value comes back are kept", () => {
    render("");
    // The saved value stays "" while each save is in flight.
    type("w");
    type("wo");
    type("wor");
    expect(input().value).toBe("wor");
    expect(sent).toEqual(["w", "wo", "wor"]);
});

test("on blur it shows the saved value again", () => {
    render("");
    type("work");
    render("work-saved");
    expect(input().value).toBe("work");
    act(() => {
        input().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(input().value).toBe("work-saved");
});

test("an untouched input follows the saved value", () => {
    render("a");
    render("b");
    expect(input().value).toBe("b");
});
