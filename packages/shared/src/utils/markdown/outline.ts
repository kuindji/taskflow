import GithubSlugger from "github-slugger";

interface OutlineEntry {
    depth: number;
    text: string;
    id: string;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** A line that opens a list item or blockquote; lazy lines after it belong to that container. */
const CONTAINER_START = /^ {0,3}(?:>|[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$))/;
const INDENTED_CODE = /^(?: {4}|\t)/;

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
 * disambiguation suffixes. Setext headings (a paragraph underlined with `===`
 * or `---`) count too, or every later duplicate would get the wrong suffix.
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

    // Lines of the open top-level paragraph, which a setext underline turns
    // into a heading; null while inside a list item or blockquote, whose lazy
    // continuation lines cannot be underlined into a top-level heading.
    let paragraph: string[] | null = [];
    const pushHeading = (depth: number, raw: string, display: string) => {
        const text = stripInline(display);
        if (text === "") return;
        out.push({ depth, text, id: slugger.slug(stripInline(raw)) });
    };

    for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        const fence = FENCE.exec(line);
        if (fence) {
            if (fenceMarker === null) fenceMarker = fence[1];
            else if (fence[1] === fenceMarker) fenceMarker = null;
            paragraph = [];
            continue;
        }
        if (fenceMarker !== null) continue;

        if (line.trim() === "") {
            paragraph = [];
            continue;
        }

        const heading = HEADING.exec(line);
        if (heading) {
            pushHeading(heading[1].length, heading[2], heading[2]);
            paragraph = [];
            continue;
        }

        const underline = SETEXT_UNDERLINE.exec(line);
        if (underline && paragraph !== null && paragraph.length > 0) {
            const depth = underline[1].startsWith("=") ? 1 : 2;
            const parts = paragraph.map((part) => part.trim());
            pushHeading(depth, parts.join("\n"), parts.join(" "));
            paragraph = [];
            continue;
        }

        if (THEMATIC_BREAK.test(line)) {
            paragraph = [];
            continue;
        }
        if (paragraph === null) continue;
        if (CONTAINER_START.test(line)) {
            paragraph = null;
            continue;
        }
        if (paragraph.length === 0 && INDENTED_CODE.test(line)) continue;
        paragraph.push(line);
    }

    return out;
}

export type { OutlineEntry };
export { extractOutline };
