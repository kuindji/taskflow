import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AgentLaunchOptions, AgentType, GitStatusResponse } from "@taskflow/shared";

const createSessionCalls: unknown[][] = [];

const createSession = (...args: unknown[]): Promise<string> => {
    createSessionCalls.push(args);
    return Promise.resolve("session-1");
};

await mock.module("@/stores/session-store", () => ({
    useSessionStore: <T,>(selector: (state: { createSession: typeof createSession }) => T): T =>
        selector({ createSession }),
}));

await mock.module("@/stores/settings-store", () => ({
    useSettingsStore: <T,>(
        selector: (state: { settings: { general: { defaultAgent: AgentType } } }) => T,
    ): T => selector({ settings: { general: { defaultAgent: "codex" } } }),
}));

await mock.module("@/hooks/useAgentAvailability", () => ({
    useAgentAvailability: () => [
        { type: "claude", available: true, path: "/claude", version: "1" },
        { type: "codex", available: true, path: "/codex", version: "1" },
    ],
    isAgentAvailable: (
        agents: { type: AgentType; available: boolean }[],
        type: AgentType,
    ): boolean => agents.find((agent) => agent.type === type)?.available ?? true,
}));

await mock.module("@/hooks/useWebSocket", () => ({
    sendRequest: (): Promise<GitStatusResponse> =>
        Promise.resolve({
            status: {
                branch: "main",
                stagedFiles: [],
                unstagedFiles: [
                    {
                        path: "changed.ts",
                        status: "modified",
                        staged: false,
                    },
                ],
                ahead: 0,
                behind: 0,
            },
        }),
}));

await mock.module("@/components/ui/dialog", () => ({
    Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
        open ? <>{children}</> : null,
    DialogContent: (props: ComponentProps<"div">) => <div {...props} />,
    DialogHeader: (props: ComponentProps<"div">) => <div {...props} />,
    DialogTitle: (props: ComponentProps<"h2">) => <h2 {...props} />,
    DialogFooter: (props: ComponentProps<"div">) => <div {...props} />,
}));

// The real expandable textarea imports Monaco, whose document-level clipboard
// listeners interfere with synthetic clicks in happy-dom. Commit behavior only
// needs a textarea here.
await mock.module("@/components/ui/expandable-textarea", () => ({
    ExpandableTextarea: ({
        dialogTitle: _dialogTitle,
        ...props
    }: ComponentProps<"textarea"> & { dialogTitle?: string }) => <textarea {...props} />,
}));

await mock.module("@/components/workspace/AgentOptionsPanel", () => ({
    AgentOptionsPanel: ({
        agentType,
        onChange,
    }: {
        agentType: AgentType;
        onChange?: (options: AgentLaunchOptions) => void;
    }) => (
        <button
            id="change-agent-option"
            onClick={() => onChange?.({ type: agentType, model: "custom-model" })}>
            Change agent option
        </button>
    ),
}));

const { CommitDialog } = await import("./CommitDialog");

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function click(element: Element): void {
    act(() => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

function findButton(label: string): HTMLButtonElement {
    const button = [...document.body.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) throw new Error(`No button labelled ${label}`);
    return button;
}

async function mount(): Promise<void> {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root?.render(
            <CommitDialog
                open
                onOpenChange={() => {}}
                repoPath="/repo"
                sessionOwner={{ taskId: "task-1" }}
            />,
        );
    });
}

function unmount(): void {
    if (root) {
        act(() => root?.unmount());
        root = null;
    }
    container?.remove();
    container = null;
}

beforeEach(() => {
    unmount();
    createSessionCalls.length = 0;
});

afterAll(unmount);

test("Use agent shows the configured default agent and launches without option overrides", async () => {
    await mount();

    const useAgentSwitch = document.body.querySelector("#commit-use-agent");
    if (!useAgentSwitch) throw new Error("Use agent switch was not rendered");
    click(useAgentSwitch);

    const agentTrigger = document.body.querySelector("#commit-agent");
    expect(agentTrigger?.textContent).toContain("Codex");
    expect(document.body.textContent).toContain("Agent Options");

    await act(async () => {
        findButton("Commit").click();
    });

    expect(createSessionCalls).toHaveLength(1);
    expect(createSessionCalls[0]?.[1]).toBe("codex");
    expect(createSessionCalls[0]?.[4]).toBeUndefined();
    expect(createSessionCalls[0]?.[5]).toBeUndefined();
});

test("changed agent options are passed to the commit session", async () => {
    await mount();

    const useAgentSwitch = document.body.querySelector("#commit-use-agent");
    if (!useAgentSwitch) throw new Error("Use agent switch was not rendered");
    click(useAgentSwitch);
    click(findButton("Agent Options"));

    const optionButton = document.body.querySelector("#change-agent-option");
    if (!optionButton) throw new Error("Agent options were not rendered");
    click(optionButton);

    await act(async () => {
        findButton("Commit").click();
    });

    expect(createSessionCalls).toHaveLength(1);
    expect(createSessionCalls[0]?.[5]).toEqual({ type: "codex", model: "custom-model" });
});
