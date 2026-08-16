import { expect, test, beforeEach, afterAll } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FlowArtifact, FlowDefinition, FlowRun } from "@taskflow/shared";
import { useFlowStore } from "@/stores/flow-store";
import { FlowPanel } from "./FlowPanel";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Seeds the real flow store rather than mocking the module, for the reasons
// spelled out in FlowPanel.loop.test.tsx.
const OWNER = "task-1";

const flowDef: FlowDefinition = {
    id: "flow-1",
    name: "Feature Development",
    description: "",
    actions: [
        { id: "entry-1", inline: { name: "Plan", prompt: "p", sessionType: "claude" } },
        { id: "entry-2", inline: { name: "Review", prompt: "r", sessionType: "claude" } },
    ],
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
};

function makeRun(artifacts: FlowArtifact[]): FlowRun {
    return {
        taskId: OWNER,
        flowId: "flow-1",
        status: "running",
        currentActionIndex: 1,
        actions: [
            { actionEntryId: "entry-1", status: "completed" },
            { actionEntryId: "entry-2", status: "running" },
        ],
        artifacts,
        startedAt: "2026-08-13T00:00:00.000Z",
    };
}

let container: HTMLDivElement;
let root: Root | null = null;

function mount(run: FlowRun) {
    useFlowStore.setState({ flows: [flowDef], actions: [], activeRuns: { [OWNER]: run } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root?.render(<FlowPanel ownerId={OWNER} onClose={() => {}} />);
    });
}

function unmount() {
    if (root) {
        const r = root;
        act(() => {
            r.unmount();
        });
        root = null;
    }
    container?.remove();
}

beforeEach(() => {
    unmount();
    useFlowStore.setState({ flows: [], actions: [], activeRuns: {} });
});

afterAll(() => {
    unmount();
    useFlowStore.setState({ flows: [], actions: [], activeRuns: {} });
});

// The run stores one artifact per (action, type), so two actions writing the same
// label leave two rows on the run. The panel must show the label once.
test("one type written by two actions renders a single row with the newest value", () => {
    mount(
        makeRun([
            {
                type: "summary",
                text: "from action 1",
                actionEntryId: "entry-1",
                createdAt: "2026-08-13T01:00:00.000Z",
            },
            {
                type: "summary",
                text: "from action 2",
                actionEntryId: "entry-2",
                createdAt: "2026-08-13T02:00:00.000Z",
            },
        ]),
    );

    const text = container.textContent ?? "";
    expect(text).toContain("from action 2");
    expect(text).not.toContain("from action 1");
});

test("distinct types all render", () => {
    mount(
        makeRun([
            {
                type: "plan",
                path: "docs/plan.md",
                actionEntryId: "entry-1",
                createdAt: "2026-08-13T01:00:00.000Z",
            },
            {
                type: "review",
                text: "looks good",
                actionEntryId: "entry-2",
                createdAt: "2026-08-13T02:00:00.000Z",
            },
        ]),
    );

    const text = container.textContent ?? "";
    expect(text).toContain("docs/plan.md");
    expect(text).toContain("looks good");
});
