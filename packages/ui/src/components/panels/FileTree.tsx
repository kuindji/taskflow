import { useCallback, useMemo } from "react";
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
    const expandedDirs = useFileStore((s) => s.expandedDirs);
    const toggleDir = useFileStore((s) => s.toggleDir);
    const loadingDirs = useFileStore((s) => s.loadingDirs);
    const open = node.type === "directory" && expandedDirs.has(node.path);
    const isLoading = node.type === "directory" && loadingDirs.has(node.path);

    const handleOpenChange = useCallback(() => {
        toggleDir(node.path);
    }, [toggleDir, node.path]);

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
                "flex w-full min-w-0 cursor-pointer items-center px-3 py-1 text-sm font-medium select-none",
                "text-foreground/90 hover:bg-accent/10 hover:text-foreground",
                open && "text-foreground",
            ),
        [open],
    );

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
                    onClick={() => onFileClick(node.path)}
                    draggable
                    onDragStart={handleDragStart}
                    className={cn(fileClasses, "flex min-w-0 items-center gap-1.5")}
                    style={{ paddingLeft: Math.min(depth, 8) * 16 + 12 }}>
                    <FileIcon name={node.name} isDirectory={false} />
                    <TruncatedText tooltipContent={node.path}>{node.name}</TruncatedText>
                </div>
            </FileContextMenu>
        );
    }

    return (
        <Collapsible open={open} onOpenChange={handleOpenChange}>
            <FileContextMenu filePath={node.path} isDirectory={true} rootPath={rootPath ?? ""}>
                <CollapsibleTrigger
                    draggable
                    onDragStart={handleDragStart}
                    className={directoryClasses}
                    style={{ paddingLeft: Math.min(depth, 8) * 16 + 12 }}>
                    {open ? (
                        <ChevronDown className="mr-1.5 h-4 w-4 shrink-0" />
                    ) : (
                        <ChevronRight className="mr-1.5 h-4 w-4 shrink-0" />
                    )}
                    <FileIcon name={node.name} isDirectory isOpen={open} className="mr-1.5" />
                    <TruncatedText tooltipContent={node.path}>{node.name}</TruncatedText>
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
