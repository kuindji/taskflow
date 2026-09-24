import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BuiltinActionDefinition } from "@taskflow/shared";
import { BUILTIN_ACTION_DEFAULTS } from "@taskflow/shared";

const fetched: string[] = [];
const builtinActions = Object.values(BUILTIN_ACTION_DEFAULTS).map(
    (def): BuiltinActionDefinition & { backendId: string } => ({
        ...def,
        isModified: def.id === "builtin:task-title",
        backendId: "primary",
    }),
);
const flowState = {
    flows: [],
    actions: [],
    builtinActions,
    fetchFlows: async () => {},
    fetchActions: async () => {},
    fetchBuiltinActions: async (backendId: string) => {
        fetched.push(backendId);
    },
    saveBuiltinAction: async () => {},
    resetBuiltinAction: async () => {},
};
await mock.module("@/stores/flow-store", () => ({
    useFlowStore: Object.assign(
        <T,>(selector: (s: typeof flowState) => T): T => selector(flowState),
        { getState: () => flowState },
    ),
}));

const uiState = { flowManagementOpen: true, toggleFlowManagement: () => {}, activeProjectId: null };
await mock.module("@/stores/ui-store", () => ({
    useUIStore: <T,>(selector: (s: typeof uiState) => T): T => selector(uiState),
}));
await mock.module("@/stores/project-store", () => ({
    useProjectStore: <T,>(selector: (s: { projects: [] }) => T): T => selector({ projects: [] }),
}));
await mock.module("@/hooks/usePrimaryBackend", () => ({ usePrimaryBackend: () => "primary" }));

await mock.module("@/components/ui/dialog", () => ({
    Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
        open ? <>{children}</> : null,
    DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

// Radix select is not drivable in happy-dom; a native select keeps the same contract.
await mock.module("@/components/ui/select", () => ({
    Select: ({
        value,
        onValueChange,
        children,
    }: {
        value: string;
        onValueChange: (v: string) => void;
        children: ReactNode;
    }) => (
        <select id="filter" value={value} onChange={(e) => onValueChange(e.target.value)}>
            {children}
        </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
        <option value={value}>{children}</option>
    ),
}));

await mock.module("./FlowEditor", () => ({ FlowEditor: () => <div>flow editor</div> }));
await mock.module("./ActionEditor", () => ({ ActionEditor: () => <div>action editor</div> }));
await mock.module("./BuiltinActionEditor", () => ({
    BuiltinActionEditor: ({ action }: { action: BuiltinActionDefinition }) => (
        <div>{`builtin editor: ${action.id}`}</div>
    ),
}));

const { FlowManagementDialog } = await import("./FlowManagementDialog");

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root?.render(<FlowManagementDialog />);
    });
}

function unmount() {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
}

function chooseFilter(value: string) {
    const select = document.body.querySelector("#filter");
    if (!(select instanceof HTMLSelectElement)) throw new Error("no filter");
    act(() => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

function buttonWithText(text: string): HTMLButtonElement {
    const found = [...document.body.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(text),
    );
    if (!found) throw new Error(`No button containing ${text}`);
    return found;
}

beforeEach(() => {
    unmount();
    fetched.length = 0;
});
afterAll(unmount);

test("fetches built-ins on open and keeps them out of All", async () => {
    await mount();
    expect(fetched).toEqual(["primary"]);
    expect(document.body.textContent).not.toContain("Generate task title");
});

test("the Built-in filter lists built-ins, marks modified ones, hides create", async () => {
    await mount();
    chooseFilter("builtin");
    expect(document.body.textContent).toContain("Generate task title");
    expect(document.body.textContent).toContain("Commit with agent");
    expect(document.body.textContent).toContain("Modified");
    expect(document.body.querySelector('button[title="New action"]')).toBeNull();
});

test("selecting a built-in opens its editor", async () => {
    await mount();
    chooseFilter("builtin");
    act(() => buttonWithText("Generate commit message").click());
    expect(document.body.textContent).toContain("builtin editor: builtin:commit-message");
});

test("the Flows tab explains built-ins can't be used in flows", async () => {
    await mount();
    chooseFilter("builtin");
    act(() => buttonWithText("Flows").click());
    expect(document.body.textContent).toContain("Built-in actions can't be used in flows");
    expect(document.body.textContent).not.toContain("No flows yet");
});
