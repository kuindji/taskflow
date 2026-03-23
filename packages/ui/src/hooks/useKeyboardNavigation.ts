import { useEffect } from "react";
import { useUIStore } from "@/stores/ui-store";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import { useProjectStore } from "@/stores/project-store";
import { getTaskWorkspaceKey, getProjectWorkspaceKey } from "@/hooks/useActiveWorkspace";
import { isDialogOpen, isEditableElement } from "@/lib/global-shortcuts";
import { getNextItem, getPreviousItem, getFirstItem, getLastItem, getParentPath, findNode } from "@/lib/tree-walker";
import { useFileStore } from "@/stores/file-store";

type PanelId = ReturnType<typeof useUIStore.getState>["focusedPanel"];
const PANEL_FOCUS_DEDUPE_MS = 150;

function getPanelOrder(): PanelId[] {
    const panels: PanelId[] = ["sidebar"];
    if (useUIStore.getState().fileExplorerOpen) panels.push("fileexplorer");
    panels.push("workspace");
    if (useUIStore.getState().taskInfoOpen) panels.push("taskinfo");
    return panels;
}

function cycleFocus(direction: "left" | "right") {
    const panels = getPanelOrder();
    const current = useUIStore.getState().focusedPanel;
    const idx = panels.indexOf(current);
    const next =
        direction === "right"
            ? panels[(idx + 1) % panels.length]
            : panels[(idx - 1 + panels.length) % panels.length];
    useUIStore.getState().setFocusedPanel(next);

    // Clear sidebarFocusedItem when leaving sidebar
    if (current === "sidebar" && next !== "sidebar") {
        useUIStore.getState().setSidebarFocusedItem(null);
    }

    // Clear focusedPath when leaving file explorer
    if (current === "fileexplorer" && next !== "fileexplorer") {
        useFileStore.getState().setFocusedPath(null);
    }

    // When entering file explorer via panel cycling, set focus to first item
    if (next === "fileexplorer") {
        const { tree, focusedPath, setFocusedPath } = useFileStore.getState();
        if (tree && !focusedPath) {
            const first = getFirstItem(tree);
            if (first) setFocusedPath(first);
        }
    }

    // When focusing sidebar, set sidebarFocusedItem based on active task/project
    // (falls back to first project so badges always appear)
    if (next === "sidebar") {
        const { activeTaskId } = useTaskStore.getState();
        const { activeProjectId } = useUIStore.getState();
        if (activeTaskId) {
            useUIStore.getState().setSidebarFocusedItem({ type: "task", id: activeTaskId });
        } else if (activeProjectId) {
            useUIStore.getState().setSidebarFocusedItem({ type: "project", id: activeProjectId });
        } else {
            const { projects } = useProjectStore.getState();
            if (projects.length > 0) {
                useUIStore
                    .getState()
                    .setSidebarFocusedItem({ type: "project", id: projects[0].id });
            }
        }
    }
}

function handleWorkspaceNumber(n: number) {
    const state = useSessionStore.getState();
    const { activeTaskId } = useTaskStore.getState();
    const { activeProjectId } = useUIStore.getState();
    const workspaceKey = activeTaskId
        ? getTaskWorkspaceKey(activeTaskId)
        : activeProjectId
          ? getProjectWorkspaceKey(activeProjectId)
          : null;
    if (!workspaceKey) return;

    const tabs = state.tabsByWorkspace[workspaceKey];
    if (!tabs || n > tabs.length) return;
    state.setActiveTab(workspaceKey, tabs[n - 1].id);
}

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
            // Move focus to parent project and select it
            const task = tasks.find((t) => t.id === sidebarFocusedItem.id);
            if (task) {
                useUIStore
                    .getState()
                    .setSidebarFocusedItem({ type: "project", id: task.projectId });
                useUIStore.getState().setActiveProject(task.projectId);
                useTaskStore.getState().setActiveTask(null);
            }
        } else {
            // Collapse project
            useUIStore.getState().setProjectCollapsed(sidebarFocusedItem.id, true);
        }
        return;
    }

    if (key === "ArrowRight") {
        if (!sidebarFocusedItem || sidebarFocusedItem.type === "task") return;
        // Expand project
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

    // Also select the item
    if (nextItem.type === "project") {
        useUIStore.getState().setActiveProject(nextItem.id);
        useTaskStore.getState().setActiveTask(null);
    } else {
        const task = tasks.find((t) => t.id === nextItem.id);
        useTaskStore.getState().setActiveTask(nextItem.id);
        useUIStore.getState().setActiveProject(task?.projectId ?? null);
    }
}

