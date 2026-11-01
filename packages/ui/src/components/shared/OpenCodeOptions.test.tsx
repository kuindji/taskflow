import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OpenCodeOptions } from "./OpenCodeOptions";

// @ts-expect-error React test environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
});

test("each auto-approve label toggles its own switch when two editors are open", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const changes: string[] = [];
    const editor = (name: string) => (
        <OpenCodeOptions
            backendId={null}
            modelValue=""
            autoApprove={false}
            onModelChange={() => {}}
            onAutoApproveChange={(value) => changes.push(`${name}:${value}`)}
        />
    );
    const target = root;
    act(() =>
        target.render(
            <>
                {editor("first")}
                {editor("second")}
            </>,
        ),
    );

    const labels = [...container.querySelectorAll("label")].filter(
        (label) => label.textContent === "Disabled",
    );
    expect(labels).toHaveLength(2);
    act(() => labels[1]?.click());

    expect(changes).toEqual(["second:true"]);
});
