import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AgentAvailability, AgentType, AppSettings, Project } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import type { NewTaskSubmission } from "./NewTaskDialog";

// See NewTaskDialog.prefill.test.tsx: monaco breaks later component tests.
await mock.module("@/components/ui/monaco-editor-dialog", () => ({
    MonacoEditorDialog: () => null,
}));

// Machines "a" and "c" have Claude Code, machine "b" does not.
const claude: AgentAvailability = {
    type: "claude",
    available: true,
    path: "/usr/local/bin/claude",
    version: "2.1.0",
};
const agentsByBackend: Record<string, AgentAvailability[]> = {
    a: [claude],
    b: [{ type: "claude", available: false, path: "", version: "" }],
    c: [claude],
};
await mock.module("@/hooks/useAgentAvailability", () => ({
    useAgentAvailability: (backendId: string | null) =>
        (backendId ? agentsByBackend[backendId] : undefined) ?? [],
    isAgentAvailable: (agents: AgentAvailability[], type: AgentType) =>
        agents.find((a) => a.type === type)?.available ?? true,
}));

const { NewTaskDialog } = await import("./NewTaskDialog");
const { useSettingsStore } = await import("@/stores/settings-store");

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function project(id: string, backendId: string): Scoped<Project> {
    return {
        id,
        name: id,
        path: `/tmp/${id}`,
        sessions: [],
        attributes: [],
        createdAt: "2026-08-31T00:00:00.000Z",
        backendId,
    };
}

let container: HTMLDivElement;
let root: Root;
let submitted: NewTaskSubmission[];

/** Machine settings whose Claude Code has these accounts. */
function machineSettings(claudeAccounts: AppSettings["claude"]["accounts"]): AppSettings {
    return {
        general: {
            fontFamily: "sans",
            fontSize: 13,
            defaultAgent: "claude",
            defaultRuntime: "",
            favoriteAgents: [],
            confirmBeforeExit: false,
        },
        terminal: { fontFamily: "mono", fontSize: 13, defaultShell: "" },
        editor: {
            fontFamily: "mono",
            fontSize: 13,
            wordWrap: false,
            internalEditor: "",
            externalEditor: "",
            markdownWidth: "full",
        },
        layout: {
            window: { width: 1000, height: 800, isMaximized: false },
            panels: {
                sidebarWidth: 200,
                fileExplorerWidth: 200,
                taskInfoWidth: 200,
                flowPanelWidth: 200,
                compactSidebar: false,
                collapsedProjectIds: [],
                wikiRailOpen: false,
                wikiRailWidth: 200,
            },
        },
        claude: {
            accounts: claudeAccounts,
            defaultAccount: "default",
            defaultModel: "default",
            defaultEffort: "default",
            permissionMode: "default",
        },
        codex: {
            accounts: [],
            defaultAccount: "default",
            defaultModel: "",
            defaultReasoningEffort: "default",
            sandbox: "workspace-write",
            approvalPolicy: "on-request",
            dangerouslyBypassApprovalsAndSandbox: false,
        },
        opencode: { defaultModel: "", autoApprove: false },
        pi: { defaultModel: "", thinking: "off", tools: "" },
        kimi: { defaultModel: "", permissionMode: "manual" },
        appearance: { theme: "dark" },
        remoteAgent: { autoStart: false, appName: "", headless: false, permissionMode: "default" },
        network: { discoverable: false, displayName: "" },
    };
}

function render(defaultProjectId = "web") {
    act(() => {
        root.render(
            <NewTaskDialog
                open
                onOpenChange={() => {}}
                projects={[project("web", "a"), project("api", "b"), project("docs", "c")]}
                flowsFor={() => []}
                defaultProjectId={defaultProjectId}
                onSubmit={async (data) => {
                    submitted.push(data);
                }}
            />,
        );
    });
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
    });
}

/** The picker (a Radix select trigger) whose shown value is `text`, or with this id. */
function picker(match: string): HTMLElement {
    const found = [...document.body.querySelectorAll<HTMLElement>('[role="combobox"]')].find(
        (c) => c.id === match || c.textContent?.trim() === match,
    );
    if (!found) throw new Error(`no picker ${match}`);
    return found;
}

