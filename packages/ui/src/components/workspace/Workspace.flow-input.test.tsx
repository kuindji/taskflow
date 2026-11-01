import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FlowDefinition } from "@taskflow/shared";
import { closeConnection, openConnection, setPrimary } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { useFlowStore } from "@/stores/flow-store";
import { useUIStore } from "@/stores/ui-store";
import type { SplitContainerProps } from "./SplitContainer";

const BACKEND = "workspace-flow-input";
const FLOW: FlowDefinition = {
    id: "release",
    name: "Release flow",
    description: "",
    actions: [],
    inputs: [{ id: "version", label: "Version", type: "text" }],
    createdAt: "",
    updatedAt: "",
};
let startFlow: ((flowId: string) => void) | null = null;
let server: TestServer | null = null;

// The pane tree is not under test; capture the Run menu's flow launcher.
void mock.module("./SplitContainer", () => ({
    SplitContainer: (props: SplitContainerProps) => {
        startFlow = props.onStartFlow;
        return null;
    },
}));

const { Workspace } = await import("./Workspace");

let root: Root | null = null;

beforeAll(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    // One answer shape for every list the workspace loads on mount.
    server = startTestServer(BACKEND, () => ({
        flows: [FLOW],
        actions: [],
        runs: [],
        commands: [],
        shells: [],
        systemShellPath: "/bin/sh",
    }));
    await openConnection(BACKEND, server.origin);
    setPrimary(BACKEND);
    useUIStore.setState({ masterWorkspaceActive: true });
    useFlowStore.setState({ flows: [{ ...FLOW, backendId: BACKEND }] });
});

afterAll(() => {
    act(() => root?.unmount());
    useUIStore.setState({ masterWorkspaceActive: false });
    useFlowStore.setState({ flows: [] });
    closeConnection(BACKEND, "detach");
    server?.stop();
});

test("a master-workspace flow with inputs shows its input dialog", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<Workspace />));
    // Let the mount-time list requests settle before the machine is detached.
    await act(async () => {
        await Bun.sleep(100);
    });

    expect(startFlow).not.toBeNull();
    act(() => startFlow?.("release"));

    expect(document.body.textContent).toContain("Release flow");
    expect(document.body.textContent).toContain("Version");
});
