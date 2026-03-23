import type { FileNode } from "@taskflow/shared";

/** Returns a flat array of paths for all currently visible nodes in tree order.
 * The root node itself is not included (it represents the working directory and is not rendered).
 * Root is always in expandedDirs but skipped here — its children are the top-level visible items.
 */
function getVisibleItems(root: FileNode, expandedDirs: Set<string>): string[] {
    const result: string[] = [];

    function walk(node: FileNode) {
        result.push(node.path);
        if (node.type === "directory" && expandedDirs.has(node.path) && node.children) {
            for (const child of node.children) {
                walk(child);
            }
        }
    }

    // Root is always expanded, walk its children directly
    if (root.children) {
        for (const child of root.children) {
            walk(child);
        }
    }

    return result;
}

function getNextItem(
    root: FileNode,
    expandedDirs: Set<string>,
    currentPath: string,
): string | null {
    const items = getVisibleItems(root, expandedDirs);
    const idx = items.indexOf(currentPath);
    if (idx === -1 || idx === items.length - 1) return null;
    return items[idx + 1];
}

function getPreviousItem(
    root: FileNode,
    expandedDirs: Set<string>,
    currentPath: string,
): string | null {
    const items = getVisibleItems(root, expandedDirs);
    const idx = items.indexOf(currentPath);
    if (idx <= 0) return null;
    return items[idx - 1];
}

function getFirstItem(root: FileNode): string | null {
    if (!root.children || root.children.length === 0) return null;
    return root.children[0].path;
}

function getLastItem(root: FileNode, expandedDirs: Set<string>): string | null {
    const items = getVisibleItems(root, expandedDirs);
    if (items.length === 0) return null;
    return items[items.length - 1];
}

function getParentPath(root: FileNode, targetPath: string): string | null {
    let found: string | null = null;

    function walk(node: FileNode): boolean {
        if (node.children) {
            for (const child of node.children) {
                if (child.path === targetPath) {
                    // Don't return root path as parent (root is the working dir, not shown)
                    found = node.path === root.path ? null : node.path;
                    return true;
                }
                if (walk(child)) return true;
            }
        }
        return false;
    }

    walk(root);
    return found;
}

function findNode(root: FileNode, path: string): FileNode | null {
    if (root.path === path) return root;
    if (!root.children) return null;
    for (const child of root.children) {
        const found = findNode(child, path);
        if (found) return found;
    }
    return null;
}

export { getNextItem, getPreviousItem, getFirstItem, getLastItem, getParentPath, findNode };
