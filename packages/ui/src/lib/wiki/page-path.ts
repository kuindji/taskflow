import { resolveWikiTarget } from "@taskflow/shared";

interface WikiPageHref {
    /** Absolute path the preview links to and the tab navigates to. */
    href: string;
    /** False when no page in the index matched — the preview marks it broken. */
    exists: boolean;
}

/**
 * Turn a wiki target (`business/money`, `business`, `./business/`) into an
 * absolute file path. `pathById` maps page id → path relative to the root, so a
 * page stored as `.markdown` resolves to its real file rather than a guessed
 * `.md`. Resolution goes through the same `resolveWikiTarget` the backend graph
 * uses, so a link the index counts as valid never renders as broken.
 */
function resolveWikiPageHref(
    root: string,
    pathById: Map<string, string>,
    target: string,
): WikiPageHref {
    const resolved = resolveWikiTarget(target, (id) => pathById.has(id));
    if (resolved !== null) {
        return { href: `${root}/${pathById.get(resolved) ?? `${resolved}.md`}`, exists: true };
    }

    const normalized = target.replace(/^\.?\//, "").replace(/\/+$/, "");
    if (normalized === "") return { href: root, exists: false };
    const withExtension = /\.(md|markdown)$/i.test(normalized) ? normalized : `${normalized}.md`;
    return { href: `${root}/${withExtension}`, exists: false };
}

export { resolveWikiPageHref };
