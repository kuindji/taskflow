import { afterEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FlowDefinition, Project, Task } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";

// The description field loads monaco through this dialog; NewTaskDialog's
// prefill test stubs it for the same reason.
await mock.module("@/components/ui/monaco-editor-dialog", () => ({
    MonacoEditorDialog: () => null,
}));

const { TaskCreationDialogHost } = await import("./TaskCreationDialogHost");
const { useProjectStore } = await import("@/stores/project-store");
const { useTaskStore } = await import("@/stores/task-store");
const { useFlowStore } = await import("@/stores/flow-store");
const { useTaskCreationStore } = await import("@/stores/task-creation-store");
const { useSessionStore } = await import("@/stores/session-store");

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const web: Scoped<Project> = {
    id: "web",
    name: "web",
    path: "/repo/web",
    sessions: [],
    attributes: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    backendId: "local",
};

const research: Scoped<FlowDefinition> = {
    id: "research",
    name: "Research",
    description: "",
    actions: [],
    inputs: [{ id: "topic", label: "Topic", type: "text" }],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    backendId: "local",
};

const created: Scoped<Task> = {
    id: "task-1",
    projectId: "web",
    title: "",
    description: "Look into it",
    notes: "",
    archivedAt: null,
    pinned: false,
    status: "active",
    sessions: [],
    attributes: [],
    worktree: { enabled: false, path: null, branch: null, pr: null },
    createdAt: "2026-11-01T00:00:00.000Z",
    backendId: "local",
};

let root: Root | null = null;
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
});

const setValue = (element: HTMLElement, value: string) => {
    const proto = Object.getPrototypeOf(element) as object;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
};

const byId = (id: string): HTMLElement => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`no #${id}`);
    return element;
};

async function choose(triggerId: string, optionText: string) {
    const trigger = byId(triggerId);
    await act(async () =>
        trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (o) => o.textContent === optionText,
    );
    if (!option) throw new Error(`no option ${optionText}`);
    await act(async () =>
        option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
}

const button = (text: string) => {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => b.textContent?.trim() === text,
    );
    if (!found) throw new Error(`no button ${text}`);
    return found;
};

