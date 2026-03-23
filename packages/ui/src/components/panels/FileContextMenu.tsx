import { type ReactNode, useState, useCallback } from "react";
import {
    ContextMenu,
    ContextMenuTrigger,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
    Pencil,
    Trash2,
    Copy,
    FileText,
    FolderOpen,
    ExternalLink,
    FilePlus,
    FolderPlus,
    Eye,
    Terminal,
} from "lucide-react";
import { MSG } from "@taskflow/shared";
import type { ShellListResponse } from "@taskflow/shared";
import { useFileStore } from "@/stores/file-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { sendRequest } from "@/hooks/useWebSocket";
import { DEFAULT_TERMINAL_SHELL } from "@taskflow/shared";
import { getShellSessionLabel, resolveTerminalShellPath } from "@/lib/terminal-shells";
import { RenameFileDialog } from "./RenameFileDialog";
import { DeleteFileDialog } from "./DeleteFileDialog";
import { CreateFileDialog } from "./CreateFileDialog";

interface FileContextMenuProps {
    children: ReactNode;
    filePath: string;
    isDirectory: boolean;
    rootPath: string;
}

function FileContextMenu({ children, filePath, isDirectory, rootPath }: FileContextMenuProps) {
    const [renameOpen, setRenameOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [createFileOpen, setCreateFileOpen] = useState(false);
    const [createFolderOpen, setCreateFolderOpen] = useState(false);
    const openExternal = useFileStore((s) => s.openExternal);
    const revealInFinder = useFileStore((s) => s.revealInFinder);
    const setContextMenuPath = useFileStore((s) => s.setContextMenuPath);
    const createSession = useSessionStore((s) => s.createSession);
    const configuredShell = useSettingsStore(
        (s) => s.settings?.terminal.defaultShell ?? DEFAULT_TERMINAL_SHELL,
    );

    const handleOpenChange = useCallback(
        (open: boolean) => {
            setContextMenuPath(open ? filePath : null);
        },
        [setContextMenuPath, filePath],
    );
    const workspace = useActiveWorkspace();

    const isMarkdown = !isDirectory && filePath.endsWith(".md");

    const handlePreviewMarkdown = useCallback(() => {
        const workspaceKey = workspace.workspaceKey;
        if (!workspaceKey) return;
        const store = useSessionStore.getState();
        const existingTabs = store.tabsByWorkspace[workspaceKey] ?? [];
        const existing = existingTabs.find((t) => t.type === "markdown" && t.filePath === filePath);
        if (existing) {
            store.setActiveTab(workspaceKey, existing.id);
            return;
        }
        const label = filePath.split("/").pop() ?? filePath;
        store.addTab(workspaceKey, {
            id: crypto.randomUUID(),
            type: "markdown",
            label,
            filePath,
        });
    }, [filePath, workspace.workspaceKey]);

    const handleCopyPath = useCallback(() => {
        void navigator.clipboard.writeText(filePath);
    }, [filePath]);

    const handleCopyRelativePath = useCallback(() => {
        const relative = filePath.startsWith(rootPath + "/")
            ? filePath.slice(rootPath.length + 1)
            : filePath;
        void navigator.clipboard.writeText(relative);
    }, [filePath, rootPath]);

    const handleOpenExternal = useCallback(() => {
        void openExternal(filePath);
    }, [filePath, openExternal]);

    const handleOpenInTerminal = useCallback(async () => {
        if (!workspace.scope) return;
        const res = await sendRequest<ShellListResponse>(MSG.SHELLS_LIST, {});
        const shell = resolveTerminalShellPath(res.shells, res.systemShellPath, configuredShell);
        if (!shell) return;
        const targetDir = isDirectory ? filePath : filePath.substring(0, filePath.lastIndexOf("/"));
        const owner =
            workspace.scope === "task"
                ? { taskId: workspace.task.id }
                : workspace.scope === "project"
                  ? { projectId: workspace.project.id }
                  : { master: true as const };
        await createSession(
            owner,
            "shell",
            getShellSessionLabel(shell),
            undefined,
            shell,
            undefined,
            undefined,
            targetDir,
        );
    }, [filePath, isDirectory, workspace, configuredShell, createSession]);

    const handleReveal = useCallback(() => {
        void revealInFinder(filePath);
    }, [filePath, revealInFinder]);

    return (
        <>
            <ContextMenu onOpenChange={handleOpenChange}>
                <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
                <ContextMenuContent>
                    {isDirectory && (
                        <>
                            <ContextMenuItem onSelect={() => setCreateFileOpen(true)}>
                                <FilePlus />
                                New File
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => setCreateFolderOpen(true)}>
                                <FolderPlus />
                                New Folder
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                        </>
                    )}
                    <ContextMenuItem onSelect={() => setRenameOpen(true)}>
                        <Pencil />
                        Rename
                    </ContextMenuItem>
                    <ContextMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                        <Trash2 />
                        Delete
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={handleCopyPath}>
                        <Copy />
                        Copy Path
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={handleCopyRelativePath}>
                        <FileText />
                        Copy Relative Path
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    {isMarkdown && (
                        <ContextMenuItem onSelect={handlePreviewMarkdown}>
                            <Eye />
                            Preview Markdown
                        </ContextMenuItem>
                    )}
                    {!isDirectory && (
                        <ContextMenuItem onSelect={handleOpenExternal}>
                            <ExternalLink />
                            Open in External Editor
                        </ContextMenuItem>
                    )}
                    <ContextMenuItem onSelect={handleReveal}>
                        <FolderOpen />
                        Reveal in Finder
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={handleOpenInTerminal}>
                        <Terminal />
                        Open in Terminal
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
            <RenameFileDialog
                open={renameOpen}
                onOpenChange={setRenameOpen}
                filePath={filePath}
                isDirectory={isDirectory}
            />
            <DeleteFileDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                filePath={filePath}
                isDirectory={isDirectory}
            />
            <CreateFileDialog
                open={createFileOpen}
                onOpenChange={setCreateFileOpen}
                directoryPath={filePath}
                mode="file"
            />
            <CreateFileDialog
                open={createFolderOpen}
                onOpenChange={setCreateFolderOpen}
                directoryPath={filePath}
                mode="directory"
            />
        </>
    );
}

export { FileContextMenu };
