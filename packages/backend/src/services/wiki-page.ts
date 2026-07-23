import type { WikiHeading } from "@taskflow/shared";
import {
    dirnameOf,
    extractOutline,
    joinRelative,
    parseFrontmatter,
    parseWikiLinks,
} from "@taskflow/shared";

/** A page as parsed from a single file, before links are resolved against the graph. */
interface ParsedWikiPage {
    id: string;
    path: string;
    title: string;
    parents: string[];
    children: string[];
    relatedPages: string[];
    lastUpdated?: string;
    headings: WikiHeading[];
    /** Candidate page ids, deduplicated, in first-appearance order. */
    rawLinks: string[];
    mtimeMs: number;
}

interface ParseWikiPageArgs {
    pageId: string;
    relativePath: string;
    source: string;
    mtimeMs: number;
}

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const FENCE = /^\s*(```|~~~)/;

function stripExtension(path: string): string {
    return path.replace(/\.(md|markdown)$/i, "");
}

/**
 * Blank out the contents of fenced code blocks, preserving length and newlines
 * so offsets still line up. A `[[link]]` shown as an example is documentation,
 * not a graph edge, and counting it would corrupt backlinks and orphans.
 */
function blankFencedCode(source: string): string {
    const lines = source.split("\n");
    let marker: string | null = null;
    for (let i = 0; i < lines.length; i++) {
        const fence = FENCE.exec(lines[i]);
        if (fence) {
            if (marker === null) marker = fence[1];
            else if (fence[1] === marker) marker = null;
            lines[i] = " ".repeat(lines[i].length);
            continue;
        }
        if (marker !== null) lines[i] = " ".repeat(lines[i].length);
    }
    return lines.join("\n");
}

/** Resolve a relative markdown link to a page id relative to the wiki root. */
function relativeLinkToPageId(pageId: string, href: string): string | null {
    if (href === "" || href.startsWith("#")) return null;
    if (/^[a-z][a-z0-9+.-]+:/i.test(href)) return null;
    const withoutHash = href.split("#")[0];
    if (withoutHash === "") return null;
    if (!/\.(md|markdown)$/i.test(withoutHash)) return null;
    const resolved = joinRelative(dirnameOf(pageId), withoutHash);
    return stripExtension(resolved.replace(/^\/+/, ""));
}

function parseWikiPage({
    pageId,
    relativePath,
    source,
    mtimeMs,
}: ParseWikiPageArgs): ParsedWikiPage {
    const frontmatter = parseFrontmatter(source);
    const headings = extractOutline(source);
    const firstH1 = headings.find((heading) => heading.depth === 1);
    const title = frontmatter?.title ?? firstH1?.text ?? (pageId.split("/").pop() ?? pageId);

    // Both link syntaxes are collected with their offsets and merged, so
    // `rawLinks` really is first-appearance order across the whole document.
    const scanned = blankFencedCode(source);
    const found: Array<{ at: number; target: string }> = [];

    for (const link of parseWikiLinks(scanned)) {
        found.push({ at: link.start, target: link.target });
    }

    MARKDOWN_LINK.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MARKDOWN_LINK.exec(scanned)) !== null) {
        const target = relativeLinkToPageId(pageId, match[1]);
        if (target !== null) found.push({ at: match.index, target });
    }

    found.sort((a, b) => a.at - b.at);

    const rawLinks: string[] = [];
    const seen = new Set<string>();
    for (const { target } of found) {
        if (target === "" || seen.has(target)) continue;
        seen.add(target);
        rawLinks.push(target);
    }

    return {
        id: pageId,
        path: relativePath,
        title,
        parents: frontmatter?.parents ?? [],
        children: frontmatter?.children ?? [],
        relatedPages: frontmatter?.relatedPages ?? [],
        ...(frontmatter?.lastUpdated !== undefined && { lastUpdated: frontmatter.lastUpdated }),
        headings,
        rawLinks,
        mtimeMs,
    };
}

export type { ParsedWikiPage };
export { parseWikiPage };
