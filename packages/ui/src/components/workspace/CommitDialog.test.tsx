import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AgentType, BuiltinActionDefinition } from "@taskflow/shared";
import { BUILTIN_ACTION_DEFAULTS, MSG } from "@taskflow/shared";

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

let builtinList: BuiltinActionDefinition[] | Error = [];
const requestTypes: string[] = [];

// Git requests go to the workspace's machine; so does the built-in lookup.
await mock.module("@/hooks/useWorkspaceRequest", () => ({
    useWorkspaceRequest:
        () =>
        (type: string): Promise<unknown> => {
            requestTypes.push(type);
            if (type === MSG.BUILTIN_ACTIONS_LIST) {
                return builtinList instanceof Error
                    ? Promise.reject(builtinList)
                    : Promise.resolve({ actions: builtinList });
            }
            return Promise.resolve({
                status: {
                    branch: "main",
                    stagedFiles: [],
                    unstagedFiles: [{ path: "changed.ts", status: "modified", staged: false }],
                    ahead: 0,
                    behind: 0,
                },
            });
        },
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
    requestTypes.length = 0;
    builtinList = [{ ...BUILTIN_ACTION_DEFAULTS["builtin:commit"], isModified: false }];
});

afterAll(unmount);

async function commitWithAgent(): Promise<void> {
    await mount();
    const useAgentSwitch = document.body.querySelector("#commit-use-agent");
    if (!useAgentSwitch) throw new Error("Use agent switch was not rendered");
    click(useAgentSwitch);
    await act(async () => {
        findButton("Commit").click();
    });
}

test("the dialog no longer offers agent pickers and points to the built-in", async () => {
    await mount();
    const useAgentSwitch = document.body.querySelector("#commit-use-agent");
    if (!useAgentSwitch) throw new Error("Use agent switch was not rendered");
    click(useAgentSwitch);
    expect(document.body.querySelector("#commit-agent")).toBeNull();
    expect(document.body.textContent).not.toContain("Agent Options");
    expect(document.body.textContent).toContain("Actions and Flows → Built-in");
});

test("the default built-in runs on the machine's default agent with today's prompt", async () => {
    await commitWithAgent();
    expect(requestTypes).toContain(MSG.BUILTIN_ACTIONS_LIST);
    expect(createSessionCalls).toHaveLength(1);
    expect(createSessionCalls[0]?.[1]).toBe("codex");
    expect(createSessionCalls[0]?.[2]).toBe("Commit");
    expect(createSessionCalls[0]?.[3]).toBe("Create commits for all changes, staged and unstaged.");
    expect(createSessionCalls[0]?.[5]).toBeUndefined();
});

test("an overridden built-in supplies agent, options and prompt", async () => {
    builtinList = [
        {
            ...BUILTIN_ACTION_DEFAULTS["builtin:commit"],
            prompt: "Be careful.\n{{instructions}}",
            sessionType: "claude",
            agentOptions: { type: "claude", model: "opus" },
            isModified: true,
        },
    ];
    await commitWithAgent();
    expect(createSessionCalls[0]?.[1]).toBe("claude");
    expect(createSessionCalls[0]?.[3]).toBe(
        "Be careful.\nCreate commits for all changes, staged and unstaged.",
    );
    expect(createSessionCalls[0]?.[5]).toEqual({ type: "claude", model: "opus" });
});

test("a machine without built-in actions falls back to the default", async () => {
    builtinList = new Error("No handler for message type: builtin-action:list");
    await commitWithAgent();
    expect(createSessionCalls).toHaveLength(1);
    expect(createSessionCalls[0]?.[1]).toBe("codex");
    expect(createSessionCalls[0]?.[3]).toBe("Create commits for all changes, staged and unstaged.");
});

test("any other lookup failure shows the error and starts no session", async () => {
    builtinList = new Error("Request timeout: builtin-action:list");
    await commitWithAgent();
    expect(createSessionCalls).toHaveLength(0);
    expect(document.body.textContent).toContain("Request timeout: builtin-action:list");
});
