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

export type { WikiLinkSpan };
export { parseWikiLinks };
