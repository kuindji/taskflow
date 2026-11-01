import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Project, Task } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";

// The description and notes fields are ExpandableTextareas, whose editor
// dialog loads monaco at import time (see NewTaskDialog.prefill.test.tsx).
await mock.module("@/components/ui/monaco-editor-dialog", () => ({
    MonacoEditorDialog: () => null,
}));

const { TaskInfoPanel } = await import("./TaskInfoPanel");

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BACKEND = "task-info-panel";
const task: Scoped<Task> = {
    backendId: BACKEND,
    id: "t1",
    projectId: "p1",
    title: "Original",
    description: "",
    notes: "",
    archivedAt: null,
    pinned: false,
    status: "active",
    sessions: [],
    attributes: [],
    worktree: { enabled: false, path: null, branch: null, pr: null },
    createdAt: "2026-11-01T00:00:00.000Z",
};
const project: Scoped<Project> = {
    backendId: BACKEND,
    id: "p1",
    name: "Project",
    path: "/repo",
    sessions: [],
    attributes: [],
    createdAt: "2026-11-01T00:00:00.000Z",
};

const saved: Partial<Task>[] = [];
let failNext = 0;
let holdReplies = false;
const originalTaskState = useTaskStore.getState();
const originalProjectState = useProjectStore.getState();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    saved.length = 0;
    failNext = 0;
    holdReplies = false;
    useProjectStore.setState({ projects: [project] });
    useUIStore.setState({ masterWorkspaceActive: false, activeProjectId: project.id });
    useTaskStore.setState({
        tasks: [task],
        activeTaskId: task.id,
        fetchTaskLog: () => Promise.resolve(),
        updateTask: (_target, updates) => {
            saved.push(updates);
            if (failNext > 0) {
                failNext--;
                return Promise.reject(new Error("Not connected"));
            }
            return holdReplies ? new Promise(() => {}) : Promise.resolve();
        },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(<TaskInfoPanel />);
    });
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    useTaskStore.setState(originalTaskState, true);
    useProjectStore.setState(originalProjectState, true);
});

function typeTitle(text: string) {
    const input = container.querySelector<HTMLInputElement>("#task-info-title");
    if (!input) throw new Error("no title input");
    act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function notesField(): HTMLTextAreaElement {
    const field = container.querySelector<HTMLTextAreaElement>("#task-info-notes");
    if (!field) throw new Error("no notes field");
    return field;
}

function typeNotes(text: string) {
    const field = notesField();
    act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(field, text);
        field.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

/** The task record changing elsewhere, as a `TASK_UPDATED` broadcast lands. */
function receiveTask(changes: Partial<Task>) {
    act(() => {
        useTaskStore.setState({ tasks: [{ ...task, ...changes }] });
    });
}

async function settle(ms: number) {
    await act(async () => {
        await new Promise((r) => setTimeout(r, ms));
    });
}

test("an autosave that fails is sent again when the panel closes", async () => {
    failNext = 1;
    typeTitle("Edited");
    await settle(800);
    expect(saved).toEqual([{ title: "Edited" }]);

    act(() => {
        root.render(<div />);
    });
    await settle(0);

    expect(saved).toEqual([{ title: "Edited" }, { title: "Edited" }]);
});

test("an autosave that succeeds is not sent again when the panel closes", async () => {
    typeTitle("Edited");
    await settle(800);

    act(() => {
        root.render(<div />);
    });
    await settle(0);

    expect(saved).toEqual([{ title: "Edited" }]);
});

test("a note changed elsewhere replaces a clean draft and is not written back", async () => {
    receiveTask({ notes: "Agent note" });
    expect(notesField().value).toBe("Agent note");

    typeNotes("Agent note, mine");
    await settle(800);

    expect(saved).toEqual([{ notes: "Agent note, mine" }]);
});

test("a note changed elsewhere does not replace an unsaved edit", async () => {
    typeNotes("Mine");
    receiveTask({ notes: "Agent note" });
    expect(notesField().value).toBe("Mine");

    await settle(800);
    expect(saved).toEqual([{ notes: "Mine" }]);
});

test("a title changed elsewhere is not sent back by an edit of another field", async () => {
    receiveTask({ title: "Renamed" });
    typeNotes("Note");
    await settle(800);

    expect(saved).toEqual([{ notes: "Note" }]);
});

test("an older save's reply does not replace a newer note still in flight", async () => {
    holdReplies = true;
    typeNotes("First");
    await settle(800);
    typeNotes("Second");
    await settle(800);
    expect(saved).toEqual([{ notes: "First" }, { notes: "Second" }]);

    // The first save's reply lands while the second is still pending.
    receiveTask({ notes: "First" });
    expect(notesField().value).toBe("Second");
});
