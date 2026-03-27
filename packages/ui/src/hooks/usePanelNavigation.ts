import { useEffect } from "react";
import { useUIStore, getOrderedPanels } from "@/stores/ui-store";
import { useTaskStore } from "@/stores/task-store";
import { useProjectStore } from "@/stores/project-store";
import { useFileStore } from "@/stores/file-store";
import { isDialogOpen, isEditableElement } from "@/lib/global-shortcuts";
import { getFirstItem } from "@/lib/tree-walker";

const PANEL_FOCUS_DEDUPE_MS = 150;

/**
 * Cycle the focused panel left or right through registered (visible) panels.
 * Also manages panel-specific side effects on entry/exit.
 */
function cycleFocus(direction: "left" | "right") {
    const state = useUIStore.getState();
    const panels = getOrderedPanels(state.registeredPanels);
    const current = state.focusedPanel;
    const idx = panels.indexOf(current);
    const next =
        direction === "right"
            ? panels[(idx + 1) % panels.length]
            : panels[(idx - 1 + panels.length) % panels.length];
    state.setFocusedPanel(next);

    // Clear sidebarFocusedItem when leaving sidebar
    if (current === "sidebar" && next !== "sidebar") {
        state.setSidebarFocusedItem(null);
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

/**
 * Global hook that owns panel-level keyboard navigation and modifier state.
 *
 * - Tracks `cmdHeld` and `navigationMode` in the UI store
 * - Handles Cmd+Shift+Arrow for panel cycling (outline only, no focus transfer)
 * - Handles Cmd+/ for shortcuts dialog
 * - Registers Electron IPC listeners for panel focus cycling
 *
 * Call once from AppShell.
 */
function usePanelNavigation() {
    useEffect(() => {
        const cleanupFns: Array<() => void> = [];
        let lastPanelFocusAt = 0;

        const triggerPanelFocus = (direction: "left" | "right") => {
            if (isDialogOpen()) return;
            if (isEditableElement(document.activeElement)) return;
            const now = Date.now();
            if (now - lastPanelFocusAt < PANEL_FOCUS_DEDUPE_MS) return;
            lastPanelFocusAt = now;
            cycleFocus(direction);
        };

        // --- Electron IPC bindings ---
        const onFocusPanelLeft = window.taskflow?.onFocusPanelLeft;
        const onFocusPanelRight = window.taskflow?.onFocusPanelRight;

        if (onFocusPanelLeft) {
            cleanupFns.push(
                onFocusPanelLeft(() => {
                    // Electron accelerator may consume modifier keydowns before
                    // they reach the renderer, so set navigationMode explicitly.
                    useUIStore.getState().setNavigationMode(true);
                    triggerPanelFocus("left");
                }),
            );
        }
        if (onFocusPanelRight) {
            cleanupFns.push(
                onFocusPanelRight(() => {
                    useUIStore.getState().setNavigationMode(true);
                    triggerPanelFocus("right");
                }),
            );
        }

        // --- Keyboard listeners ---
        const onKeyDown = (e: KeyboardEvent) => {
            const store = useUIStore.getState();

            // Track modifier state
            store.setCmdHeld(e.metaKey || e.ctrlKey);
            if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
                if (!store.navigationMode) store.setNavigationMode(true);
            }

            if (!(e.metaKey || e.ctrlKey)) return;
            if (isDialogOpen()) return;

            // Cmd+Shift+Left/Right: panel cycling
            if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                if (isEditableElement(document.activeElement)) return;
                e.preventDefault();
                triggerPanelFocus(e.key === "ArrowLeft" ? "left" : "right");
                return;
            }

            // Cmd+/: toggle keyboard shortcuts dialog
            if (e.key === "/" && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                store.toggleShortcutsDialog();
            }
        };

        const onKeyUp = (e: KeyboardEvent) => {
            const store = useUIStore.getState();

            store.setCmdHeld(e.metaKey || e.ctrlKey);

            // Exit navigation mode when Cmd or Shift is released.
            // Check both the released key name and the modifier flags
            // since Electron accelerators can swallow modifier events.
            if (store.navigationMode) {
                const modifierReleased =
                    e.key === "Shift" || e.key === "Meta" || e.key === "Control";
                const stillHeld = (e.metaKey || e.ctrlKey) && e.shiftKey;
                if (modifierReleased || !stillHeld) store.setNavigationMode(false);
            }
        };

        const onBlur = () => {
            const store = useUIStore.getState();
            store.setCmdHeld(false);
            if (store.navigationMode) store.setNavigationMode(false);
        };

        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        window.addEventListener("blur", onBlur);

        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("keyup", onKeyUp, true);
            window.removeEventListener("blur", onBlur);
            cleanupFns.forEach((fn) => fn());
        };
    }, []);
}

export { usePanelNavigation, cycleFocus };
