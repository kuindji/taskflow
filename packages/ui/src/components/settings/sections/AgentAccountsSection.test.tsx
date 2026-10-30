import { afterAll, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AgentAccount } from "@taskflow/shared";
import { AgentAccountsSection } from "./AgentAccountsSection";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Ids come from `crypto.randomUUID()` inside the component, so pin them to
// make the committed objects assertable. `defineProperty` shadows the real
// method on the happy-dom `crypto` instance for the whole file.
let nextIds: string[] = [];
const realRandomUUID = Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID");
Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: () => nextIds.shift() ?? "unstubbed-id",
});

type Patch = { accounts?: AgentAccount[]; defaultAccount?: string };

let patches: Patch[] = [];
let rejectWith: Error | null = null;

function onUpdate(patch: Patch): Promise<void> {
    patches.push(patch);
    return rejectWith ? Promise.reject(rejectWith) : Promise.resolve();
}

let container: HTMLDivElement;
let root: Root | null = null;

function render(target: Root, accounts: AgentAccount[], defaultAccount: string) {
    act(() => {
        target.render(
            <AgentAccountsSection
                agent="claude"
                accounts={accounts}
                defaultAccount={defaultAccount}
                onUpdate={onUpdate}
            />,
        );
    });
}

function mount(accounts: AgentAccount[], defaultAccount = "default") {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    render(root, accounts, defaultAccount);
}

/**
 * Re-renders with a new `accounts` array instance, which is what the app does
 * after every successful save: the backend replies with the whole settings
 * object and the store publishes a fresh one, so this section's `accounts`
 * prop is a new array even when a sibling section did the saving.
 */
function rerender(accounts: AgentAccount[], defaultAccount = "default") {
    if (!root) throw new Error("not mounted");
    render(root, accounts, defaultAccount);
}

function unmount() {
    if (!root) return;
    const current = root;
    act(() => {
        current.unmount();
    });
    root = null;
    container.remove();
}

function click(el: Element | null | undefined) {
    if (!el) throw new Error("no element to click");
    act(() => {
        (el as HTMLElement).click();
    });
}

function button(label: string): HTMLButtonElement {
    const found = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!found) throw new Error(`no button labelled ${label}`);
    return found;
}

function addButton(): HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "Add account",
    );
    if (!found) throw new Error("no Add account button");
    return found;
}

function input(id: string): HTMLInputElement {
    const found = container.querySelector<HTMLInputElement>(`#${id}`);
    if (!found) throw new Error(`no input ${id}`);
    return found;
}