function handleFileExplorerArrow(key: string) {
    const { tree, expandedDirs, focusedPath, setFocusedPath, expandDir, collapseDir } = useFileStore.getState();
    if (!tree) return;

    if (key === "ArrowDown") {
        if (!focusedPath) {
            const first = getFirstItem(tree);
            if (first) setFocusedPath(first);
            return;
        }
        const next = getNextItem(tree, expandedDirs, focusedPath);
        if (next) setFocusedPath(next);
        return;
    }

    if (key === "ArrowUp") {
        if (!focusedPath) {
            const first = getFirstItem(tree);
            if (first) setFocusedPath(first);
            return;
        }
        const prev = getPreviousItem(tree, expandedDirs, focusedPath);
        if (prev) setFocusedPath(prev);
        return;
    }

    if (key === "ArrowRight") {
        if (!focusedPath) return;
        const node = findNode(tree, focusedPath);
        if (!node || node.type !== "directory") return;
        if (!expandedDirs.has(focusedPath)) {
            // Expand and focus first child when loaded
            const pathAtExpand = focusedPath;
            void expandDir(focusedPath).then(() => {
                // Guard: if user navigated away during load, don't move focus
                if (useFileStore.getState().focusedPath !== pathAtExpand) return;
                const updatedTree = useFileStore.getState().tree;
                if (!updatedTree) return;
                const updatedNode = findNode(updatedTree, pathAtExpand);
                if (updatedNode?.children?.[0]) {
                    useFileStore.getState().setFocusedPath(updatedNode.children[0].path);
                }
            });
        } else if (node.children?.[0]) {
            setFocusedPath(node.children[0].path);
        }
        return;
    }

    if (key === "ArrowLeft") {
        if (!focusedPath) return;
        const node = findNode(tree, focusedPath);
        if (node?.type === "directory" && expandedDirs.has(focusedPath)) {
            collapseDir(focusedPath);
        } else {
            const parent = getParentPath(tree, focusedPath);
            if (parent) setFocusedPath(parent);
        }
        return;
    }
}

function handleFileExplorerEnter() {
    const { tree, focusedPath } = useFileStore.getState();
    if (!tree || !focusedPath) return;
    const node = findNode(tree, focusedPath);
    if (!node) return;

    if (node.type === "directory") {
        useFileStore.getState().toggleDir(focusedPath);
    } else {
        useFileStore.getState().onOpenFile?.(focusedPath);
    }
}

const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

