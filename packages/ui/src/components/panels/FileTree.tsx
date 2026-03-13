import { useCallback, useEffect, useMemo, useState } from "react";
import { cva } from "class-variance-authority";
import type { FileNode } from "@taskflow/shared";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TruncatedText } from "@/components/ui/truncated-text";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileContextMenu } from "./FileContextMenu";

type GitStatusVariant = "new" | "untracked" | "modified" | "deleted" | "renamed" | "ignored" | "clean";

const fileNodeVariants = cva(
    "text-sm cursor-pointer",
    {
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
    },
);

const VALID_GIT_STATUSES = new Set<string>(["new", "untracked", "modified", "deleted", "renamed"]);

interface FileTreeProps {
    node: FileNode;
    depth?: number;
    gitFiles?: Map<string, string>;
    ignoredFiles?: Set<string>;
    onFileClick: (path: string) => void;
    expandedPaths?: Set<string> | null;
    rootPath?: string;
}

function FileTree({
    node,
    depth = 0,
    gitFiles,
    ignoredFiles,
    onFileClick,
    expandedPaths,
    rootPath,
}: FileTreeProps) {
    const [open, setOpen] = useState(depth < 1);

    // Latch: when expandedPaths includes this node, permanently open it
    useEffect(() => {
        if (expandedPaths?.has(node.path)) {
            setOpen(true);
        }
    }, [expandedPaths, node.path]);
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
                <TruncatedText
                    as="div"
                    onClick={() => onFileClick(node.path)}
                    draggable
                    onDragStart={handleDragStart}
                    className={fileClasses}
                    style={{ paddingLeft: Math.min(depth, 8) * 16 + 12 }}
                    tooltipContent={node.path}
                >
                    {node.name}
                </TruncatedText>
            </FileContextMenu>
        );
    }

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <FileContextMenu filePath={node.path} isDirectory={true} rootPath={rootPath ?? ""}>
                <CollapsibleTrigger
                    draggable
                    onDragStart={handleDragStart}
                    className="text-muted-foreground hover:bg-muted/50 flex w-full min-w-0 cursor-pointer items-center px-3 py-1 text-sm select-none"
                    style={{ paddingLeft: Math.min(depth, 8) * 16 + 12 }}
                >
                    {open ? (
                        <ChevronDown className="mr-1.5 h-4 w-4 shrink-0" />
                    ) : (
                        <ChevronRight className="mr-1.5 h-4 w-4 shrink-0" />
                    )}
                    <TruncatedText tooltipContent={node.path}>
                        {node.name}
                    </TruncatedText>
                </CollapsibleTrigger>
            </FileContextMenu>
            <CollapsibleContent>
                {node.children?.map((child) => (
                    <FileTree
                        key={child.path}
                        node={child}
                        depth={depth + 1}
                        gitFiles={gitFiles}
                        ignoredFiles={ignoredFiles}
                        onFileClick={onFileClick}
                        expandedPaths={expandedPaths}
                        rootPath={rootPath}
                    />
                ))}
            </CollapsibleContent>
        </Collapsible>
    );
}

export { FileTree };
