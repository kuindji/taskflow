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
    Terminal,
} from "lucide-react";
import { MSG } from "@taskflow/shared";
import type { ShellListResponse } from "@taskflow/shared";
import { useFileStore } from "@/stores/file-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { sendRequest } from "@/lib/connection-registry";
import { useWorkspaceBackend } from "@/hooks/useWorkspaceBackend";
import { useLocalOnlyHint } from "@/hooks/useIsLocalBackend";
import { DEFAULT_TERMINAL_SHELL } from "@taskflow/shared";
import { getShellSessionLabel, resolveTerminalShellPath } from "@/lib/terminal-shells";
import {
    getEventMenuPosition,
    showNativeMenuAndRun,
    supportsNativeMenus,
    type NativeMenuActionMap,
    type NativeMenuItem,
} from "@/lib/native-menu";
import { isMarkdownPath } from "@/lib/open-file-plan";
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
    // The terminal opens on the workspace's machine, with that machine's shell.
    const backendId = useWorkspaceBackend();
    // Opening externally and revealing happen on the backend's machine's desktop.
    const localOnlyHint = useLocalOnlyHint(backendId);
    const localOnlyLabel = localOnlyHint ? " (not on this machine)" : "";
    const configuredShell = useSettingsStore(
        (s) =>
            (backendId ? s.byBackend[backendId] : s.settings)?.terminal.defaultShell ??
            DEFAULT_TERMINAL_SHELL,
    );

    const handleOpenChange = useCallback(
        (open: boolean) => {
            setContextMenuPath(open ? filePath : null);
        },
        [setContextMenuPath, filePath],
    );
    const workspace = useActiveWorkspace();
    const nativeMenus = supportsNativeMenus();

    const isMarkdown = !isDirectory && isMarkdownPath(filePath);

    const handleOpenInEditor = useCallback(() => {
        const workspaceKey = workspace.workspaceKey;
        if (!workspaceKey) return;
        const store = useSessionStore.getState();
        const existingTabs = store.tabsByWorkspace[workspaceKey] ?? [];
        const existing = existingTabs.find((t) => t.type === "markdown" && t.filePath === filePath);
        if (existing) {
            store.setTabMode(workspaceKey, existing.id, "edit");
            store.setActiveTab(workspaceKey, existing.id);
            return;
        }
        const label = filePath.split("/").pop() ?? filePath;
        store.addTab(workspaceKey, {
            id: crypto.randomUUID(),
            type: "markdown",
            label,
            filePath,
            mode: "edit",
            history: [filePath],
            historyIndex: 0,
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
        if (!backendId || localOnlyHint) return;
        void openExternal(backendId, filePath);
    }, [backendId, filePath, localOnlyHint, openExternal]);

    const handleOpenInTerminal = useCallback(async () => {
        if (!workspace.scope || !backendId) return;
        const res = await sendRequest<ShellListResponse>(backendId, MSG.SHELLS_LIST, {});
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
    }, [filePath, isDirectory, workspace, backendId, configuredShell, createSession]);

    const handleReveal = useCallback(() => {
        if (!backendId || localOnlyHint) return;
        void revealInFinder(backendId, filePath);
    }, [backendId, filePath, localOnlyHint, revealInFinder]);

    const handleNativeContextMenu = useCallback(
        async (event: React.MouseEvent<HTMLDivElement>) => {
            event.preventDefault();
            setContextMenuPath(filePath);

            const items: NativeMenuItem[] = [];
            const actions: NativeMenuActionMap = {};

            if (isDirectory) {
                items.push(
                    { id: "new-file", label: "New File" },
                    { id: "new-folder", label: "New Folder" },
                    { type: "separator" },
                );
                actions["new-file"] = () => setCreateFileOpen(true);
                actions["new-folder"] = () => setCreateFolderOpen(true);
            }

            items.push(
                { id: "rename", label: "Rename" },
                { id: "delete", label: "Delete" },
                { type: "separator" },
                { id: "copy-path", label: "Copy Path" },
                { id: "copy-relative-path", label: "Copy Relative Path" },
                { type: "separator" },
            );

            actions.rename = () => setRenameOpen(true);
            actions.delete = () => setDeleteOpen(true);
            actions["copy-path"] = handleCopyPath;
            actions["copy-relative-path"] = handleCopyRelativePath;

            if (isMarkdown) {
                items.push({ id: "open-in-editor", label: "Open in Editor" });
                actions["open-in-editor"] = handleOpenInEditor;
            }

            if (!isDirectory) {
                items.push({
                    id: "open-external",
                    label: `Open in External Editor${localOnlyLabel}`,
                    enabled: !localOnlyHint,
                });
                actions["open-external"] = handleOpenExternal;
            }

            items.push(
                {
                    id: "reveal",
                    label: `Reveal in Finder${localOnlyLabel}`,
                    enabled: !localOnlyHint,
                },
                { id: "open-terminal", label: "Open in Terminal" },
            );

            actions.reveal = handleReveal;
            actions["open-terminal"] = () => void handleOpenInTerminal();

            try {
                await showNativeMenuAndRun(items, actions, getEventMenuPosition(event));
            } finally {
                setContextMenuPath(null);
            }
        },
        [
            filePath,
            handleCopyPath,
            handleCopyRelativePath,
            handleOpenExternal,
            handleOpenInTerminal,
            handleOpenInEditor,
            handleReveal,
            isDirectory,
            isMarkdown,
            localOnlyHint,
            localOnlyLabel,
            setContextMenuPath,
        ],
    );

    return (
        <>
            {nativeMenus ? (
                <div style={{ display: "contents" }} onContextMenu={handleNativeContextMenu}>
                    {children}
                </div>
            ) : (
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
                            <ContextMenuItem onSelect={handleOpenInEditor}>
                                <Pencil />
                                Open in Editor
                            </ContextMenuItem>
                        )}
                        {!isDirectory && (
                            <ContextMenuItem
                                disabled={localOnlyHint !== null}
                                title={localOnlyHint ?? undefined}
                                onSelect={handleOpenExternal}>
                                <ExternalLink />
                                Open in External Editor{localOnlyLabel}
                            </ContextMenuItem>
                        )}
                        <ContextMenuItem
                            disabled={localOnlyHint !== null}
                            title={localOnlyHint ?? undefined}
                            onSelect={handleReveal}>
                            <FolderOpen />
                            Reveal in Finder
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={handleOpenInTerminal}>
                            <Terminal />
                            Open in Terminal
                        </ContextMenuItem>
                    </ContextMenuContent>
                </ContextMenu>
            )}
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
