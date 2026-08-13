import { expect, test, beforeEach, afterAll, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FlowDefinition } from "@taskflow/shared";

// FlowEditor reads the project list through the repo's `@/` alias, and that
// store module opens a websocket subscription at import time. Intercept the
// alias -- the same specifier the component imports -- so mounting the editor
// needs no backend.
interface ProjectStoreState {
    projects: { id: string; name: string }[];
}
await mock.module("@/stores/project-store", () => ({
    useProjectStore: <T,>(selector: (s: ProjectStoreState) => T): T => selector({ projects: [] }),
}));

// The action list pulls in the inline action editor, which loads monaco at
// import time. Monaco attaches document-level listeners that throw on any
// synthetic click, and none of it is relevant to the loop toggle -- stub the
// whole subtree out.
await mock.module("./FlowActionList", () => ({
    FlowActionList: () => <div data-testid="action-list" />,
}));

const { FlowEditor } = await import("./FlowEditor");

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const baseFlow: FlowDefinition = {
    id: "flow-1",
    name: "Feature Development",
    description: "does things",
    // agentOptions.type must match sessionType or the editor considers the
    // definition invalid and keeps Save disabled regardless of the loop flag.
    actions: [
        {
            id: "entry-1",
            inline: {
                name: "Plan",
                prompt: "p",
                sessionType: "claude",
                agentOptions: { type: "claude" },
            },
        },
    ],
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root | null = null;
let prevRoot: Root | null = null;
let prevContainer: HTMLDivElement | null = null;
let saved: FlowDefinition[] = [];

function mount(flow: FlowDefinition | null) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root?.render(
            <FlowEditor
                flow={flow}
                globalActions={[]}
                onSave={(f) => saved.push(f)}
                onCancel={() => {}}
            />,
        );
    });
    prevRoot = root;
    prevContainer = container;
}

const loopSwitch = () => {
    const el = container.querySelector<HTMLButtonElement>("#flow-loop");
    if (!el) throw new Error("no loop switch rendered");
    return el;
};

const saveButton = () => {
    const el = [...container.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Save Flow",
    );
    if (!el) throw new Error("no Save Flow button rendered");
    return el;
};

function click(el: HTMLButtonElement) {
    act(() => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
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

beforeEach(() => {
    unmountPrevious();
    saved = [];
});

afterAll(() => {
    unmountPrevious();
});

test("an unlooped flow renders the toggle off with Save disabled", () => {
    mount(baseFlow);

    expect(loopSwitch().getAttribute("data-state")).toBe("unchecked");
    expect(saveButton().disabled).toBe(true);
});

test("toggling loop on enables Save and saves loop: true", () => {
    mount(baseFlow);

    click(loopSwitch());

    expect(loopSwitch().getAttribute("data-state")).toBe("checked");
    // Pins both snapshots: miss either one and Save stays disabled.
    expect(saveButton().disabled).toBe(false);

    click(saveButton());

    expect(saved).toHaveLength(1);
    // Pins the payload and handleSave's dependency array: a stale callback
    // would save the pre-toggle value.
    expect(saved[0].loop).toBe(true);
});

test("an existing looped flow renders the toggle on with Save disabled", () => {
    mount({ ...baseFlow, loop: true });

    // Pins the useState initialiser and the initialSnapshot, which must agree
    // or the editor opens already dirty.
    expect(loopSwitch().getAttribute("data-state")).toBe("checked");
    expect(saveButton().disabled).toBe(true);
});

test("toggling loop off on a looped flow saves loop: false", () => {
    mount({ ...baseFlow, loop: true });

    click(loopSwitch());
    expect(saveButton().disabled).toBe(false);
    click(saveButton());

    expect(saved).toHaveLength(1);
    expect(saved[0].loop).toBe(false);
});

test("a new flow defaults the toggle off", () => {
    mount(null);

    expect(loopSwitch().getAttribute("data-state")).toBe("unchecked");
});
