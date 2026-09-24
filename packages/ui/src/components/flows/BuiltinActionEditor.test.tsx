import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
    AgentLaunchOptions,
    AgentType,
    BuiltinActionDefinition,
    BuiltinActionOverride,
} from "@taskflow/shared";
import { BUILTIN_ACTION_DEFAULTS } from "@taskflow/shared";

// The editor reads its machine's settings from byBackend.
interface MockSettingsState {
    settings: { general: { defaultAgent: AgentType } };
    byBackend: Record<string, { general: { defaultAgent: AgentType } }>;
}
await mock.module("@/stores/settings-store", () => ({
    useSettingsStore: <T,>(selector: (s: MockSettingsState) => T): T =>
        selector({
            settings: { general: { defaultAgent: "claude" } },
            byBackend: { b1: { general: { defaultAgent: "codex" } } },
        }),
}));

// Monaco-backed textarea does not work in happy-dom.
await mock.module("@/components/ui/expandable-textarea", () => ({
    ExpandableTextarea: ({
        dialogTitle: _dialogTitle,
        ...props
    }: ComponentProps<"textarea"> & { dialogTitle?: string }) => <textarea {...props} />,
}));

let panelProps: { headless?: boolean; agentType?: AgentType } = {};
await mock.module("@/components/workspace/AgentOptionsPanel", () => ({
    AgentOptionsPanel: (props: {
        agentType: AgentType;
        headless?: boolean;
        onChange?: (options: AgentLaunchOptions) => void;
    }) => {
        panelProps = props;
        return (
            <button
                id="pick-model"
                onClick={() => props.onChange?.({ type: props.agentType, model: "picked" })}>
                pick model
            </button>
        );
    },
}));

// Radix select renders its item labels only when open; a native select keeps the contract.
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
        <select id="agent" value={value} onChange={(e) => onValueChange(e.target.value)}>
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

await mock.module("@/components/ui/confirm-delete-dialog", () => ({
    ConfirmDeleteDialog: ({
        open,
        onConfirm,
        confirmLabel,
    }: {
        open: boolean;
        onConfirm: () => void;
        confirmLabel?: string;
    }) => (open ? <button onClick={onConfirm}>{`confirm ${confirmLabel ?? ""}`}</button> : null),
}));

const { BuiltinActionEditor } = await import("./BuiltinActionEditor");

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let saved: BuiltinActionOverride[] = [];
let resets = 0;

function title(overrides: Partial<BuiltinActionDefinition> = {}): BuiltinActionDefinition {
    return { ...BUILTIN_ACTION_DEFAULTS["builtin:task-title"], isModified: false, ...overrides };
}

async function mount(action: BuiltinActionDefinition) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root?.render(
            <BuiltinActionEditor
                action={action}
                backendId="b1"
                onSave={async (o) => {
                    saved.push(o);
                }}
                onReset={async () => {
                    resets++;
                }}
                onCancel={() => {}}
            />,
        );
    });
}

function unmount() {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
}

function button(label: string): HTMLButtonElement {
    const found = [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === label,
    );
    if (!found) throw new Error(`No button labelled ${label}`);
    return found;
}

function typePrompt(value: string) {
    const textarea = document.body.querySelector("#builtin-action-prompt");
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("no prompt textarea");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
        setter?.call(textarea, value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

beforeEach(() => {
    unmount();
    saved = [];
    resets = 0;
    panelProps = {};
});
afterAll(unmount);

test("save is disabled until something changes", async () => {
    await mount(title());
    expect(button("Save").disabled).toBe(true);
});

test("a prompt missing a required placeholder cannot be saved", async () => {
    await mount(title());
    typePrompt("Name this task");
    expect(document.body.textContent).toContain("{{description}}");
    expect(button("Save").disabled).toBe(true);
});

test("saves the edited prompt with the existing agent and options", async () => {
    await mount(title());
    typePrompt("Short title for: {{description}}");
    await act(async () => {
        button("Save").click();
    });
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe("builtin:task-title");
    expect(saved[0].prompt).toBe("Short title for: {{description}}");
    expect(saved[0].sessionType).toBe("claude");
    expect(saved[0].agentOptions).toEqual({ type: "claude", model: "haiku" });
});

test("saves agent option changes", async () => {
    await mount(title());
    act(() => button("pick model").click());
    await act(async () => {
        button("Save").click();
    });
    expect(saved[0].agentOptions).toEqual({ type: "claude", model: "picked" });
});

test("headless built-ins use the headless options panel, the commit built-in does not", async () => {
    await mount(title());
    expect(panelProps.headless).toBe(true);
    unmount();
    await mount({
        ...BUILTIN_ACTION_DEFAULTS["builtin:commit"],
        sessionType: "claude",
        isModified: true,
    });
    expect(panelProps.headless).toBe(false);
});

test("reset is disabled for an unmodified built-in and confirms before resetting", async () => {
    await mount(title());
    expect(button("Reset to default").disabled).toBe(true);
    unmount();

    await mount(title({ isModified: true, prompt: "X {{description}}" }));
    act(() => button("Reset to default").click());
    await act(async () => {
        button("confirm Reset").click();
    });
    expect(resets).toBe(1);
});

test("switching the agent clears the options and saves the new agent", async () => {
    await mount(title());
    const select = document.body.querySelector("#agent");
    if (!(select instanceof HTMLSelectElement)) throw new Error("no agent select");
    act(() => {
        select.value = "codex";
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(panelProps.agentType).toBe("codex");
    await act(async () => {
        button("Save").click();
    });
    expect(saved[0].sessionType).toBe("codex");
    expect(saved[0].agentOptions).toBeUndefined();
});

test("the commit built-in following the default agent names that agent", async () => {
    await mount({ ...BUILTIN_ACTION_DEFAULTS["builtin:commit"], isModified: false });
    expect(document.body.textContent).toContain("Default agent (Codex)");
});
