import { expect, test, beforeEach, afterAll } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AgentAccount } from "@taskflow/shared";
import { AgentAccountSelect } from "./AgentAccountSelect";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mount(props: { accounts: AgentAccount[]; value: string; inheritLabel?: string }) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <AgentAccountSelect
                label="Account"
                hint="Subscription this session runs under"
                accounts={props.accounts}
                value={props.value}
                inheritLabel={props.inheritLabel}
                onChange={() => {}}
            />,
        );
    });
}

function unmount() {
    if (!root) return;
    act(() => {
        root.unmount();
    });
    container.remove();
}

const triggerText = () =>
    container.querySelector('[data-slot="select-trigger"]')?.textContent ?? "<missing>";

beforeEach(() => {
    if (root) unmount();
});

afterAll(() => {
    if (root) unmount();
});

const accounts: AgentAccount[] = [{ id: "a1", name: "work", homeDir: "/h" }];

test("shows the inherit label when value is the inherit sentinel", () => {
    mount({ accounts, value: "inherit", inheritLabel: "Inherit (project → default)" });
    expect(triggerText()).toBe("Inherit (project → default)");
});

test("shows the account name when value matches a known account id", () => {
    mount({ accounts, value: "a1", inheritLabel: "Inherit (project → default)" });
    expect(triggerText()).toBe("work");
});

test("shows an unknown-account placeholder when value matches no account", () => {
    mount({ accounts, value: "gone", inheritLabel: "Inherit (project → default)" });
    expect(triggerText()).toBe("Unknown account (gone)");
});

test("shows the default label when value is default and no inheritLabel is given", () => {
    mount({ accounts, value: "default" });
    expect(triggerText()).toBe("Default (inherited environment)");
});
