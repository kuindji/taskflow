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
} from "lucide-react";
import { useFileStore } from "@/stores/file-store";
import { useSessionStore } from "@/stores/session-store";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
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

    const handleReveal = useCallback(() => {
        void revealInFinder(filePath);
    }, [filePath, revealInFinder]);

    return (
        <>
            <ContextMenu>
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
