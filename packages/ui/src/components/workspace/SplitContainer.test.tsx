import { afterAll, beforeAll, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useUIStore } from "@/stores/ui-store";
import { SplitContainer } from "./SplitContainer";

const WORKSPACE = "project:split-container";
const noop = () => {};

beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterAll(() => {
    if (useUIStore.getState().splitByWorkspace[WORKSPACE])
        useUIStore.getState().toggleSplit(WORKSPACE);
});

test("opening and closing the split keeps the left pane mounted", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(
            <SplitContainer
                workspaceKey={WORKSPACE}
                onNewTab={noop}
                onRunTab={noop}
                onRunScript={noop}
                onRunAction={noop}
                onRunAgentCommand={noop}
                onStartFlow={noop}
                onManageFlows={noop}
                scripts={{}}
                defaultRuntime="bun"
                flows={[]}
                standaloneActions={[]}
                agentCommands={[]}
                activeFlowRun={null}
                showRunButton={false}
                showAgentOptions={false}
                allowSessionTabs
            />,
        );
    });
    // A remount would replace this node, and with it every open pane's state
    // (an embedded browser's page and history among them).
    const leftPane = container.firstElementChild?.firstElementChild;
    expect(leftPane).toBeTruthy();

    await act(async () => {
        useUIStore.getState().toggleSplit(WORKSPACE);
    });
    expect(leftPane?.isConnected).toBe(true);

    await act(async () => {
        useUIStore.getState().toggleSplit(WORKSPACE);
    });
    expect(leftPane?.isConnected).toBe(true);

    await act(async () => {
        root.unmount();
    });
    container.remove();
});
