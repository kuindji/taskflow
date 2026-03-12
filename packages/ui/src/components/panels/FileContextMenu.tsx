import { type ReactNode, useState, useCallback } from "react";
import {
    ContextMenu,
    ContextMenuTrigger,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Pencil, Trash2, Copy, FileText, FolderOpen, ExternalLink } from "lucide-react";
import { useFileStore } from "@/stores/file-store";
import { RenameFileDialog } from "./RenameFileDialog";
import { DeleteFileDialog } from "./DeleteFileDialog";

interface FileContextMenuProps {
    children: ReactNode;
    filePath: string;
    isDirectory: boolean;
    rootPath: string;
}

function FileContextMenu({ children, filePath, isDirectory, rootPath }: FileContextMenuProps) {
    const [renameOpen, setRenameOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const openExternal = useFileStore((s) => s.openExternal);
    const revealInFinder = useFileStore((s) => s.revealInFinder);

    const handleCopyPath = useCallback(() => {
        void navigator.clipboard.writeText(filePath);
    }, [filePath]);

    const handleCopyRelativePath = useCallback(() => {
        const relative = filePath.startsWith(rootPath + "/") ? filePath.slice(rootPath.length + 1) : filePath;
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
            <RenameFileDialog open={renameOpen} onOpenChange={setRenameOpen} filePath={filePath} isDirectory={isDirectory} />
            <DeleteFileDialog open={deleteOpen} onOpenChange={setDeleteOpen} filePath={filePath} isDirectory={isDirectory} />
        </>
    );
}

export { FileContextMenu };
