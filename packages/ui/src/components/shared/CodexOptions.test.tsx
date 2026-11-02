import { afterEach, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CodexModelsResponse, CodexModelInfo, CodexSettings } from "@taskflow/shared";
import { CodexOptions } from "./CodexOptions";

// @ts-expect-error React test environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement;
function render(node: ReactNode) {
    if (!root) {
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    }
    const target = root;
    act(() => target.render(node));
}
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
});
async function flush() {
    await act(async () => {
        await Promise.resolve();
    });
}
function deferred() {
    let resolve!: (value: CodexModelsResponse) => void;
    const promise = new Promise<CodexModelsResponse>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function model(id: string, efforts: ("low" | "high" | "xhigh")[] = ["high"]): CodexModelInfo {
    return {
        id,
        model: id,
        displayName: id,
        description: "test model",
        hidden: false,
        supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
            reasoningEffort,
            description: reasoningEffort,
        })),
        defaultReasoningEffort: "high",
        inputModalities: ["text"],
        isDefault: true,
    };
}
const response = (models: CodexModelInfo[]): CodexModelsResponse => ({
    models,
    account: { state: "unknown" },
});
const noop = () => {};
const props = {
    modelValue: "same",
    reasoningEffort: "xhigh" as const,
    sandbox: "workspace-write" as const,
    approvalPolicy: "on-request" as const,
    dangerouslyBypassApprovalsAndSandbox: false,
    onModelChange: noop,
    onSandboxChange: noop,
    onApprovalPolicyChange: noop,
    onDangerouslyBypassApprovalsAndSandboxChange: noop,
};

test("a selected account's supported reasoning levels drive Codex options", async () => {
    const changed: string[] = [];
    render(
        <CodexOptions
            {...props}
            backendId="remote"
            account="work"
            loadDiscovery={async () => response([model("same", ["low", "high"])])}
            onReasoningEffortChange={(value) => changed.push(value)}
        />,
    );
    await flush();
    // Spelled out: an omitted effort would launch with the machine default.
    expect(changed).toEqual(["high"]);
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]');
    if (!trigger) throw new Error("missing reasoning picker");
    await act(() =>
        trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    await flush();
    const options = [...document.body.querySelectorAll('[role="option"]')].map(
        (option) => option.textContent,
    );
    expect(options).toContain("Low");
    expect(options).toContain("High");
    expect(options).not.toContain("Xhigh");
});

test("the machine default falls back to the model default, left unset", async () => {
    const changed: string[] = [];
    render(
        <CodexOptions
            {...props}
            mode="defaults"
            backendId="remote"
            account="work"
            loadDiscovery={async () => response([model("same", ["low", "high"])])}
            onReasoningEffortChange={(value) => changed.push(value)}
        />,
    );
    await flush();
    expect(changed).toEqual(["default"]);
});

test("a backend switch never retains the previous account's model capabilities", async () => {
    const changed: string[] = [];
    const pending = deferred();
    const load = (backend: string) =>
        backend === "a" ? Promise.resolve(response([model("same", ["high"])])) : pending.promise;
    const callback = (value: string) => changed.push(value);
    render(
        <CodexOptions
            {...props}
            backendId="a"
            loadDiscovery={load}
            reasoningEffort="default"
            onReasoningEffortChange={callback}
        />,
    );
    await flush();
    render(
        <CodexOptions
            {...props}
            backendId="b"
            loadDiscovery={load}
            onReasoningEffortChange={callback}
        />,
    );
    expect(changed).toEqual([]);
    await act(async () => pending.resolve(response([model("same", ["xhigh"])])));
    expect(changed).toEqual([]);
});

function codexSettings(overrides: Partial<CodexSettings> = {}): CodexSettings {
    return {
        defaultModel: "",
        defaultReasoningEffort: "default",
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        dangerouslyBypassApprovalsAndSandbox: false,
        accounts: [],
        defaultAccount: "default",
        ...overrides,
    };
}
const inherited = {
    ...props,
    modelValue: "",
    reasoningEffort: "default" as const,
    sandbox: "default" as const,
    approvalPolicy: "default" as const,
    dangerouslyBypassApprovalsAndSandbox: "default" as const,
    backendId: "remote",
};
function triggers() {
    return [...container.querySelectorAll('[role="combobox"]')].map((t) => t.textContent);
}
async function effortChoices() {
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]');
    if (!trigger) throw new Error("missing reasoning picker");
    await act(() =>
        trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    await flush();
    return [...document.body.querySelectorAll('[role="option"]')].map((o) => o.textContent);
}

test("session Default choices name the Settings value they launch with", async () => {
    render(
        <CodexOptions
            {...inherited}
            loadDiscovery={async () => response([model("same", ["high", "xhigh"])])}
            settings={codexSettings({
                defaultModel: "same",
                defaultReasoningEffort: "xhigh",
                sandbox: "read-only",
            })}
            onReasoningEffortChange={noop}
        />,
    );
    await flush();
    expect(container.textContent).toContain("Default (same, from Settings)");
    expect(triggers()).toEqual([
        "Default (Xhigh, from Settings)",
        "Default (Disabled, from Settings)",
        "Default (Read only, from Settings)",
        "Default (On request, from Settings)",
    ]);
});

test("session Default says the CLI decides when Settings leave it unset", async () => {
    render(
        <CodexOptions
            {...inherited}
            loadDiscovery={async () => response([model("same", ["high", "xhigh"])])}
            settings={codexSettings()}
            onReasoningEffortChange={noop}
        />,
    );
    await flush();
    expect(container.textContent).toContain("Default (Codex CLI default)");
    expect(triggers()[0]).toBe("Default (Codex CLI default)");
});

test("the Settings page keeps the model's own default label", async () => {
    render(
        <CodexOptions
            {...props}
            mode="defaults"
            backendId="remote"
            reasoningEffort="default"
            loadDiscovery={async () => response([model("same", ["high", "xhigh"])])}
            settings={codexSettings({ defaultReasoningEffort: "xhigh" })}
            onReasoningEffortChange={noop}
        />,
    );
    await flush();
    expect(triggers()[0]).toBe("Model default (high)");
    expect(container.textContent).not.toContain("from Settings");
});

test("an unset model offers the efforts of the Settings model, not the CLI default", async () => {
    render(
        <CodexOptions
            {...inherited}
            loadDiscovery={async () =>
                response([
                    model("cli", ["high", "xhigh"]),
                    { ...model("set", ["low"]), isDefault: false },
                ])
            }
            settings={codexSettings({ defaultModel: "set" })}
            onReasoningEffortChange={noop}
        />,
    );
    await flush();
    const options = await effortChoices();
    expect(options).toContain("Low");
    expect(options).not.toContain("Xhigh");
});

test("an inherited effort the model cannot run is spelled out as the model default", async () => {
    const changed: string[] = [];
    render(
        <CodexOptions
            {...inherited}
            modelValue="same"
            loadDiscovery={async () => response([model("same", ["low", "high"])])}
            settings={codexSettings({ defaultReasoningEffort: "xhigh" })}
            onReasoningEffortChange={(value) => changed.push(value)}
        />,
    );
    await flush();
    expect(changed).toEqual(["high"]);
});
