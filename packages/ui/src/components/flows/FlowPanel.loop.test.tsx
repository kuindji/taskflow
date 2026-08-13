import { expect, test, beforeEach, afterAll } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FlowDefinition, FlowRun } from "@taskflow/shared";
import { useFlowStore } from "@/stores/flow-store";
import { FlowPanel } from "./FlowPanel";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The real flow store is used rather than a module mock: nothing in it connects
// at import time (`onEvent` only registers a listener), so seeding it with
// setState is both narrower and safer than a process-wide `mock.module`.
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

// Only the run's own fields are overridable: FlowRun's owner half is a
// discriminated union, so spreading a Partial of the whole type widens
// `projectId` and stops matching the task-owned member.
type RunOverrides = Partial<Pick<FlowRun, "status" | "loop" | "iteration" | "actions">>;

function makeRun(overrides: RunOverrides = {}): FlowRun {
    return {
        taskId: OWNER,
        flowId: "flow-1",
        status: "running",
        currentActionIndex: 0,
        actions: [
            { actionEntryId: "entry-1", status: "running" },
            { actionEntryId: "entry-2", status: "pending" },
        ],
        artifacts: [],
        startedAt: "2026-08-13T00:00:00.000Z",
        ...overrides,
    };
}

let container: HTMLDivElement;
let root: Root | null = null;
let prevRoot: Root | null = null;
let prevContainer: HTMLDivElement | null = null;

function mount(run: FlowRun) {
    useFlowStore.setState({ flows: [flowDef], actions: [], activeRuns: { [OWNER]: run } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root?.render(<FlowPanel ownerId={OWNER} onClose={() => {}} />);
    });
    prevRoot = root;
    prevContainer = container;
}

function unmountPrevious() {
    if (prevRoot) {
        const r = prevRoot;
        act(() => {
            r.unmount();
        });
        prevRoot = null;
    }
    if (prevContainer) {
        prevContainer.remove();
        prevContainer = null;
    }
}

/** The stop button is the only one rendering a Square icon (lucide-square). */
function stopButton(): HTMLButtonElement {
    const el = [...container.querySelectorAll("button")].find((b) =>
        b.querySelector(".lucide-square"),
    );
    if (!el) throw new Error("no stop button rendered");
    return el;
}

/**
 * Button tooltips render into a body portal only while hovered, so the text is
 * unreachable without dispatching the enter event React listens for.
 */
function tooltipTextOf(button: HTMLButtonElement): string {
    act(() => {
        button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    const text = document.body.textContent ?? "";
    act(() => {
        button.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    return text;
}

beforeEach(() => {
    unmountPrevious();
    useFlowStore.setState({ flows: [], actions: [], activeRuns: {} });
});

afterAll(() => {
    unmountPrevious();
    useFlowStore.setState({ flows: [], actions: [], activeRuns: {} });
});

test("a looped run shows its iteration in the header", () => {
    mount(makeRun({ loop: true, iteration: 3 }));

    expect(container.textContent).toContain("Iteration 3");
});

test("a looped run with no iteration stamp falls back to 1", () => {
    // Reachable for a run persisted before the loop feature existed; without the
    // fallback the header renders "Iteration undefined".
    mount(makeRun({ loop: true }));

    expect(container.textContent).toContain("Iteration 1");
});

test("a non-looped run shows no iteration indicator", () => {
    mount(makeRun({ iteration: 3 }));

    expect(container.textContent).not.toContain("Iteration");
});

test("stop on a looped run reads Finish loop and is not styled as destructive", () => {
    mount(makeRun({ loop: true, iteration: 2 }));

    const button = stopButton();
    expect(button.className).not.toContain("text-destructive");
    expect(tooltipTextOf(button)).toContain("Finish loop");
});

test("stop on a non-looped run stays destructive and reads Stop", () => {
    mount(makeRun());

    const button = stopButton();
    expect(button.className).toContain("text-destructive");
    const text = tooltipTextOf(button);
    expect(text).toContain("Stop");
    expect(text).not.toContain("Finish loop");
});

test("a paused looped run still offers the loop-aware stop", () => {
    // The stop button renders for running *and* paused runs; the loop-aware
    // labelling must not be scoped to the running case.
    mount(makeRun({ loop: true, iteration: 2, status: "paused" }));

    const button = stopButton();
    expect(button.className).not.toContain("text-destructive");
    expect(tooltipTextOf(button)).toContain("Finish loop");
});
