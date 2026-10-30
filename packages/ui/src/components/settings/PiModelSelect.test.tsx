import { afterEach, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PiModelsResponse } from "@taskflow/shared";
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
    let resolve!: (v: PiModelsResponse) => void;
    const promise = new Promise<PiModelsResponse>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}
function inventory(supportsXhigh?: boolean): PiModelsResponse {
    return {
        models: [
            {
                provider: "custom",
                id: "same",
                contextWindow: "128K",
                maxOutput: "64K",
                supportsThinking: true,
                supportsImages: true,
                supportsXhigh,
            },
        ],
        defaultModel: "custom/same",
    };
}

import { PiModelSelect } from "./PiModelSelect";
test("Pi inventory loads before the model popover opens", async () => {
    const calls: string[] = [];
    const responses: PiModelsResponse[] = [];
    render(
        <PiModelSelect
            backendId="remote"
            value=""
            onChange={() => {}}
            loadModels={async (id) => {
                calls.push(id);
                return inventory(true);
            }}
            onModelsChange={(r) => responses.push(r)}
        />,
    );
    await flush();
    expect(calls).toEqual(["remote"]);
    expect(responses.at(-1)).toEqual(inventory(true));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
});
test("Pi picker ignores a late backend reply and preserves custom entry and badges", async () => {
    const a = deferred(),
        b = deferred();
    const received: PiModelsResponse[] = [];
    const changed: string[] = [];
    const load = (id: string) => (id === "a" ? a.promise : b.promise);
    const report = (r: PiModelsResponse) => received.push(r);
    render(
        <PiModelSelect
            backendId="a"
            value="saved/custom"
            onChange={(v) => changed.push(v)}
            loadModels={load}
            onModelsChange={report}
        />,
    );
    render(
        <PiModelSelect
            backendId="b"
            value="saved/custom"
            onChange={(v) => changed.push(v)}
            loadModels={load}
            onModelsChange={report}
        />,
    );
    await act(async () => a.resolve(inventory(true)));
    expect(received).toEqual([]);
    await act(async () => b.resolve(inventory(false)));
    expect(received).toEqual([inventory(false)]);
    expect(container.textContent).toContain("saved/custom");
    const button = container.querySelector("button");
    if (!button) throw new Error("missing picker");
    act(() => button.click());
    await flush();
    expect(document.body.textContent).toContain("128K ctx · thinking · images");
    const input = document.body.querySelector<HTMLInputElement>(
        'input[placeholder="Search models... (Enter for custom)"]',
    );
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!input || !setValue) throw new Error("missing model input");
    act(() => {
        setValue.call(input, "custom/new");
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(changed).toEqual(["custom/new"]);
});
