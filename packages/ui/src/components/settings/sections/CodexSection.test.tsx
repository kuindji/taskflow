import { afterEach, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CodexModelsResponse, CodexModelsPayload, CodexModelInfo } from "@taskflow/shared";
import { CodexSection } from "./CodexSection";
import { useBackendStore } from "@/stores/backend-store";

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
const response = (models: CodexModelInfo[]): CodexModelsResponse => ({
    models,
    account: { state: "unknown" },
});
const noop = () => {};

test("Codex settings queries the configured default account on primary", async () => {
    const before = useBackendStore.getState().primaryId;
    useBackendStore.setState({ primaryId: "primary-machine" });
    const calls: [string, CodexModelsPayload][] = [];
    const load = async (backend: string, payload: CodexModelsPayload) => {
        calls.push([backend, payload]);
        return response([]);
    };
    const node = (discoveryKey: string) => (
        <CodexSection
            defaultAccount="work"
            discoveryKey={discoveryKey}
            loadDiscovery={load}
            defaultModel=""
            defaultReasoningEffort="default"
            sandbox="workspace-write"
            approvalPolicy="on-request"
            dangerouslyBypassApprovalsAndSandbox={false}
            onModelChange={noop}
            onReasoningEffortChange={noop}
            onSandboxChange={noop}
            onApprovalPolicyChange={noop}
            onDangerouslyBypassApprovalsAndSandboxChange={noop}
        />
    );
    try {
        render(node("home1"));
        await flush();
        render(node("home2"));
        await flush();
        expect(calls).toEqual([
            ["primary-machine", { account: "work" }],
            ["primary-machine", { account: "work" }],
        ]);
    } finally {
        act(() => root?.unmount());
        root = null;
        container.remove();
        useBackendStore.setState({ primaryId: before });
    }
});
