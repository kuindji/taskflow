import type { WikiIndexData, WikiPage, WikiTreeNode, WikiUnresolvedLink } from "@taskflow/shared";
import type { ParsedWikiPage } from "./wiki-page";

const INDEX_NAMES = ["index", "README", "readme"];

/** Resolve a raw link target to a page id, allowing folder → folder index. */
function resolveTarget(target: string, byId: Map<string, ParsedWikiPage>): string | null {
    const normalized = target.replace(/^\.?\//, "").replace(/\/+$/, "");
    if (byId.has(normalized)) return normalized;
    for (const name of INDEX_NAMES) {
        const candidate = `${normalized}/${name}`;
        if (byId.has(candidate)) return candidate;
    }
    return null;
}

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
 * Order a folder's pages by the `children` list its index page declares, then
 * alphabetically — the declared hierarchy is authoritative where it exists.
 * `hoistedId`, when given, is the index page that has already become the folder
 * node itself and must not appear again as one of its own children.
 */
function orderPages(
    pages: Array<{ name: string; id: string }>,
    byId: Map<string, ParsedWikiPage>,
    hoistedId: string | undefined,
): Array<{ name: string; id: string }> {
    const indexId = hoistedId ?? findIndexPageId(pages);
    const declared = indexId === undefined ? [] : (byId.get(indexId)?.children ?? []);
    const rank = new Map<string, number>();
    declared.forEach((id, i) => rank.set(id, i));

    return pages
        .filter((entry) => entry.id !== hoistedId)
        .sort((a, b) => {
            if (a.id === indexId) return -1;
            if (b.id === indexId) return 1;
            const rankA = rank.get(a.id);
            const rankB = rank.get(b.id);
            if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
            if (rankA !== undefined) return -1;
            if (rankB !== undefined) return 1;
            return a.name.localeCompare(b.name);
        });
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
    const folders: WikiTreeNode[] = [...builder.folders.entries()]
        .map(([name, child]) => {
            const indexId = findIndexPageId(child.pages);
            return {
                name,
                type: "folder" as const,
                ...(indexId !== undefined && { id: indexId }),
                children: toNodes(child, byId, indexId),
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    const pages: WikiTreeNode[] = orderPages(builder.pages, byId, hoistedId).map((entry) => ({
        name: entry.name,
        type: "page" as const,
        id: entry.id,
    }));

    return [...folders, ...pages];
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
        for (const target of page.rawLinks) {
            const resolved = resolveTarget(target, byId);
            if (resolved === null || resolved === page.id) {
                if (resolved === null) {
                    brokenLinks.push(target);
                    unresolved.push({ from: page.id, target });
                }
                continue;
            }
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
