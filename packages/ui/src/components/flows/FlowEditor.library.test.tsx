import { expect, test, beforeEach, afterAll, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ActionDefinition, FlowDefinition } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";

// Same stubs as FlowEditor.loop.test.tsx: the project store opens a websocket
// subscription at import, and the real action list loads monaco.
interface ProjectStoreState {
    projects: { id: string; name: string }[];
}
await mock.module("@/stores/project-store", () => ({
    useProjectStore: <T,>(selector: (s: ProjectStoreState) => T): T => selector({ projects: [] }),
}));

let offered: ActionDefinition[] = [];
await mock.module("./FlowActionList", () => ({
    FlowActionList: ({ libraryActions }: { libraryActions: ActionDefinition[] }) => {
        offered = libraryActions;
        return null;
    },
}));

const { FlowEditor } = await import("./FlowEditor");

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function action(id: string, backendId: string): Scoped<ActionDefinition> {
    return {
        backendId,
        id,
        name: id,
        prompt: "p",
        sessionType: "claude",
        createdAt: "2026-09-13T00:00:00.000Z",
        updatedAt: "2026-09-13T00:00:00.000Z",
    };
}

const flowOnB: FlowDefinition = {
    id: "flow-b",
    name: "B's flow",
    description: "",
    actions: [],
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function unmount() {
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    container?.remove();
    container = null;
}

beforeEach(() => {
    unmount();
    offered = [];
});

afterAll(unmount);

// The flow is saved to its own machine, which resolves action ids locally: an
// action from another machine's library would be saved into a flow that
// machine cannot run.
test("a flow's action library offers only its own machine's actions", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const r = createRoot(container);
    root = r;
    act(() => {
        r.render(
            <FlowEditor
                flow={flowOnB}
                backendId="b"
                globalActions={[action("global-a", "a"), action("global-b", "b")]}
                onSave={() => {}}
                onCancel={() => {}}
            />,
        );
    });

    expect(offered.map((a) => a.id)).toEqual(["global-b"]);
});
