import { afterEach, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CodexModelsResponse, CodexModelsPayload, CodexModelInfo } from "@taskflow/shared";
import { CodexModelSelect } from "./CodexModelSelect";

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

test("switching Codex accounts clears models and ignores the old reply", async () => {
    const first = deferred();
    const second = deferred();
    const calls: CodexModelsPayload[] = [];
    const inventories: CodexModelInfo[][] = [];
    const load = (_backend: string, payload: CodexModelsPayload) => {
        calls.push(payload);
        return calls.length === 1 ? first.promise : second.promise;
    };
    const changed = (models: CodexModelInfo[]) => inventories.push(models);
    const node = (account: string) => (
        <CodexModelSelect
            backendId="remote"
            account={account}
            value=""
            onChange={noop}
            onModelsChange={changed}
            loadDiscovery={load}
        />
    );
    render(node("a"));
    render(node("b"));
    expect(calls).toEqual([{ account: "a" }, { account: "b" }]);
    expect(inventories).toEqual([[], []]);
    await act(async () => {
        second.resolve(response([model("B")]));
    });
    await act(async () => {
        first.resolve(response([model("OLD")]));
    });
    expect(container.textContent).toContain("B");
    expect(container.textContent).not.toContain("OLD");
    expect(inventories.at(-1)?.[0]?.id).toBe("B");
});

test("Codex custom model entry and empty-inventory fallback remain available", async () => {
    const changes: string[] = [];
    const load = async () => response([model("known")]);
    render(
        <CodexModelSelect
            backendId="remote"
            account="inherit"
            value="saved-missing"
            onChange={(value) => changes.push(value)}
            onModelsChange={noop}
            loadDiscovery={load}
        />,
    );
    await flush();
    expect(container.textContent).toContain("saved-missing");
    const trigger = container.querySelector("button");
    if (!trigger) throw new Error("missing model picker");
    act(() => trigger.click());
    const search = document.body.querySelector<HTMLInputElement>(
        'input[placeholder="Search models... (Enter for custom)"]',
    );
    if (!search) throw new Error("missing custom model input");
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
            search,
            "my-custom",
        );
        search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() =>
        search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(changes).toEqual(["my-custom"]);
    render(
        <CodexModelSelect
            backendId="remote"
            account="b"
            value="saved-missing"
            onChange={(value) => changes.push(value)}
            onModelsChange={noop}
            loadDiscovery={async () => response([])}
        />,
    );
    await flush();
    const input = container.querySelector<HTMLInputElement>('input[placeholder="Codex default"]');
    if (!input) throw new Error("missing fallback input");
    expect(input.value).toBe("saved-missing");
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
            input,
            "fallback",
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(changes.at(-1)).toBe("fallback");
});
