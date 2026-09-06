import { beforeEach, describe, expect, it } from "bun:test";
import type { Project } from "@taskflow/shared";
import { useProjectStore } from "./project-store";
import { useTaskCreationStore } from "./task-creation-store";

function project(id: string): Project {
    return {
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