async function choose(trigger: HTMLElement, label: string) {
    act(() => {
        trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    await flush();
    const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (o) => o.textContent?.trim() === label,
    );
    if (!option) throw new Error(`no option ${label}`);
    act(() => {
        option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
}

function button(label: string): HTMLButtonElement {
    const found = [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === label,
    );
    if (!found) throw new Error(`no button labelled ${label}`);
    return found;
}

function click(element: HTMLElement) {
    act(() => {
        element.click();
    });
}

function typeDescription(text: string) {
    const textarea = document.getElementById("new-task-description");
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("no description");
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
            textarea,
            text,
        );
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function submit() {
    await act(async () => {
        button("Create Task").click();
    });
}

beforeEach(() => {
    submitted = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
        root = createRoot(container);
    });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe("new task dialog start with", () => {
    // Collapsing Agent Options unmounts the panel; reopening it must show the
    // options the form will submit, not the machine defaults.
    it("reopens Agent Options on the options it will submit", async () => {
        render();
        await choose(picker("new-task-start-with"), "Claude Code");
        click(button("Agent Options"));
        await choose(picker("Inherit Claude Default"), "Bypass Permissions");
        click(button("Agent Options"));
        expect(() => picker("Bypass Permissions")).toThrow();

        click(button("Agent Options"));
        expect(picker("Bypass Permissions")).toBeTruthy();

        typeDescription("Ship it.");
        await submit();
        expect(submitted[0]?.agentOptions).toMatchObject({
            type: "claude",
            permissionMode: "bypassPermissions",
        });
    });

    it("does not start an agent the newly chosen project's machine lacks", async () => {
        render();
        await choose(picker("new-task-start-with"), "Claude Code");
        await choose(picker("new-task-project"), "api");

        expect(picker("new-task-start-with").textContent?.trim()).toBe("Don't start");
        typeDescription("Ship it.");
        await submit();
        expect(submitted).toHaveLength(1);
        expect(submitted[0]?.projectId).toBe("api");
        expect(submitted[0]?.startWith).toBeUndefined();
        expect(submitted[0]?.agentOptions).toBeUndefined();
    });

    it("keeps the agent when switching back to a machine that has it", async () => {
        render();
        await choose(picker("new-task-start-with"), "Claude Code");
        await choose(picker("new-task-project"), "api");
        await choose(picker("new-task-project"), "web");

        typeDescription("Ship it.");
        await submit();
        expect(submitted[0]?.startWith).toBe("claude");
    });

    // A late create elsewhere moves the active task, and with it the default.
    it("keeps the chosen project when the default project changes", async () => {
        render("web");
        await choose(picker("new-task-project"), "docs");
        render("api");

        expect(picker("new-task-project").textContent?.trim()).toBe("docs");
        typeDescription("Ship it.");
        await submit();
        expect(submitted[0]?.projectId).toBe("docs");
    });

    it("drops an account the newly chosen project's machine does not have", async () => {
        const saved = useSettingsStore.getState();
        useSettingsStore.setState({
            byBackend: {
                a: machineSettings([{ id: "work", name: "work", homeDir: "/a/work" }]),
                c: machineSettings([]),
            },
        });
        try {
            render();
            await choose(picker("new-task-start-with"), "Claude Code");
            click(button("Agent Options"));
            await choose(picker("Inherit (project → default)"), "work");
            click(button("Agent Options"));
            await choose(picker("new-task-project"), "docs");

            typeDescription("Ship it.");
            await submit();
            expect(submitted[0]?.projectId).toBe("docs");
            expect(submitted[0]?.startWith).toBe("claude");
            expect(submitted[0]?.agentOptions).toMatchObject({ type: "claude" });
            expect(submitted[0]?.agentOptions).not.toHaveProperty("account", "work");
        } finally {
            useSettingsStore.setState(saved);
        }
    });

    it("keeps an account the newly chosen project's machine also has", async () => {
        const saved = useSettingsStore.getState();
        useSettingsStore.setState({
            byBackend: {
                a: machineSettings([{ id: "work", name: "work", homeDir: "/a/work" }]),
                c: machineSettings([{ id: "work", name: "work", homeDir: "/c/work" }]),
            },
        });
        try {
            render();
            await choose(picker("new-task-start-with"), "Claude Code");
            click(button("Agent Options"));
            await choose(picker("Inherit (project → default)"), "work");
            await choose(picker("new-task-project"), "docs");

            typeDescription("Ship it.");
            await submit();
            expect(submitted[0]?.agentOptions).toMatchObject({ type: "claude", account: "work" });
        } finally {
            useSettingsStore.setState(saved);
        }
    });
});
