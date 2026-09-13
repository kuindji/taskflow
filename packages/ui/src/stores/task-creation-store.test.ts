import { beforeEach, describe, expect, it } from "bun:test";
import type { Project, Task } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import { useProjectStore } from "./project-store";
import { taskCreationBackend, useTaskCreationStore } from "./task-creation-store";

function project(id: string): Scoped<Project> {
    return {
        backendId: "local",
        id,
        name: id,
        path: `/tmp/${id}`,
        sessions: [],
        attributes: [],
        createdAt: "2026-08-31T00:00:00.000Z",
    };
}

describe("task creation prefill", () => {
    beforeEach(() => {
        useProjectStore.setState({ projects: [project("web")] });
        useTaskCreationStore.setState({
            newTaskOpen: false,
            newProjectOpen: false,
            openTaskAfterProject: false,
            projectError: null,
            parentTaskId: null,
            preferredProjectId: null,
            prefill: null,
        });
    });

    it("opens the task dialog carrying the dropped fields", () => {
        useTaskCreationStore
            .getState()
            .requestNewTaskWithPrefill({ title: "Checkout redesign", description: "Body." }, "web");

        const state = useTaskCreationStore.getState();
        expect(state.newTaskOpen).toBe(true);
        expect(state.preferredProjectId).toBe("web");
        expect(state.prefill).toEqual({ title: "Checkout redesign", description: "Body." });
    });

    it("leaves the project unpinned when the drop did not land on one", () => {
        useTaskCreationStore.getState().requestNewTaskWithPrefill({ description: "Body." });

        expect(useTaskCreationStore.getState().preferredProjectId).toBeNull();
    });

    // A drop made before any project exists detours through the project dialog.
    // Losing the text on that hop would silently throw away what was dropped.
    it("keeps the dropped fields across the add-a-project detour", () => {
        useProjectStore.setState({ projects: [] });

        useTaskCreationStore.getState().requestNewTaskWithPrefill({ description: "Body." });
        expect(useTaskCreationStore.getState().newProjectOpen).toBe(true);
        expect(useTaskCreationStore.getState().newTaskOpen).toBe(false);

        useTaskCreationStore.getState().handleProjectCreated();

        const state = useTaskCreationStore.getState();
        expect(state.newTaskOpen).toBe(true);
        expect(state.prefill).toEqual({ description: "Body." });
    });

    it("drops the fields when the dialog closes", () => {
        useTaskCreationStore.getState().requestNewTaskWithPrefill({ description: "Body." });
        useTaskCreationStore.getState().setNewTaskOpen(false);

        expect(useTaskCreationStore.getState().prefill).toBeNull();
    });

    it("does not leak the fields into a plain new-task request", () => {
        useTaskCreationStore.getState().requestNewTaskWithPrefill({ description: "Body." });
        useTaskCreationStore.getState().requestNewTask("web");

        expect(useTaskCreationStore.getState().prefill).toBeNull();
    });

    it("does not leak the fields into a new subtask", () => {
        useTaskCreationStore.getState().requestNewTaskWithPrefill({ description: "Body." });
        useTaskCreationStore.getState().requestNewSubtask("web-1");

        expect(useTaskCreationStore.getState().prefill).toBeNull();
    });
});

describe("the machine a new task is created on", () => {
    function scopedProject(id: string, backendId: string): Scoped<Project> {
        return { ...project(id), backendId };
    }

    function scopedTask(id: string, projectId: string, backendId: string): Scoped<Task> {
        return {
            backendId,
            id,
            projectId,
            title: id,
            description: "",
            notes: "",
            worktree: { enabled: false, path: null, branch: null, pr: null },
            sessions: [],
            attributes: [],
            createdAt: "2026-09-13T00:00:00.000Z",
            status: "active",
            archivedAt: null,
            pinned: false,
        };
    }

    const projects = [scopedProject("pa", "a"), scopedProject("pb", "b")];
    const tasks = [scopedTask("tb", "pb", "b")];

    it("is the project's machine for a task", () => {
        expect(taskCreationBackend({ projectId: "pb" }, projects, tasks)).toBe("b");
    });

    // The dialog's project for a subtask is whatever was selected, which can be
    // another machine's project; the machine that holds the parent must get it.
    it("is the parent task's machine for a subtask, whatever project is selected", () => {
        expect(taskCreationBackend({ projectId: "pa", parentId: "tb" }, projects, tasks)).toBe("b");
    });
});
