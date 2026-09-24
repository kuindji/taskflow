import { afterAll, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ClaudeOptions } from "./ClaudeOptions";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(headless: boolean) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root?.render(
            <ClaudeOptions
                modelValue="default"
                effortValue="default"
                permissionMode="default"
                onModelChange={() => {}}
                onEffortChange={() => {}}
                onPermissionModeChange={() => {}}
                headless={headless}
            />,
        );
    });
}

function cleanup() {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
}

beforeEach(cleanup);
afterAll(cleanup);

test("headless hides the permission mode row", () => {
    render(true);
    expect(container?.textContent).toContain("Model");
    expect(container?.textContent).not.toContain("Permission Mode");
});

test("session mode shows the permission mode row", () => {
    render(false);
    expect(container?.textContent).toContain("Permission Mode");
});
