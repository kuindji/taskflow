import { afterEach, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CodexModelsResponse, CodexModelInfo } from "@taskflow/shared";
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
    expect(changed).toEqual(["default"]);
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