export function useKeyboardNavigation() {
    useEffect(() => {
        const cleanupFns: Array<() => void> = [];
        let lastPanelFocusAt = 0;
        let pendingTaskInfoAutofocus = false;

        const triggerPanelFocus = (direction: "left" | "right") => {
            if (isDialogOpen()) return;
            if (isEditableElement(document.activeElement)) {
                pendingTaskInfoAutofocus = false;
                return;
            }
            const now = Date.now();
            if (now - lastPanelFocusAt < PANEL_FOCUS_DEDUPE_MS) {
                pendingTaskInfoAutofocus = false;
                return;
            }
            lastPanelFocusAt = now;
            cycleFocus(direction);
            pendingTaskInfoAutofocus = useUIStore.getState().focusedPanel === "taskinfo";
        };

        // Register Electron IPC listeners for panel focus cycling
        const onFocusPanelLeft = window.taskflow?.onFocusPanelLeft;
        const onFocusPanelRight = window.taskflow?.onFocusPanelRight;

        if (onFocusPanelLeft) {
            cleanupFns.push(onFocusPanelLeft(() => triggerPanelFocus("left")));
        }
        if (onFocusPanelRight) {
            cleanupFns.push(onFocusPanelRight(() => triggerPanelFocus("right")));
        }

        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            if (isDialogOpen()) return;

            // Cmd+Shift+Left/Right: panel focus cycling
            if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                if (isEditableElement(document.activeElement)) return;
                e.preventDefault();
                triggerPanelFocus(e.key === "ArrowLeft" ? "left" : "right");
                return;
            }

            // Cmd+0: master workspace (sidebar only)
            if (e.key === "0" && !e.shiftKey && !e.altKey) {
                const { focusedPanel } = useUIStore.getState();
                if (focusedPanel === "sidebar") {
                    e.preventDefault();
                    useTaskStore.getState().setActiveTask(null);
                    useUIStore.getState().setActiveProject(null);
                    useUIStore.getState().setMasterWorkspaceActive(true);
                    useUIStore.getState().setSidebarFocusedItem(null);
                }
                return;
            }

            // Cmd+1..9: context-sensitive number navigation
            const digit = parseInt(e.key, 10);
            if (digit >= 1 && digit <= 9 && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                const { focusedPanel } = useUIStore.getState();
                if (focusedPanel === "workspace") {
                    handleWorkspaceNumber(digit);
                } else if (focusedPanel === "sidebar") {
                    handleSidebarNumber(digit);
                }
                return;
            }

            // Cmd+/: toggle keyboard shortcuts dialog
            if (e.key === "/" && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                useUIStore.getState().toggleShortcutsDialog();
                return;
            }

            // Cmd+Enter: open focused file / toggle focused folder
            if (e.key === "Enter" && useUIStore.getState().focusedPanel === "fileexplorer") {
                if (isEditableElement(document.activeElement)) return;
                e.preventDefault();
                handleFileExplorerEnter();
                return;
            }

            // Cmd+Home/End: jump to first/last item in file explorer
            if ((e.key === "Home" || e.key === "End") && useUIStore.getState().focusedPanel === "fileexplorer") {
                if (isEditableElement(document.activeElement)) return;
                e.preventDefault();
                const { tree, expandedDirs, setFocusedPath } = useFileStore.getState();
                if (!tree) return;
                const target = e.key === "Home" ? getFirstItem(tree) : getLastItem(tree, expandedDirs);
                if (target) setFocusedPath(target);
                return;
            }

            // Cmd+Arrow: file explorer navigation (only when file explorer focused)
            if (useUIStore.getState().focusedPanel === "fileexplorer" && ARROW_KEYS.includes(e.key)) {
                if (isEditableElement(document.activeElement)) return;
                e.preventDefault();
                handleFileExplorerArrow(e.key);
                return;
            }

            // Cmd+Arrow: sidebar navigation (only when sidebar focused)
            if (useUIStore.getState().focusedPanel === "sidebar" && ARROW_KEYS.includes(e.key)) {
                if (isEditableElement(document.activeElement)) return;
                e.preventDefault();
                handleSidebarArrow(e.key);
                return;
            }
        };

        // After keyboard focus cycling lands in taskinfo, focus the first field once
        // when the modifier key is released.
        const onKeyUp = (e: KeyboardEvent) => {
            if (isDialogOpen()) return;
            if (
                pendingTaskInfoAutofocus &&
                e.key === "Meta" &&
                useUIStore.getState().focusedPanel === "taskinfo"
            ) {
                pendingTaskInfoAutofocus = false;
                requestAnimationFrame(() => {
                    const panel = document.querySelector('[data-panel="taskinfo"]');
                    const input = panel?.querySelector(
                        "input, textarea, select",
                    ) as HTMLElement | null;
                    input?.focus();
                });
            }
        };

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);

        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            cleanupFns.forEach((fn) => fn());
        };
    }, []);
}
