import { useEffect, useRef } from "react";
import type { Project, Task } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import { useUIStore } from "@/stores/ui-store";
import { useTaskStore } from "@/stores/task-store";
import { isDialogOpen, isEditableElement } from "@/lib/global-shortcuts";
import { groupTasksByParent } from "../task-groups";

const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

/** The sidebar's listed tasks (live or archived) per project id. */
type ShownTasks = ReadonlyMap<string, Scoped<Task>[]>;

function findShownTask(shownTasks: ShownTasks, id: string): Scoped<Task> | undefined {
    for (const list of shownTasks.values()) {
        const task = list.find((t) => t.id === id);
        if (task) return task;
    }
    return undefined;
}

/** A project's task rows, in the order ProjectGroup renders them. */
function taskRows(shownTasks: ShownTasks, projectId: string): Scoped<Task>[] {
    return groupTasksByParent(shownTasks.get(projectId) ?? []).topLevelTasks;
}

function handleSidebarNumber(
    n: number,
    visibleProjects: readonly Scoped<Project>[],
    shownTasks: ShownTasks,
) {
    const { sidebarFocusedItem } = useUIStore.getState();
    if (!sidebarFocusedItem) return;

    if (sidebarFocusedItem.type === "project") {
        if (n > visibleProjects.length) return;
        const target = visibleProjects[n - 1];
        useUIStore.getState().setActiveProject(target.id);
        useTaskStore.getState().setActiveTask(null);
        useUIStore.getState().setSidebarFocusedItem({ type: "project", id: target.id });
    } else {
        const task = findShownTask(shownTasks, sidebarFocusedItem.id);
        if (!task) return;
        // Bail if task's project is collapsed (no visible badges)
        if (useUIStore.getState().collapsedProjectIds.includes(task.projectId)) return;
        const projectTasks = taskRows(shownTasks, task.projectId);
        if (n > projectTasks.length) return;
        const target = projectTasks[n - 1];
        useTaskStore.getState().setActiveTask(target.id);
        useUIStore.getState().setActiveProject(target.projectId);
        useUIStore.getState().setSidebarFocusedItem({ type: "task", id: target.id });
    }
}

function handleSidebarArrow(
    key: string,
    visibleProjects: readonly Scoped<Project>[],
    shownTasks: ShownTasks,
) {
    const { sidebarFocusedItem, collapsedProjectIds } = useUIStore.getState();

    if (key === "ArrowLeft") {
        if (!sidebarFocusedItem) return;
        if (sidebarFocusedItem.type === "task") {
            const task = findShownTask(shownTasks, sidebarFocusedItem.id);
            if (task) {
                useUIStore
                    .getState()
                    .setSidebarFocusedItem({ type: "project", id: task.projectId });
                useUIStore.getState().setActiveProject(task.projectId);
                useTaskStore.getState().setActiveTask(null);
            }
        } else {
            useUIStore.getState().setProjectCollapsed(sidebarFocusedItem.id, true);
        }
        return;
    }

    if (key === "ArrowRight") {
        if (!sidebarFocusedItem || sidebarFocusedItem.type === "task") return;
        useUIStore.getState().setProjectCollapsed(sidebarFocusedItem.id, false);
        return;
    }

    // ArrowUp / ArrowDown — build flat list of visible items
    const visibleItems: Array<{ type: "project" | "task"; id: string }> = [];
    for (const project of visibleProjects) {
        visibleItems.push({ type: "project", id: project.id });
        if (!collapsedProjectIds.includes(project.id)) {
            for (const task of taskRows(shownTasks, project.id)) {
                visibleItems.push({ type: "task", id: task.id });
            }
        }
    }

    if (!sidebarFocusedItem) {
        if (visibleItems.length > 0) {
            const item = visibleItems[0];
            useUIStore.getState().setSidebarFocusedItem(item);
            if (item.type === "project") {
                useUIStore.getState().setActiveProject(item.id);
                useTaskStore.getState().setActiveTask(null);
            } else {
                const task = findShownTask(shownTasks, item.id);
                useTaskStore.getState().setActiveTask(item.id);
                useUIStore.getState().setActiveProject(task?.projectId ?? null);
            }
        }
        return;
    }

    const currentIdx = visibleItems.findIndex(
        (i) => i.type === sidebarFocusedItem.type && i.id === sidebarFocusedItem.id,
    );
    if (currentIdx === -1) return;

    const nextIdx = key === "ArrowUp" ? currentIdx - 1 : currentIdx + 1;
    if (nextIdx < 0 || nextIdx >= visibleItems.length) return;

    const nextItem = visibleItems[nextIdx];
    useUIStore.getState().setSidebarFocusedItem(nextItem);

    if (nextItem.type === "project") {
        useUIStore.getState().setActiveProject(nextItem.id);
        useTaskStore.getState().setActiveTask(null);
    } else {
        const task = findShownTask(shownTasks, nextItem.id);
        useTaskStore.getState().setActiveTask(nextItem.id);
        useUIStore.getState().setActiveProject(task?.projectId ?? null);
    }
}

/**
 * Keyboard navigation for the sidebar panel.
 * Active when focusedPanel === "sidebar" and navigation mode is off.
 * Handles: Cmd+Arrow (navigate items), Cmd+0-9 (quick select).
 *
 * `shownProjects` is the sidebar's own top-to-bottom list, so navigation and
 * number badges follow the machine sections rather than the store's load order.
 * `shownTasks` is what those projects list: the archived tasks in the archive view.
 */
function useSidebarNavigation(shownProjects: readonly Scoped<Project>[], shownTasks: ShownTasks) {
    const shownRef = useRef(shownProjects);
    const shownTasksRef = useRef(shownTasks);
    useEffect(() => {
        shownRef.current = shownProjects;
        shownTasksRef.current = shownTasks;
    }, [shownProjects, shownTasks]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
            if (isDialogOpen() || isEditableElement(document.activeElement)) return;

            const state = useUIStore.getState();
            if (state.focusedPanel !== "sidebar" || state.navigationMode) return;

            if (ARROW_KEYS.includes(e.key)) {
                e.preventDefault();
                handleSidebarArrow(e.key, shownRef.current, shownTasksRef.current);
                return;
            }

            // Cmd+0: master workspace
            if (e.key === "0" && !e.altKey) {
                e.preventDefault();
                useTaskStore.getState().setActiveTask(null);
                state.setActiveProject(null);
                state.setMasterWorkspaceActive(true);
                state.setSidebarFocusedItem(null);
                return;
            }

            const digit = parseInt(e.key, 10);
            if (digit >= 1 && digit <= 9 && !e.altKey) {
                e.preventDefault();
                handleSidebarNumber(digit, shownRef.current, shownTasksRef.current);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);
}

export { useSidebarNavigation };