function typeInto(id: string, text: string) {
    const el = input(id);
    act(() => {
        // React 19 installs its own value setter; go through the native one so
        // the synthetic change event carries the new value.
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(el, text);
        el.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function blur(id: string) {
    const el = input(id);
    act(() => {
        el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
}

const text = () => document.body.textContent ?? "";

beforeEach(() => {
    unmount();
    patches = [];
    rejectWith = null;
    nextIds = ["new-id", "new-id-2"];
});

afterAll(() => {
    unmount();
    // A whole `bun test` run shares one process, so put the real generator
    // back rather than handing "unstubbed-id" to other modules.
    if (realRandomUUID) {
        Object.defineProperty(globalThis.crypto, "randomUUID", realRandomUUID);
    } else {
        // It was inherited from Crypto.prototype; dropping the own property
        // exposes the prototype method again.
        Reflect.deleteProperty(globalThis.crypto, "randomUUID");
    }
});

const a1: AgentAccount = { id: "a1", name: "personal", homeDir: "/home/personal" };
const a2: AgentAccount = { id: "a2", name: "work", homeDir: "/home/work" };

test("Add account only adds a local draft row; it is saved on blur once name and home dir are filled", () => {
    mount([]);

    click(addButton());
    // An empty homeDir fails backend validation, so nothing may be sent yet.
    expect(patches).toEqual([]);
    expect(input("claude-account-name-new-id").value).toBe("account 1");
    expect(input("claude-account-home-new-id").value).toBe("");

    typeInto("claude-account-name-new-id", "work");
    typeInto("claude-account-home-new-id", "/h");
    expect(patches).toEqual([]);

    blur("claude-account-home-new-id");
    expect(patches).toEqual([{ accounts: [{ id: "new-id", name: "work", homeDir: "/h" }] }]);
});

test("an incomplete draft is left out of what is sent", () => {
    mount([]);

    click(addButton());
    click(addButton());
    // Only the second row is completed; the first keeps an empty home dir.
    typeInto("claude-account-name-new-id-2", "work");
    typeInto("claude-account-home-new-id-2", "/h");
    blur("claude-account-name-new-id-2");

    expect(patches).toEqual([{ accounts: [{ id: "new-id-2", name: "work", homeDir: "/h" }] }]);

    // The save round-trips: the store publishes fresh settings, so this
    // section is re-rendered with the saved accounts only.
    rerender([{ id: "new-id-2", name: "work", homeDir: "/h" }]);

    // The incomplete row stays on screen so it can still be filled in, and the
    // saved row is still there once.
    expect(input("claude-account-name-new-id").value).toBe("account 1");
    expect(input("claude-account-name-new-id-2").value).toBe("work");
});

test("deleting a non-default account commits the remaining accounts once confirmed", () => {
    mount([a1, a2], "a1");

    click(button("Delete account work"));
    expect(patches).toEqual([]);
    expect(text()).toContain('Delete account "work"?');

    const confirmButton = [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent === "Delete",
    );
    click(confirmButton);

    expect(patches).toEqual([{ accounts: [a1] }]);
});

test("the account that is the global default cannot be deleted", () => {
    mount([a1, a2], "a1");

    const disabled = button("Delete account personal");
    expect(disabled.disabled).toBe(true);
    expect(disabled.getAttribute("title")).toBe("Choose another default account first");
    expect(button("Delete account work").disabled).toBe(false);
});

test("a rejected update shows the backend's message", async () => {
    mount([]);
    rejectWith = new Error("bad path");

    click(addButton());
    typeInto("claude-account-name-new-id", "work");
    typeInto("claude-account-home-new-id", "/h");
    blur("claude-account-home-new-id");

    await act(async () => {
        await Promise.resolve();
    });

    expect(text()).toContain("bad path");
});

function discoveryMount(
    agent: "codex" | "claude",
    accounts: AgentAccount[],
    loadDiscovery: (
        backend: string,
        payload: import("@taskflow/shared").CodexModelsPayload,
    ) => Promise<import("@taskflow/shared").CodexModelsResponse>,
) {
    if (!root) {
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    }
    const target = root;
    act(() =>
        target.render(
            <AgentAccountsSection
                agent={agent}
                backendId="remote"
                accounts={accounts}
                defaultAccount="default"
                onUpdate={onUpdate}
                loadDiscovery={loadDiscovery}
            />,
        ),
    );
}

async function settleDiscovery() {
    await act(async () => {
        await Promise.resolve();
    });
}

test("each saved Codex account and built-in default shows its own sign-in status", async () => {
    const calls: string[] = [];
    discoveryMount("codex", [a1, a2], async (backend, payload) => {
        expect(backend).toBe("remote");
        calls.push(payload.account ?? "inherit");
        return {
            models: [],
            account:
                payload.account === "a1"
                    ? { state: "signed-in", label: "person@example.com" }
                    : payload.account === "a2"
                      ? { state: "signed-out" }
                      : { state: "signed-in", label: "API key" },
        };
    });
    expect(text()).toContain("Checking sign-in...");
    await settleDiscovery();
    expect(calls.sort()).toEqual(["a1", "a2", "default"]);
    expect(text()).toContain("Default account");
    expect(text()).toContain("signed in as API key");
    expect(text()).toContain("signed in as person@example.com");
    expect(text()).toContain("not signed in");
});

test("a failed account probe shows Sign-in status unavailable", async () => {
    discoveryMount("codex", [a1], async () => {
        throw new Error("offline");
    });
    await settleDiscovery();
    expect(text()).toContain("Sign-in status unavailable");
    expect(text()).not.toContain("not signed in");
});

test("incomplete account drafts are not probed before save", async () => {
    const calls: string[] = [];
    const load = async (
        _backend: string,
        payload: import("@taskflow/shared").CodexModelsPayload,
    ): Promise<import("@taskflow/shared").CodexModelsResponse> => {
        calls.push(payload.account ?? "inherit");
        return { models: [], account: { state: "unknown" } };
    };
    discoveryMount("codex", [], load);
    await settleDiscovery();
    click(addButton());
    typeInto("codex-account-home-new-id", "/new");
    expect(calls).toEqual(["default"]);
    blur("codex-account-home-new-id");
    await settleDiscovery();
    expect(calls).toEqual(["default"]);
    const saved = patches[0].accounts;
    if (!saved) throw new Error("missing saved accounts");
    discoveryMount("codex", saved, load);
    await settleDiscovery();
    expect(calls).toEqual(["default", "new-id"]);
});

test("Claude account editing does not start a Codex probe", async () => {
    let calls = 0;
    discoveryMount("claude", [a1], async () => {
        calls++;
        return { models: [], account: { state: "unknown" } };
    });
    typeInto("claude-account-home-a1", "/changed");
    blur("claude-account-home-a1");
    await settleDiscovery();
    expect(calls).toBe(0);
    expect(text()).not.toContain("Checking sign-in...");
});

test("changing a saved Codex home refetches its models and diagnostics", async () => {
    let calls = 0;
    const replies: ((value: import("@taskflow/shared").CodexModelsResponse) => void)[] = [];
    const load = (
        _backend: string,
        payload: import("@taskflow/shared").CodexModelsPayload,
    ): Promise<import("@taskflow/shared").CodexModelsResponse> => {
        if (payload.account === "default")
            return Promise.resolve({ models: [], account: { state: "unknown" } });
        calls++;
        return new Promise((resolve) => replies.push(resolve));
    };
    discoveryMount("codex", [a1], load);
    typeInto("codex-account-home-a1", "/changed");
    blur("codex-account-home-a1");
    expect(calls).toBe(1);
    discoveryMount("codex", [{ ...a1, homeDir: "/changed" }], load);
    expect(calls).toBe(2);
    await act(async () =>
        replies[1]({ models: [], account: { state: "signed-in", label: "new" } }),
    );
    await act(async () =>
        replies[0]({ models: [], account: { state: "signed-in", label: "old" } }),
    );
    expect(text()).toContain("signed in as new");
    expect(text()).not.toContain("signed in as old");
});
