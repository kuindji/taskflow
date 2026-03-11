import { useEffect, useMemo } from "react";
import { useFileStore } from "@/stores/file-store";
import { useSessionStore } from "@/stores/session-store";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { FileTree } from "./FileTree";

function FileExplorer() {
    const {
        tree,
        treePath,
        gitStatus,
        gitStatusPath,
        fetchTree,
        fetchGitStatus,
        watchPath,
        unwatchPath,
        clearExplorerState,
    } = useFileStore();
    const workspace = useActiveWorkspace();
    const { addTab, getTabs, setActiveTab } = useSessionStore();
    const workingDir = workspace.workingDir;

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
        gitStatus?.files.forEach((f) => {
            const absolutePath =
                f.absolutePath ?? (workingDir ? `${workingDir}/${f.path}` : f.path);
            map.set(absolutePath, f.status);
        });
        return map;
    }, [gitStatus, gitStatusPath, workingDir]);

    const handleFileClick = (path: string) => {
        if (!workspace.workspaceKey) return;

        const existingTab = getTabs(workspace.workspaceKey).find(
            (tab) => tab.type === "editor" && tab.filePath === path,
        );
        if (existingTab) {
            setActiveTab(workspace.workspaceKey, existingTab.id);
            return;
        }

        addTab(workspace.workspaceKey, {
            id: crypto.randomUUID(),
            type: "editor",
            label: path.split("/").pop() ?? path,
            filePath: path,
        });
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center px-1.5 py-1.5">
                <span className="text-muted-foreground flex h-6 items-center text-xs font-medium">
                    Files
                </span>
            </div>
            <Separator />
            <ScrollArea className="flex-1 py-1">
                {tree && treePath === workingDir ? (
                    <FileTree node={tree} gitFiles={gitFiles} onFileClick={handleFileClick} />
                ) : (
                    <div className="text-muted-foreground p-2 text-sm">
                        {workingDir ? "Loading..." : "Select a task or project"}
                    </div>
                )}
            </ScrollArea>
        </div>
    );
}

export { FileExplorer };