test("a new task's flow with inputs asks for them and starts with them", async () => {
    const started: unknown[] = [];
    useProjectStore.setState({ projects: [web] });
    useTaskStore.setState({ tasks: [], createTask: async () => created });
    useFlowStore.setState({
        flows: [research],
        fetchFlows: async () => {},
        fetchActions: async () => {},
        startFlow: async (_backendId, params) => {
            started.push(params);
            return new Promise(() => {});
        },
    });
    useTaskCreationStore.setState({
        newTaskOpen: true,
        newProjectOpen: false,
        parentTaskId: null,
        preferredProjectId: "web",
        prefill: null,
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = createRoot(container);
    root = mounted;
    await act(async () => mounted.render(<TaskCreationDialogHost />));

    await act(async () => setValue(byId("new-task-description"), "Look into it"));
    await act(async () => byId("new-task-worktree").click());
    await choose("new-task-start-with", "Flow");
    await choose("new-task-flow", "Research");
    await act(async () => button("Create Task").click());

    expect(started).toEqual([]);
    await act(async () => setValue(byId("flow-input-topic"), "caching"));
    await act(async () => button("Start Flow").click());

    expect(started).toEqual([
        { taskId: "task-1", flowId: "research", inputValues: { topic: "caching" } },
    ]);
});

test("a task create that fails keeps the dialog open with its draft and the error", async () => {
    let attempts = 0;
    useProjectStore.setState({ projects: [web] });
    useTaskStore.setState({
        tasks: [],
        createTask: async () => {
            attempts++;
            if (attempts === 1) throw new Error("Backend remote is not connected");
            return created;
        },
    });
    useFlowStore.setState({ flows: [], fetchFlows: async () => {}, fetchActions: async () => {} });
    useTaskCreationStore.setState({
        newTaskOpen: true,
        newProjectOpen: false,
        parentTaskId: null,
        preferredProjectId: "web",
        prefill: null,
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = createRoot(container);
    root = mounted;
    await act(async () => mounted.render(<TaskCreationDialogHost />));

    await act(async () => setValue(byId("new-task-description"), "Look into it"));
    await act(async () => button("Create Task").click());

    expect(useTaskCreationStore.getState().newTaskOpen).toBe(true);
    expect((byId("new-task-description") as HTMLTextAreaElement).value).toBe("Look into it");
    expect(document.body.textContent).toContain("Backend remote is not connected");

    await act(async () => button("Create Task").click());
    expect(attempts).toBe(2);
    expect(useTaskCreationStore.getState().newTaskOpen).toBe(false);
});

test("a subtask of a task whose worktree is still being set up starts its agent once it is ready", async () => {
    const sessions: unknown[] = [];
    const pendingWorktree = { enabled: true, path: null, branch: "task/parent", pr: null };
    const parent: Scoped<Task> = { ...created, id: "parent", worktree: pendingWorktree };
    const child: Scoped<Task> = {
        ...created,
        id: "child",
        parentId: "parent",
        worktree: pendingWorktree,
    };
    useProjectStore.setState({ projects: [web] });
    useTaskStore.setState({
        tasks: [parent],
        // The real store lists the new task before the create resolves.
        createTask: async () => {
            useTaskStore.setState({ tasks: [parent, child] });
            return child;
        },
    });
    useFlowStore.setState({ flows: [], fetchFlows: async () => {}, fetchActions: async () => {} });
    useSessionStore.setState({
        createSession: async (owner) => {
            sessions.push(owner);
            return new Promise(() => {});
        },
    });
    useTaskCreationStore.setState({
        newTaskOpen: true,
        newProjectOpen: false,
        parentTaskId: "parent",
        preferredProjectId: "web",
        prefill: null,
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = createRoot(container);
    root = mounted;
    await act(async () => mounted.render(<TaskCreationDialogHost />));

    await act(async () => setValue(byId("new-task-description"), "Look into it"));
    await choose("new-task-start-with", "Claude Code");
    await act(async () => button("Create Subtask").click());
    expect(sessions).toEqual([]);

    const ready = { ...pendingWorktree, path: "/repo/web/.worktrees/parent" };
    await act(async () =>
        useTaskStore.setState({
            tasks: [
                { ...parent, worktree: ready },
                { ...child, worktree: ready },
            ],
        }),
    );
    expect(sessions).toEqual([{ taskId: "child" }]);
});

test("an earlier create settling does not close or clear a dialog reopened meanwhile", async () => {
    let settle: (task: Scoped<Task>) => void = () => {};
    useProjectStore.setState({ projects: [web] });
    useTaskStore.setState({
        tasks: [],
        createTask: () => new Promise((resolve) => (settle = resolve)),
    });
    useFlowStore.setState({ flows: [], fetchFlows: async () => {}, fetchActions: async () => {} });
    useTaskCreationStore.setState({
        newTaskOpen: true,
        newProjectOpen: false,
        parentTaskId: null,
        preferredProjectId: "web",
        prefill: null,
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = createRoot(container);
    root = mounted;
    await act(async () => mounted.render(<TaskCreationDialogHost />));

    await act(async () => setValue(byId("new-task-description"), "First"));
    await act(async () => button("Create Task").click());
    await act(async () => button("Cancel").click());
    expect(useTaskCreationStore.getState().newTaskOpen).toBe(false);

    await act(async () => useTaskCreationStore.setState({ newTaskOpen: true }));
    await act(async () => setValue(byId("new-task-description"), "Second"));
    await act(async () => settle(created));

    expect(useTaskCreationStore.getState().newTaskOpen).toBe(true);
    expect((byId("new-task-description") as HTMLTextAreaElement).value).toBe("Second");
    expect(button("Create Task").disabled).toBe(false);
});
