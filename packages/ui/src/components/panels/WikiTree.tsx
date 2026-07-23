import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import type { WikiTreeNode } from "@taskflow/shared";
import { cn } from "@/lib/utils";

interface WikiTreeProps {
    nodes: WikiTreeNode[];
    activePageId: string | null;
    onOpen: (pageId: string) => void;
    depth?: number;
}

function WikiTree({ nodes, activePageId, onOpen, depth = 0 }: WikiTreeProps) {
    return (
        <div className="flex flex-col">
            {nodes.map((node) =>
                node.type === "folder" ? (
                    <WikiFolder
                        key={`${depth}:${node.name}`}
                        node={node}
                        activePageId={activePageId}
                        onOpen={onOpen}
                        depth={depth}
                    />
                ) : (
                    <button
                        key={node.id}
                        type="button"
                        onClick={() => node.id && onOpen(node.id)}
                        className={cn(
                            "hover:bg-island-base flex items-center gap-1.5 rounded-sm py-0.5 text-left text-[13px]",
                            node.id === activePageId && "bg-island-base text-foreground",
                        )}
                        style={{ paddingLeft: 6 + depth * 12 }}>
                        <FileText className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{node.name}</span>
                    </button>
                ),
            )}
        </div>
    );
}

interface WikiFolderProps {
    node: WikiTreeNode;
    activePageId: string | null;
    onOpen: (pageId: string) => void;
    depth: number;
}

function WikiFolder({ node, activePageId, onOpen, depth }: WikiFolderProps) {
    const [open, setOpen] = useState(true);
    // A folder with an index.md has its own page: the chevron expands, the name
    // opens the page. Without one, the whole row is just a toggle.
    const hasPage = node.id !== undefined;
    return (
        <>
            <div
                className={cn(
                    "hover:bg-island-base flex items-center gap-1 rounded-sm py-0.5 text-[13px] font-medium",
                    node.id !== undefined && node.id === activePageId && "bg-island-base",
                )}
                style={{ paddingLeft: 6 + depth * 12 }}>
                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}>
                    {open ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    )}
                </button>
                <button
                    type="button"
                    onClick={() =>
                        hasPage && node.id ? onOpen(node.id) : setOpen((value) => !value)
                    }
                    className="min-w-0 flex-1 truncate text-left">
                    {node.name}
                </button>
            </div>
            {open && node.children && (
                <WikiTree
                    nodes={node.children}
                    activePageId={activePageId}
                    onOpen={onOpen}
                    depth={depth + 1}
                />
            )}
        </>
    );
}

export { WikiTree };
