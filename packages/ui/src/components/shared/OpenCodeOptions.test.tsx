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

test("each auto-approve label toggles its own Settings switch when two editors are open", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const changes: string[] = [];
    const editor = (name: string) => (
        <OpenCodeOptions
            mode="defaults"
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

test("only a session that inherits from Settings labels the unset model with them", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const options = (headless: boolean) => (
        <OpenCodeOptions
            backendId={null}
            headless={headless}
            settings={{ defaultModel: "anthropic/sonnet", autoApprove: true }}
            modelValue=""
            autoApprove="default"
            onModelChange={() => {}}
            onAutoApproveChange={() => {}}
        />
    );
    const target = root;
    act(() => target.render(options(false)));
    expect(container.textContent).toContain("Default (anthropic/sonnet, from Settings)");
    expect(container.textContent).toContain("Default (Enabled, from Settings)");

    act(() => target.render(options(true)));
    expect(container.textContent).not.toContain("from Settings");
    expect(container.textContent).toContain("Select model...");
});
