import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AgentAccount, AgentLaunchOptions, AgentType } from "@taskflow/shared";
import { DEFAULT_AGENT_ACCOUNT_ID, INHERIT_AGENT_ACCOUNT } from "@taskflow/shared";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface MockAgentSettings {
    accounts: AgentAccount[];
}

interface MockSettings {
    claude: MockAgentSettings;
    codex: MockAgentSettings;
}

let settings: MockSettings = { claude: { accounts: [] }, codex: { accounts: [] } };

function useSettingsStore<T>(selector: (state: { settings: MockSettings }) => T): T {
    return selector({ settings });
}

await mock.module("@/stores/settings-store", () => ({ useSettingsStore }));

function useBackendStore<T>(selector: (state: { primaryId: string }) => T): T {
    return selector({ primaryId: "backend-1" });
}

await mock.module("@/stores/backend-store", () => ({ useBackendStore }));

await mock.module("@/hooks/useAgentAvailability", () => ({ useAgentAvailability: () => [] }));

// The per-agent option blocks render Radix selects and query backend models;
// this test only cares about the account -> launch-options mapping, so stand
// them in with inert placeholders.
await mock.module("@/components/shared/ClaudeOptions", () => ({
    ClaudeOptions: () => <div data-testid="claude-options" />,
}));
await mock.module("@/components/shared/CodexOptions", () => ({
    CodexOptions: () => <div data-testid="codex-options" />,
}));

// Same reason ProjectAgentAccountsSection.test.tsx stubs it: the real select is
// a Radix listbox that is awkward to drive from happy-dom. The buttons call
// `onChange` with exactly the values the real select can emit.
await mock.module("@/components/shared/AgentAccountSelect", () => ({
    AgentAccountSelect: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <div data-testid="account-select">
            <span>{`value: ${value}`}</span>
            <button onClick={() => onChange(INHERIT_AGENT_ACCOUNT)}>pick inherit</button>
            <button onClick={() => onChange(DEFAULT_AGENT_ACCOUNT_ID)}>
                pick built-in default
            </button>
            <button onClick={() => onChange("acc-1")}>pick acc-1</button>
        </div>
    ),
}));

const { AgentOptionsPanel } = await import("./AgentOptionsPanel");

let emitted: AgentLaunchOptions[] = [];
let container: HTMLDivElement;
let root: Root | null = null;

function mount(agentType: AgentType) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root?.render(
            <AgentOptionsPanel
                agentType={agentType}
                emitOnMount
                onChange={(options) => emitted.push(options)}
            />,
        );
    });
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

function click(label: string) {
    const found = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
    if (!found) throw new Error(`no button labelled ${label}`);
    act(() => {
        found.click();
    });
}

function lastEmitted(): AgentLaunchOptions {
    const options = emitted.at(-1);
    if (!options) throw new Error("nothing emitted");
    return options;
}

function account(options: AgentLaunchOptions): string | undefined {
    if (options.type !== "claude" && options.type !== "codex") {
        throw new Error(`${options.type} options carry no account`);
    }
    return options.account;
}

beforeEach(() => {
    unmount();
    emitted = [];
    settings = {
        claude: { accounts: [{ id: "acc-1", name: "personal", homeDir: "/homes/personal" }] },
        codex: { accounts: [{ id: "acc-1", name: "personal", homeDir: "/homes/personal" }] },
    };
});

afterAll(() => {
    unmount();
});

for (const agentType of ["claude", "codex"] as const) {
    test(`${agentType}: the inherit sentinel is never sent to the backend`, () => {
        mount(agentType);

        // The panel starts on "inherit", which is what the project level of the
        // precedence chain depends on: the field must be present and undefined,
        // never the literal "inherit".
        const onMount = lastEmitted();
        expect(onMount.type).toBe(agentType);
        expect(account(onMount)).toBeUndefined();
        expect("account" in onMount).toBe(true);

        click("pick acc-1");
        expect(account(lastEmitted())).toBe("acc-1");

        click("pick inherit");
        expect(account(lastEmitted())).toBeUndefined();
    });

    test(`${agentType}: a chosen account id is forwarded verbatim`, () => {
        mount(agentType);

        click("pick acc-1");
        expect(account(lastEmitted())).toBe("acc-1");

        click("pick built-in default");
        expect(account(lastEmitted())).toBe(DEFAULT_AGENT_ACCOUNT_ID);
    });
}

test("agents without accounts build options with no account field", () => {
    mount("pi");
    expect(container.querySelector('[data-testid="account-select"]')).toBeNull();
    expect(lastEmitted()).not.toHaveProperty("account");
});
