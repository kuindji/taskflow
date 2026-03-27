import { useEffect } from "react";
import { useUIStore } from "@/stores/ui-store";
import { useFileStore } from "@/stores/file-store";
import { isDialogOpen, isEditableElement } from "@/lib/global-shortcuts";
import {
    getNextItem,
    getPreviousItem,
    getFirstItem,
    getLastItem,
    getParentPath,
    findNode,
} from "@/lib/tree-walker";

const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

function handleFileExplorerArrow(key: string) {
    const { tree, expandedDirs, focusedPath, setFocusedPath, expandDir, collapseDir } =
        useFileStore.getState();
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
            const pathAtExpand = focusedPath;
            void expandDir(focusedPath).then(() => {
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

/**
 * Keyboard navigation for the file explorer panel.
 * Active when focusedPanel === "fileexplorer" and navigation mode is off.
 * Handles: Cmd+Arrow (navigate tree), Cmd+Enter (open/toggle), Cmd+Home/End.
 */
function useFileExplorerNavigation() {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
            if (isDialogOpen() || isEditableElement(document.activeElement)) return;

            const state = useUIStore.getState();
            if (state.focusedPanel !== "fileexplorer" || state.navigationMode) return;

            // Cmd+Enter: open focused file / toggle focused folder
            if (e.key === "Enter") {
                e.preventDefault();
                handleFileExplorerEnter();
                return;
            }

            // Cmd+Home/End: jump to first/last item
            if (e.key === "Home" || e.key === "End") {
                e.preventDefault();
                const { tree, expandedDirs, setFocusedPath } = useFileStore.getState();
                if (!tree) return;
                const target =
                    e.key === "Home" ? getFirstItem(tree) : getLastItem(tree, expandedDirs);
                if (target) setFocusedPath(target);
                return;
            }

            // Cmd+Arrow: tree navigation
            if (ARROW_KEYS.includes(e.key)) {
                e.preventDefault();
                handleFileExplorerArrow(e.key);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);
}

export { useFileExplorerNavigation };
