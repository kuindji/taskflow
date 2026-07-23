import { parse as parseYaml } from "yaml";

/** The frontmatter fields the wikis actually use, plus anything else as strings. */
interface PageFrontmatter {
    title?: string;
    parents: string[];
    children: string[];
    relatedPages: string[];
    lastUpdated?: string;
    extra: Record<string, string>;
}

const KNOWN_KEYS = new Set(["title", "parents", "children", "related_pages", "last_updated"]);

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function toStringList(value: unknown): string[] {
    if (typeof value === "string") return value.trim() === "" ? [] : [value.trim()];
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === "string").map((s) => s.trim());
}

function toOptionalString(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return undefined;
}

/**
 * Extract and parse a leading YAML frontmatter block. Returns null when the
 * document has none or the block is not parseable — a broken block must never
 * take the whole preview down.
 */
function parseFrontmatter(source: string): PageFrontmatter | null {
    const match = FENCE.exec(source);
    if (!match) return null;

    let data: unknown;
    try {
        data = parseYaml(match[1]);
    } catch {
        return null;
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;

    const record = data as Record<string, unknown>;
    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
        if (KNOWN_KEYS.has(key)) continue;
        const asString = toOptionalString(value);
        if (asString !== undefined) extra[key] = asString;
    }

    return {
        title: toOptionalString(record.title),
        parents: toStringList(record.parents),
        children: toStringList(record.children),
        relatedPages: toStringList(record.related_pages),
        lastUpdated: toOptionalString(record.last_updated),
        extra,
    };
}

export type { PageFrontmatter };
export { parseFrontmatter };
