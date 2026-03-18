import { useEffect, useMemo } from "react";
import type { FileNode } from "@taskflow/shared";
import ignore from "ignore";
import { X } from "lucide-react";
import { useFileStore } from "@/stores/file-store";
import { useUIStore } from "@/stores/ui-store";
import { openFileInApp } from "@/lib/open-file";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/ui/toolbar";
import useIsElectron from "@/hooks/useIsElectron";
import { FileTree } from "./FileTree";

function FileExplorer() {
    const {
        tree,
        treePath,
        gitignorePatterns,
        gitStatus,
        gitStatusPath,
        fetchTree,
        fetchGitStatus,
        watchPath,
        unwatchPath,
        clearExplorerState,
    } = useFileStore();
    const workspace = useActiveWorkspace();
    const toggleFileExplorer = useUIStore((s) => s.toggleFileExplorer);
    const workingDir = workspace.workingDir;
    const isElectron = useIsElectron();

    const expandToPath = useFileStore((s) => s.expandToPath);
    const setExpandToPath = useFileStore((s) => s.setExpandToPath);

    const expandedPaths = useMemo(() => {
        if (!expandToPath || !workingDir) return null;
        const paths = new Set<string>();
        let current = expandToPath;
        while (current !== workingDir && current.length > workingDir.length) {
            paths.add(current);
            const lastSlash = current.lastIndexOf("/");
            if (lastSlash <= 0) break;
            current = current.slice(0, lastSlash);
        }
        return paths;
    }, [expandToPath, workingDir]);

    // Clear expandToPath after it has been consumed
    useEffect(() => {
        if (expandToPath) {
            const id = requestAnimationFrame(() => setExpandToPath(null));
            return () => cancelAnimationFrame(id);
        }
    }, [expandToPath, setExpandToPath]);

    useEffect(() => {
        if (!workingDir) {
            clearExplorerState();
            return;
        }

        void fetchTree(workingDir);
        void fetchGitStatus(workingDir);
        void watchPath(workingDir);

        return () => {
            void unwatchPath(workingDir);
        };
    }, [workingDir, clearExplorerState, fetchTree, fetchGitStatus, watchPath, unwatchPath]);

    const gitFiles = useMemo(() => {
        const map = new Map<string, string>();
        if (!workingDir || gitStatusPath !== workingDir) return map;
        // Staged first, then unstaged overwrites — unstaged reflects working tree
        gitStatus?.stagedFiles.forEach((f) => {
            const absolutePath =
                f.absolutePath ?? (workingDir ? `${workingDir}/${f.path}` : f.path);
            map.set(absolutePath, f.status);
        });
        gitStatus?.unstagedFiles.forEach((f) => {
            const absolutePath =
                f.absolutePath ?? (workingDir ? `${workingDir}/${f.path}` : f.path);
            map.set(absolutePath, f.status);
        });
        return map;
    }, [gitStatus, gitStatusPath, workingDir]);

    const ignoredFiles = useMemo(() => {
        if (!workingDir || !tree || treePath !== workingDir || gitignorePatterns.length === 0) {
            return new Set<string>();
        }

        const ig = ignore().add(gitignorePatterns);
        const result = new Set<string>();
        const prefix = workingDir + "/";

        function walk(node: FileNode) {
            if (node.path !== workingDir) {
                const relative = node.path.startsWith(prefix)
                    ? node.path.slice(prefix.length)
                    : null;
                if (relative && ig.ignores(relative)) {
                    result.add(node.path);
                    return; // children of ignored dirs are implicitly ignored
                }
            }
            if (node.children) {
                for (const child of node.children) {
                    walk(child);
                }
            }
        }

        walk(tree);
        return result;
    }, [workingDir, tree, treePath, gitignorePatterns]);

    const handleFileClick = (path: string) => {
        const owner = workspace.task
            ? { taskId: workspace.task.id }
            : workspace.project
              ? { projectId: workspace.project.id }
              : undefined;
        void openFileInApp(path, workspace.workspaceKey, owner);
    };

    return (
        <div className="flex h-full flex-col">
            <Toolbar className={`gap-2 ${isElectron ? "[-webkit-app-region:drag]" : ""}`}>
                <span className="text-muted-foreground ml-2 flex h-6 items-center text-xs font-medium">
                    Files
                </span>
                <div className="flex-1" />
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={toggleFileExplorer}
                    aria-label="Hide file explorer"
                    tooltip="Hide file explorer"
                    tooltipSide="bottom"
                    className="[-webkit-app-region:no-drag]">
                    <X className="h-3 w-3" />
                </Button>
            </Toolbar>
            <div className="flex-1 overflow-x-hidden overflow-y-auto py-1">
                {tree && treePath === workingDir ? (
                    <FileTree
                        node={tree}
                        gitFiles={gitFiles}
                        ignoredFiles={ignoredFiles}
                        onFileClick={handleFileClick}
                        expandedPaths={expandedPaths}
                        rootPath={workingDir ?? ""}
                    />
                ) : (
                    <div className="text-muted-foreground p-2 text-sm">
                        {workingDir ? "Loading..." : "Select a task or project"}
                    </div>
                )}
            </div>
        </div>
    );
}

export { FileExplorer };
