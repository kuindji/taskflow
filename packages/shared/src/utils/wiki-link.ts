/** One `[[target#hash|alias]]` span found in a source string. */
interface WikiLinkSpan {
    start: number;
    end: number;
    target: string;
    alias?: string;
    hash?: string;
}

const WIKI_LINK = /\[\[([^\][]+)\]\]/g;

/**
 * Find every wiki-link in a string. Targets in the observed wikis are
 * path-based ("business/money/currency"), not title-based, so no title lookup
 * happens here — resolution against a root is the caller's job.
 */
function parseWikiLinks(source: string): WikiLinkSpan[] {
    const out: WikiLinkSpan[] = [];
    WIKI_LINK.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = WIKI_LINK.exec(source)) !== null) {
        const inner = match[1];
        const pipeIndex = inner.indexOf("|");
        const beforeAlias = pipeIndex === -1 ? inner : inner.slice(0, pipeIndex);
        const alias = pipeIndex === -1 ? undefined : inner.slice(pipeIndex + 1).trim();

        const hashIndex = beforeAlias.indexOf("#");
        const target = (hashIndex === -1 ? beforeAlias : beforeAlias.slice(0, hashIndex)).trim();
        const hash = hashIndex === -1 ? undefined : beforeAlias.slice(hashIndex + 1).trim();

        if (target === "") continue;

        out.push({
            start: match.index,
            end: match.index + match[0].length,
            target,
            ...(alias !== undefined && alias !== "" && { alias }),
            ...(hash !== undefined && hash !== "" && { hash }),
        });
    }

    return out;
}

/**
 * Files that stand in for their folder. `index` and `README` are both in use in
 * the observed wikis, so `[[business]]` has to reach either.
 */
const WIKI_INDEX_NAMES = ["index", "README", "readme"];

/**
 * Resolve a raw link target to a page id, allowing `[[folder]]` to reach that
 * folder's index page. Both the backend graph builder and the renderer's
 * preview call this, so a link the graph counts as valid is the same link the
 * preview renders as valid.
 */
function resolveWikiTarget(target: string, hasPage: (id: string) => boolean): string | null {
    const normalized = target.replace(/^\.?\//, "").replace(/\/+$/, "");
    if (normalized === "") return null;
    if (hasPage(normalized)) return normalized;
    for (const name of WIKI_INDEX_NAMES) {
        const candidate = `${normalized}/${name}`;
        if (hasPage(candidate)) return candidate;
    }
    return null;
}

export type { WikiLinkSpan };
export { parseWikiLinks, resolveWikiTarget };
