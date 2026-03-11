import { useMemo, useState } from "react";
import { cva } from "class-variance-authority";
import type { FileNode } from "@taskflow/shared";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type GitStatusVariant = "new" | "untracked" | "modified" | "deleted" | "renamed" | "clean";

const fileNodeVariants = cva(
    "text-xs whitespace-nowrap overflow-hidden text-ellipsis cursor-pointer",
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
}

function FileTree({ node, depth = 0, gitFiles, onFileClick }: FileTreeProps) {
    const [open, setOpen] = useState(depth < 2);
    const rawStatus = gitFiles?.get(node.path);
    const gitStatus: GitStatusVariant =
        rawStatus && VALID_GIT_STATUSES.has(rawStatus) ? (rawStatus as GitStatusVariant) : "clean";

    const fileClasses = useMemo(
        () => cn(fileNodeVariants({ gitStatus }), "py-0.5 px-2 hover:bg-muted/50"),
        [gitStatus],
    );

    if (node.type === "file") {
        return (
            <div
                onClick={() => onFileClick(node.path)}
                className={fileClasses}
                style={{ paddingLeft: depth * 12 + 8 }}
                title={node.path}
            >
                {node.name}
            </div>
        );
    }

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger
                className="text-muted-foreground hover:bg-muted/50 flex w-full cursor-pointer items-center px-2 py-0.5 text-xs select-none"
                style={{ paddingLeft: depth * 12 + 8 }}
            >
                <span className="mr-1 text-[10px]">{open ? "▾" : "▸"}</span>
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
                    />
                ))}
            </CollapsibleContent>
        </Collapsible>
    );
}

export { FileTree };
