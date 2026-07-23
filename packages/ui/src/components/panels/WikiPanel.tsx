import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { WikiTreeNode } from "@taskflow/shared";
import { Toolbar } from "@/components/ui/toolbar";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui-store";
import { useWikiStore } from "@/stores/wiki-store";
import { useWikiRoot } from "@/hooks/useWikiRoot";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { openFileInApp } from "@/lib/open-file";
import { WikiTree } from "./WikiTree";

/** Keep only pages whose id matches the filter, and the folders containing them. */
function filterTree(nodes: WikiTreeNode[], query: string, prefix = ""): WikiTreeNode[] {
    const needle = query.toLowerCase();
    const out: WikiTreeNode[] = [];
    for (const node of nodes) {
        if (node.type === "folder") {
            const children = filterTree(node.children ?? [], query, `${prefix}${node.name}/`);
            const selfMatches =
                node.id !== undefined && `${prefix}${node.name}`.toLowerCase().includes(needle);
            if (children.length > 0 || selfMatches) out.push({ ...node, children });
            continue;
        }
        if (`${prefix}${node.name}`.toLowerCase().includes(needle)) out.push(node);
    }
    return out;
}

function WikiPanel() {
    const [query, setQuery] = useState("");
    const toggleWikiPanel = useUIStore((s) => s.toggleWikiPanel);
    const workspace = useActiveWorkspace();
    const root = useWikiRoot();
    const index = useWikiStore((s) => (root ? s.indexByRoot[root] : undefined));
    const error = useWikiStore((s) => (root ? s.errorByRoot[root] : undefined));
    const fetchIndex = useWikiStore((s) => s.fetchIndex);

    useEffect(() => {
        if (root) void fetchIndex(root);
    }, [fetchIndex, root]);

    const tree = useMemo(
        () => (query.trim() === "" ? (index?.tree ?? []) : filterTree(index?.tree ?? [], query)),
        [index, query],
    );

    const handleOpen = useCallback(
        (pageId: string) => {
            if (!root) return;
            const page = index?.pages.find((entry) => entry.id === pageId);
            if (!page) return;
            void openFileInApp(`${root}/${page.path}`, workspace.workspaceKey);
        },
        [index, root, workspace.workspaceKey],
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <Toolbar className="justify-between">
                <span className="text-secondary-foreground text-[13px] font-medium">Wiki</span>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={toggleWikiPanel}
                    aria-label="Hide wiki">
                    <X className="h-4 w-4" />
                </Button>
            </Toolbar>

            {root === null ? (
                <div className="text-muted-foreground p-3 text-[13px]">
                    No wiki for this project. Add a project attribute named{" "}
                    <code className="text-foreground">wiki</code> whose value is the wiki folder,
                    for example <code className="text-foreground">docs/wiki</code>.
                </div>
            ) : error !== undefined ? (
                <div className="text-muted-foreground p-3 text-[13px]">
                    The <code className="text-foreground">wiki</code> attribute points at{" "}
                    <code className="text-foreground">{root}</code>, which could not be read.
                </div>
            ) : index && !index.rootExists ? (
                <div className="text-muted-foreground p-3 text-[13px]">
                    The <code className="text-foreground">wiki</code> attribute points at{" "}
                    <code className="text-foreground">{root}</code>, which is not a folder. Check
                    the attribute value.
                </div>
            ) : index && index.pages.length === 0 ? (
                <div className="text-muted-foreground p-3 text-[13px]">
                    No markdown files under <code className="text-foreground">{root}</code>.
                </div>
            ) : (
                <>
                    <div className="p-2 pb-0">
                        <div className="border-border bg-background flex items-center rounded-md border">
                            <input
                                type="text"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Filter pages"
                                className="min-w-0 flex-1 bg-transparent px-2 py-1 text-xs outline-none"
                            />
                        </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-2">
                        <WikiTree nodes={tree} activePageId={null} onOpen={handleOpen} />
                    </div>
                </>
            )}
        </div>
    );
}

export { WikiPanel };
