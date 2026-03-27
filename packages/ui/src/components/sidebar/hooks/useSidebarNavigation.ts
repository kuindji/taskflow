import { useEffect } from "react";
import { useUIStore } from "@/stores/ui-store";
import { useTaskStore } from "@/stores/task-store";
import { useProjectStore } from "@/stores/project-store";
import { isDialogOpen, isEditableElement } from "@/lib/global-shortcuts";

const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

function handleSidebarNumber(n: number) {
    const { sidebarFocusedItem } = useUIStore.getState();
    if (!sidebarFocusedItem) return;

    if (sidebarFocusedItem.type === "project") {
        const { projects } = useProjectStore.getState();
        if (n > projects.length) return;
        const target = projects[n - 1];
        useUIStore.getState().setActiveProject(target.id);
        useTaskStore.getState().setActiveTask(null);
        useUIStore.getState().setSidebarFocusedItem({ type: "project", id: target.id });
    } else {
        const task = useTaskStore.getState().tasks.find((t) => t.id === sidebarFocusedItem.id);
        if (!task) return;
        // Bail if task's project is collapsed (no visible badges)
        if (useUIStore.getState().collapsedProjectIds.includes(task.projectId)) return;
        const projectTasks = useTaskStore
            .getState()
            .tasks.filter((t) => t.projectId === task.projectId && !t.parentId);
        if (n > projectTasks.length) return;
        const target = projectTasks[n - 1];
        useTaskStore.getState().setActiveTask(target.id);
        useUIStore.getState().setActiveProject(target.projectId);
        useUIStore.getState().setSidebarFocusedItem({ type: "task", id: target.id });
    }
}

function handleSidebarArrow(key: string) {
    const { sidebarFocusedItem, collapsedProjectIds } = useUIStore.getState();
    const { projects } = useProjectStore.getState();
    const { tasks } = useTaskStore.getState();

    if (key === "ArrowLeft") {
        if (!sidebarFocusedItem) return;
        if (sidebarFocusedItem.type === "task") {
            const task = tasks.find((t) => t.id === sidebarFocusedItem.id);
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
    for (const project of projects) {
        visibleItems.push({ type: "project", id: project.id });
        if (!collapsedProjectIds.includes(project.id)) {
            const projectTasks = tasks.filter((t) => t.projectId === project.id && !t.parentId);
            for (const task of projectTasks) {
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
                const task = tasks.find((t) => t.id === item.id);
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
        const task = tasks.find((t) => t.id === nextItem.id);
        useTaskStore.getState().setActiveTask(nextItem.id);
        useUIStore.getState().setActiveProject(task?.projectId ?? null);
    }
}

/**
 * Keyboard navigation for the sidebar panel.
 * Active when focusedPanel === "sidebar" and navigation mode is off.
 * Handles: Cmd+Arrow (navigate items), Cmd+0-9 (quick select).
 */
function useSidebarNavigation() {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
            if (isDialogOpen() || isEditableElement(document.activeElement)) return;

            const state = useUIStore.getState();
            if (state.focusedPanel !== "sidebar" || state.navigationMode) return;

            if (ARROW_KEYS.includes(e.key)) {
                e.preventDefault();
                handleSidebarArrow(e.key);
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
                handleSidebarNumber(digit);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);
}

export { useSidebarNavigation };
