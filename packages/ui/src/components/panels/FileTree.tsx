import { useCallback, useEffect, useMemo, useState } from "react";
import { cva } from "class-variance-authority";
import type { FileNode } from "@taskflow/shared";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type GitStatusVariant = "new" | "untracked" | "modified" | "deleted" | "renamed" | "clean";

const fileNodeVariants = cva(
    "text-sm whitespace-nowrap overflow-hidden text-ellipsis cursor-pointer",
    {
        variants: {
            gitStatus: {
                new: "text-success",
                untracked: "text-success",
                modified: "text-warning",
                deleted: "text-destructive",
                renamed: "text-accent",
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
    onFileClick: (path: string) => void;
    expandedPaths?: Set<string> | null;
}

function FileTree({ node, depth = 0, gitFiles, onFileClick, expandedPaths }: FileTreeProps) {
    const [open, setOpen] = useState(depth < 1);

    // Latch: when expandedPaths includes this node, permanently open it
    useEffect(() => {
        if (expandedPaths?.has(node.path)) {
            setOpen(true);
        }
    }, [expandedPaths, node.path]);
    const rawStatus = gitFiles?.get(node.path);
    const gitStatus: GitStatusVariant =
        rawStatus && VALID_GIT_STATUSES.has(rawStatus) ? (rawStatus as GitStatusVariant) : "clean";

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
            <div
                onClick={() => onFileClick(node.path)}
                draggable
                onDragStart={handleDragStart}
                className={fileClasses}
                style={{ paddingLeft: Math.min(depth, 8) * 16 + 12 }}
                title={node.path}
            >
                {node.name}
            </div>
        );
    }

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger
                draggable
                onDragStart={handleDragStart}
                className="text-muted-foreground hover:bg-muted/50 flex w-full cursor-pointer items-center px-3 py-1 text-sm select-none"
                style={{ paddingLeft: Math.min(depth, 8) * 16 + 12 }}
            >
                {open ? (
                    <ChevronDown className="mr-1.5 h-4 w-4 shrink-0" />
                ) : (
                    <ChevronRight className="mr-1.5 h-4 w-4 shrink-0" />
                )}
                {node.name}
            </CollapsibleTrigger>
            <CollapsibleContent>
                {node.children?.map((child) => (
                    <FileTree
                        key={child.path}
                        node={child}
                        depth={depth + 1}
                        gitFiles={gitFiles}
                        onFileClick={onFileClick}
                        expandedPaths={expandedPaths}
                    />
                ))}
            </CollapsibleContent>
        </Collapsible>
    );
}

export { FileTree };
