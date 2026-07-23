import GithubSlugger from "github-slugger";

interface OutlineEntry {
    depth: number;
    text: string;
    id: string;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** Reduce inline markdown to the plain text rehype-slug would see. */
function stripInline(text: string): string {
    return text
        .replace(/`([^`]*)`/g, "$1")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
        .replace(/\[\[([^\]]+)\]\]/g, "$1")
        .replace(/(\*\*|__)(.*?)\1/g, "$2")
        .replace(/(\*|_)(.*?)\1/g, "$2")
        .replace(/~~(.*?)~~/g, "$1")
        .trim();
}

/**
 * Extract the heading outline from markdown source, skipping fenced code and a
 * leading frontmatter block. Ids come from `github-slugger`, the same generator
 * `rehype-slug` uses, so they match the rendered DOM including its `-1`, `-2`
 * disambiguation suffixes.
 */
function extractOutline(source: string): OutlineEntry[] {
    const lines = source.split("\n");
    const slugger = new GithubSlugger();
    const out: OutlineEntry[] = [];
    let fenceMarker: string | null = null;
    let start = 0;

    if (lines[0]?.trimEnd() === "---") {
        const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === "---");
        if (end > 0) start = end + 1;
    }

    for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        const fence = FENCE.exec(line);
        if (fence) {
            if (fenceMarker === null) fenceMarker = fence[1];
            else if (fence[1] === fenceMarker) fenceMarker = null;
            continue;
        }
        if (fenceMarker !== null) continue;

        const heading = HEADING.exec(line);
        if (!heading) continue;
        const text = stripInline(heading[2]);
        if (text === "") continue;
        out.push({ depth: heading[1].length, text, id: slugger.slug(text) });
    }

    return out;
}

export type { OutlineEntry };
export { extractOutline };
