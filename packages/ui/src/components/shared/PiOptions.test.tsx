import { afterEach, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PiModelsResponse, PiThinkingLevel } from "@taskflow/shared";
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

import { PiOptions } from "./PiOptions";
const noop = () => {};
const props = {
    backendId: "a",
    modelValue: "custom/same",
    thinkingValue: "xhigh" as PiThinkingLevel,
    toolsValue: "read,bash",
    onModelChange: noop,
    onToolsChange: noop,
};
async function choices() {
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]');
    if (!trigger) throw new Error("missing thinking picker");
    act(() => {
        trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    await flush();
    return [...document.body.querySelectorAll('[role="option"]')].map((o) => o.textContent);
}
test("Pi offers Xhigh only for the selected model with declared support", async () => {
    render(
        <PiOptions {...props} loadModels={async () => inventory(true)} onThinkingChange={noop} />,
    );
    await flush();
    expect(await choices()).toContain("Xhigh");
});
test("Pi shows and emits High for a saved unsupported xhigh", async () => {
    const pending = deferred();
    const changed: string[] = [];
    render(
        <PiOptions
            {...props}
            loadModels={() => pending.promise}
            onThinkingChange={(v) => changed.push(v)}
        />,
    );
    expect(container.querySelector('[role="combobox"]')?.textContent).toContain("High");
    expect(changed).toEqual([]);
    await act(async () => pending.resolve(inventory(false)));
    expect(changed).toEqual(["high"]);
    expect(await choices()).not.toContain("Xhigh");
});
test("Pi loading does not overwrite a saved xhigh that discovery proves supported", async () => {
    const pending = deferred();
    const changed: string[] = [];
    render(
        <PiOptions
            {...props}
            loadModels={() => pending.promise}
            onThinkingChange={(v) => changed.push(v)}
        />,
    );
    expect(changed).toEqual([]);
    await act(async () => pending.resolve(inventory(true)));
    expect(container.querySelector('[role="combobox"]')?.textContent).toContain("Xhigh");
    expect(changed).toEqual([]);
});
test("Pi default-model capability comes from the discovery response", async () => {
    render(
        <PiOptions
            {...props}
            modelValue=""
            loadModels={async () => inventory(true)}
            onThinkingChange={noop}
        />,
    );
    await flush();
    expect(await choices()).toContain("Xhigh");
});
test("Pi missing metadata and a late backend reply cannot enable Xhigh", async () => {
    const a = deferred(),
        b = deferred();
    const load = (id: string) => (id === "a" ? a.promise : b.promise);
    const changed: string[] = [];
    const callback = (v: PiThinkingLevel) => changed.push(v);
    render(<PiOptions {...props} loadModels={load} onThinkingChange={callback} />);
    render(<PiOptions {...props} backendId="b" loadModels={load} onThinkingChange={callback} />);
    await act(async () => a.resolve(inventory(true)));
    expect(changed).toEqual([]);
    await act(async () => b.resolve(inventory()));
    expect(changed).toEqual(["high"]);
    expect(await choices()).not.toContain("Xhigh");
});
test("Pi model changes normalize thinking while preserving tools and custom input", async () => {
    const changed: string[] = [];
    const tools: string[] = [];
    const load = async () => inventory(true);
    const callback = (v: PiThinkingLevel) => changed.push(v);
    render(
        <PiOptions
            {...props}
            loadModels={load}
            onThinkingChange={callback}
            onToolsChange={(v) => tools.push(v)}
        />,
    );
    await flush();
    render(
        <PiOptions
            {...props}
            modelValue="shorthand"
            loadModels={load}
            onThinkingChange={callback}
            onToolsChange={(v) => tools.push(v)}
        />,
    );
    await flush();
    expect(changed).toEqual(["high"]);
    expect(tools).toEqual([]);
    expect(
        container.querySelector<HTMLInputElement>(
            'input[placeholder="read,bash,edit,write,grep,find,ls"]',
        )?.value,
    ).toBe("read,bash");
    expect(container.textContent).toContain("shorthand");
});
test("Pi discovery failure shows and emits high", async () => {
    const changed: string[] = [];
    render(
        <PiOptions
            {...props}
            loadModels={async () => {
                throw Error("offline");
            }}
            onThinkingChange={(v) => changed.push(v)}
        />,
    );
    await flush();
    expect(changed).toEqual(["high"]);
    expect(await choices()).not.toContain("Xhigh");
});
