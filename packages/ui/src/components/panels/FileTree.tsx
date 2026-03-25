import { useCallback, useEffect, useMemo, useRef } from "react";
import { cva } from "class-variance-authority";
import type { FileNode } from "@taskflow/shared";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TruncatedText } from "@/components/ui/truncated-text";
import { ChevronDown, ChevronRight } from "lucide-react";
import { FileIcon } from "./FileIcon";
import { cn } from "@/lib/utils";
import { useFileStore } from "@/stores/file-store";
import { FileContextMenu } from "./FileContextMenu";

type GitStatusVariant =
    | "new"
    | "untracked"
    | "modified"
    | "deleted"
    | "renamed"
    | "ignored"
    | "clean";

const fileNodeVariants = cva("text-sm cursor-pointer", {
    variants: {
        gitStatus: {
            new: "text-success",
            untracked: "text-success",
            modified: "text-warning",
            deleted: "text-destructive",
            renamed: "text-accent",
            ignored: "text-muted-foreground/50",
            clean: "text-secondary-foreground",
        } satisfies Record<GitStatusVariant, string>,
    },
    defaultVariants: {
        gitStatus: "clean",
    },
});

const VALID_GIT_STATUSES = new Set<string>(["new", "untracked", "modified", "deleted", "renamed"]);

interface FileTreeProps {
    node: FileNode;
    depth?: number;
    gitFiles?: Map<string, string>;
    ignoredFiles?: Set<string>;
    onFileClick: (path: string) => void;
    rootPath?: string;
}

function FileTree({
    node,
    depth = 0,
    gitFiles,
    ignoredFiles,
    onFileClick,
    rootPath,
}: FileTreeProps) {
    const open = useFileStore((s) => node.type === "directory" && s.expandedDirs.has(node.path));
    const toggleDir = useFileStore((s) => s.toggleDir);
    const loadingDirs = useFileStore((s) => s.loadingDirs);
    const isFocused = useFileStore((s) => s.focusedPath === node.path);
    const isContextMenuActive = useFileStore((s) => s.contextMenuPath === node.path);
    const setFocusedPath = useFileStore((s) => s.setFocusedPath);
    const isLoading = node.type === "directory" && loadingDirs.has(node.path);

    const handleOpenChange = useCallback(() => {
        toggleDir(node.path);
    }, [toggleDir, node.path]);

    const itemRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isFocused && itemRef.current) {
            itemRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
    }, [isFocused]);

    const rawStatus = gitFiles?.get(node.path);
    const isIgnored = !rawStatus && ignoredFiles?.has(node.path);
    const gitStatus: GitStatusVariant =
        rawStatus && VALID_GIT_STATUSES.has(rawStatus)
            ? (rawStatus as GitStatusVariant)
            : isIgnored
              ? "ignored"
              : "clean";

    const fileClasses = useMemo(
        () => cn(fileNodeVariants({ gitStatus }), "py-1 px-3 hover:bg-muted/50"),
        [gitStatus],
    );
    const directoryClasses = useMemo(
        () =>
            cn(
                "flex w-max min-w-full cursor-pointer items-center gap-1.5 px-3 py-1 text-sm font-medium select-none",
                "text-foreground/90 hover:bg-accent/10 hover:text-foreground",
                open && "text-foreground",
            ),
        [open],
    );
    const rowPaddingLeft = Math.min(depth, 8) * 16 + 12;

    const handleDragStart = useCallback(
        (e: React.DragEvent) => {
            e.dataTransfer.setData("text/plain", node.path);
            e.dataTransfer.setData("application/x-taskflow-path", node.path);
            e.dataTransfer.effectAllowed = "copy";
        },
        [node.path],
    );

    if (node.type === "file") {
        return (
            <FileContextMenu filePath={node.path} isDirectory={false} rootPath={rootPath ?? ""}>
                <div
                    ref={itemRef}
                    onClick={() => {
                        setFocusedPath(node.path);
                        onFileClick(node.path);
                    }}
                    draggable
                    onDragStart={handleDragStart}
                    className={cn(
                        fileClasses,
                        "flex w-max min-w-full items-center gap-1.5",
                        (isFocused || isContextMenuActive) && "bg-accent/20 ring-accent/40 ring-1",
                    )}
                    style={{ paddingLeft: rowPaddingLeft }}>
                    <span aria-hidden="true" className="h-4 w-4 shrink-0" />
                    <FileIcon name={node.name} isDirectory={false} />
                    <TruncatedText truncate={false} className="whitespace-nowrap">
                        {node.name}
                    </TruncatedText>
                </div>
            </FileContextMenu>
        );
    }

    return (
        <Collapsible ref={itemRef} open={open} onOpenChange={handleOpenChange}>
            <FileContextMenu filePath={node.path} isDirectory={true} rootPath={rootPath ?? ""}>
                <CollapsibleTrigger
                    draggable
                    onDragStart={handleDragStart}
                    onClick={() => setFocusedPath(node.path)}
                    className={cn(
                        directoryClasses,
                        (isFocused || isContextMenuActive) && "bg-accent/20 ring-accent/40 ring-1",
                    )}
                    style={{ paddingLeft: rowPaddingLeft }}>
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {open ? (
                            <ChevronDown className="h-4 w-4 shrink-0" />
                        ) : (
                            <ChevronRight className="h-4 w-4 shrink-0" />
                        )}
                    </span>
                    <FileIcon name={node.name} isDirectory isOpen={open} />
                    <TruncatedText truncate={false} className="whitespace-nowrap">
                        {node.name}
                    </TruncatedText>
                </CollapsibleTrigger>
            </FileContextMenu>
            <CollapsibleContent>
                {isLoading ? (
                    <div
                        className="text-muted-foreground py-1 text-xs"
                        style={{ paddingLeft: Math.min(depth + 1, 8) * 16 + 12 }}>
                        Loading...
                    </div>
                ) : (
                    node.children?.map((child) => (
                        <FileTree
                            key={child.path}
                            node={child}
                            depth={depth + 1}
                            gitFiles={gitFiles}
                            ignoredFiles={ignoredFiles}
                            onFileClick={onFileClick}
                            rootPath={rootPath}
                        />
                    ))
                )}
            </CollapsibleContent>
        </Collapsible>
    );
}

export { FileTree };
