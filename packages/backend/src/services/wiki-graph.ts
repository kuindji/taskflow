import type { WikiIndexData, WikiPage, WikiTreeNode, WikiUnresolvedLink } from "@taskflow/shared";
import { resolveWikiTarget } from "@taskflow/shared";
import type { ParsedWikiPage } from "./wiki-page";

const INDEX_NAMES = ["index", "README", "readme"];

interface TreeBuilder {
    folders: Map<string, TreeBuilder>;
    pages: Array<{ name: string; id: string }>;
}

function emptyBuilder(): TreeBuilder {
    return { folders: new Map(), pages: [] };
}

function insert(builder: TreeBuilder, segments: string[], id: string): void {
    if (segments.length === 1) {
        builder.pages.push({ name: segments[0], id });
        return;
    }
    const [head, ...rest] = segments;
    const child = builder.folders.get(head) ?? emptyBuilder();
    builder.folders.set(head, child);
    insert(child, rest, id);
}

function findIndexPageId(pages: Array<{ name: string; id: string }>): string | undefined {
    return pages.find((entry) => INDEX_NAMES.includes(entry.name))?.id;
}

/**
 * Default order for a folder's own pages: its index page first, then
 * alphabetically. `hoistedId`, when given, is the index page that has already
 * become the folder node itself and must not appear again as its own child.
 */
function orderPages(
    pages: Array<{ name: string; id: string }>,
    indexId: string | undefined,
    hoistedId: string | undefined,
): Array<{ name: string; id: string }> {
    return pages
        .filter((entry) => entry.id !== hoistedId)
        .sort((a, b) => {
            if (a.id === indexId) return -1;
            if (b.id === indexId) return 1;
            return a.name.localeCompare(b.name);
        });
}

/**
 * Reorder the nodes an index page names in its `children` list into that order,
 * leaving every other node exactly where the default order put it. Declared
 * entries may name a subfolder's index page, so this governs folders as well as
 * pages — which a sort within the folders-then-pages groups could not do.
 */
function applyDeclaredOrder(nodes: WikiTreeNode[], rank: Map<string, number>): WikiTreeNode[] {
    if (rank.size === 0) return nodes;
    const slots: number[] = [];
    const declared: WikiTreeNode[] = [];
    nodes.forEach((node, i) => {
        if (node.id === undefined || !rank.has(node.id)) return;
        slots.push(i);
        declared.push(node);
    });
    if (declared.length < 2) return nodes;

    declared.sort((a, b) => (rank.get(a.id ?? "") ?? 0) - (rank.get(b.id ?? "") ?? 0));
    const out = [...nodes];
    slots.forEach((slot, i) => {
        out[slot] = declared[i];
    });
    return out;
}

/**
 * `hoistedId` is threaded down one level: a folder's `index.md` becomes the
 * folder node's own page, so the recursive call must not also list it as a
 * child. At the root there is no folder node, so nothing is hoisted and a root
 * `index.md` stays an ordinary top-level page.
 */
function toNodes(
    builder: TreeBuilder,
    byId: Map<string, ParsedWikiPage>,
    hoistedId?: string,
): WikiTreeNode[] {
    const indexId = hoistedId ?? findIndexPageId(builder.pages);
    const declared = indexId === undefined ? [] : (byId.get(indexId)?.children ?? []);
    const rank = new Map<string, number>(declared.map((id, i) => [id, i]));

    const folders: WikiTreeNode[] = [...builder.folders.entries()]
        .map(([name, child]) => {
            const childIndexId = findIndexPageId(child.pages);
            return {
                name,
                type: "folder" as const,
                ...(childIndexId !== undefined && { id: childIndexId }),
                children: toNodes(child, byId, childIndexId),
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    const pages: WikiTreeNode[] = orderPages(builder.pages, indexId, hoistedId).map((entry) => ({
        name: entry.name,
        type: "page" as const,
        id: entry.id,
    }));

    return applyDeclaredOrder([...folders, ...pages], rank);
}

/**
 * Turn parsed pages into the full index: resolved links, the reverse backlink
 * map, the page tree, unresolved links and orphans.
 */
function buildWikiGraph(
    root: string,
    rootExists: boolean,
    parsed: ParsedWikiPage[],
): WikiIndexData {
    const byId = new Map(parsed.map((page) => [page.id, page]));
    const backlinks: Record<string, string[]> = {};
    const unresolved: WikiUnresolvedLink[] = [];

    const pages: WikiPage[] = parsed.map((page) => {
        const links: string[] = [];
        const brokenLinks: string[] = [];
        // Two different raw targets can resolve to the same page ("business" and
        // "business/index"), so dedupe after resolution — otherwise the source
        // shows up twice in that page's backlinks.
        const linked = new Set<string>();
        for (const target of page.rawLinks) {
            const resolved = resolveWikiTarget(target, (id) => byId.has(id));
            if (resolved === null || resolved === page.id) {
                if (resolved === null) {
                    brokenLinks.push(target);
                    unresolved.push({ from: page.id, target });
                }
                continue;
            }
            if (linked.has(resolved)) continue;
            linked.add(resolved);
            links.push(resolved);
            (backlinks[resolved] ??= []).push(page.id);
        }
        const { rawLinks: _rawLinks, ...rest } = page;
        return { ...rest, links, brokenLinks };
    });

    for (const list of Object.values(backlinks)) list.sort();

    const builder = emptyBuilder();
    for (const page of parsed) insert(builder, page.id.split("/"), page.id);

    const orphans = pages
        .filter((page) => (backlinks[page.id]?.length ?? 0) === 0 && page.parents.length === 0)
        .map((page) => page.id)
        .sort();

    return {
        root,
        rootExists,
        pages,
        tree: toNodes(builder, byId),
        backlinks,
        unresolved,
        orphans,
    };
}

export { buildWikiGraph };
