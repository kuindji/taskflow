import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Project, Task } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";
import { useSidebarNavigation } from "./useSidebarNavigation";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const project: Scoped<Project> = {
    id: "p1",
    name: "p1",
    path: "/repo/p1",
    sessions: [],
    attributes: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    backendId: "a",
};

function task(id: string, status: Task["status"], parentId?: string): Scoped<Task> {
    return {
        id,
        projectId: "p1",
        ...(parentId ? { parentId } : {}),
        title: id,
        description: "",
        notes: "",
        worktree: { enabled: false, path: null, branch: null, pr: null },
        sessions: [],
        attributes: [],
        createdAt: "2026-11-01T00:00:00.000Z",
        status,
        archivedAt: status === "archived" ? "2026-11-01T00:00:00.000Z" : null,
        pinned: false,
        backendId: "a",
    };
}

function Nav({ shownTasks }: { shownTasks: ReadonlyMap<string, Scoped<Task>[]> }) {
    useSidebarNavigation([project], shownTasks);
    return null;
}

let root: Root | null = null;
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    useTaskStore.setState({ tasks: [], archivedTasks: [], activeTaskId: null });
    useUIStore.getState().setSidebarFocusedItem(null);
});

function press(key: string) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: true }));
}

test("in the archive view arrows walk the archived rows, not the live tasks", async () => {
    const active = task("active-task", "active");
    const archivedSubtask = task("archived-sub", "archived", "active-task");
    const archivedTask = task("archived-task", "archived");
    useTaskStore.setState({ tasks: [active], archivedTasks: [archivedSubtask, archivedTask] });
    useUIStore.setState({
        focusedPanel: "sidebar",
        navigationMode: false,
        collapsedProjectIds: [],
    });
    useUIStore.getState().setSidebarFocusedItem({ type: "project", id: "p1" });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = createRoot(container);
    root = mounted;
    const shown = new Map([["p1", [archivedSubtask, archivedTask]]]);
    await act(async () => mounted.render(<Nav shownTasks={shown} />));

    // A subtask archived alone has its own row.
    act(() => press("ArrowDown"));
    expect(useTaskStore.getState().activeTaskId).toBe("archived-sub");
    act(() => press("ArrowDown"));
    expect(useTaskStore.getState().activeTaskId).toBe("archived-task");
    act(() => press("1"));
    expect(useTaskStore.getState().activeTaskId).toBe("archived-sub");
});
