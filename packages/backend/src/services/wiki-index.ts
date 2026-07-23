import chokidar, { type FSWatcher } from "chokidar";
import { readdir, readFile, stat } from "fs/promises";
import { join, relative } from "path";
import type { WikiIndexData } from "@taskflow/shared";
import { parseWikiPage, type ParsedWikiPage } from "./wiki-page";
import { buildWikiGraph } from "./wiki-graph";

const IGNORED_NAMES = new Set([
    "node_modules",
    ".git",
    ".worktrees",
    "dist",
    ".next",
    ".superpowers",
    ".obsidian",
    ".DS_Store",
]);

const MARKDOWN = /\.(md|markdown)$/i;

function normalizePath(p: string): string {
    return p.replace(/\\/g, "/");
}

function toPageId(root: string, filePath: string): string {
    return normalizePath(relative(root, filePath)).replace(MARKDOWN, "");
}

interface WikiIndexServiceDeps {
    onChange: (data: WikiIndexData) => void;
    /** Coalescing window for filesystem events. */
    debounceMs?: number;
}

interface RootState {
    data: WikiIndexData;
    parsed: Map<string, ParsedWikiPage>;
    watcher: FSWatcher | null;
    timer: ReturnType<typeof setTimeout> | null;
    pending: Set<string>;
}

/**
 * One in-memory wiki index per root, kept fresh by a chokidar watcher. A
 * changed file re-parses alone and the graph is rebuilt from the cached page
 * map — at ~110 files a full rebuild is milliseconds, so nothing is persisted.
 */
class WikiIndexService {
    private readonly onChange: (data: WikiIndexData) => void;
    private readonly debounceMs: number;
    private readonly roots = new Map<string, RootState>();
    private readonly building = new Map<string, Promise<WikiIndexData>>();

    constructor({ onChange, debounceMs = 150 }: WikiIndexServiceDeps) {
        this.onChange = onChange;
        this.debounceMs = debounceMs;
    }

    async get(root: string): Promise<WikiIndexData> {
        const existing = this.roots.get(root);
        if (existing) return existing.data;

        const inFlight = this.building.get(root);
        if (inFlight) return inFlight;

        const build = this.build(root).finally(() => this.building.delete(root));
        this.building.set(root, build);
        return build;
    }

    async stopAll(): Promise<void> {
        const states = [...this.roots.values()];
        this.roots.clear();
        await Promise.all(
            states.map(async (state) => {
                if (state.timer) clearTimeout(state.timer);
                await state.watcher?.close();
            }),
        );
    }

    private async build(root: string): Promise<WikiIndexData> {
        const usable = await stat(root)
            .then((stats) => stats.isDirectory())
            .catch(() => false);

        if (!usable) {
            // Not cached and not watched: the folder may be created later, and
            // the next request should notice.
            return buildWikiGraph(root, false, []);
        }

        const parsed = new Map<string, ParsedWikiPage>();
        for (const filePath of await this.listMarkdown(root)) {
            const page = await this.parseFile(root, filePath);
            if (page) parsed.set(filePath, page);
        }

        const data = buildWikiGraph(root, true, [...parsed.values()]);
        const state: RootState = { data, parsed, watcher: null, timer: null, pending: new Set() };
        this.roots.set(root, state);
        state.watcher = await this.watch(root, state);
        return data;
    }

    private async listMarkdown(dir: string): Promise<string[]> {
        const out: string[] = [];
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return out;
        }
        for (const entry of entries) {
            if (IGNORED_NAMES.has(entry.name)) continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) out.push(...(await this.listMarkdown(full)));
            else if (MARKDOWN.test(entry.name)) out.push(full);
        }
        return out;
    }

    private async parseFile(root: string, filePath: string): Promise<ParsedWikiPage | null> {
        try {
            const [source, stats] = await Promise.all([readFile(filePath, "utf-8"), stat(filePath)]);
            return parseWikiPage({
                pageId: toPageId(root, filePath),
                relativePath: normalizePath(relative(root, filePath)),
                source,
                mtimeMs: stats.mtimeMs,
            });
        } catch {
            return null;
        }
    }

    private async watch(root: string, state: RootState): Promise<FSWatcher> {
        const watcher = chokidar.watch(root, {
            ignored: (path: string) =>
                normalizePath(path)
                    .split("/")
                    .filter(Boolean)
                    .some((segment) => IGNORED_NAMES.has(segment)),
            ignoreInitial: true,
            ignorePermissionErrors: true,
            persistent: true,
        });

        const queue = (path: string) => {
            if (!MARKDOWN.test(path)) return;
            state.pending.add(path);
            if (state.timer) clearTimeout(state.timer);
            state.timer = setTimeout(() => {
                state.timer = null;
                void this.flush(root, state);
            }, this.debounceMs);
        };

        watcher.on("add", queue);
        watcher.on("change", queue);
        watcher.on("unlink", queue);

        await new Promise<void>((resolve) => {
            watcher.once("ready", () => resolve());
            watcher.once("error", () => resolve());
        });

        return watcher;
    }

    private async flush(root: string, state: RootState): Promise<void> {
        const paths = [...state.pending];
        state.pending.clear();

        for (const path of paths) {
            const page = await this.parseFile(root, path);
            if (page) state.parsed.set(path, page);
            else state.parsed.delete(path);
        }

        state.data = buildWikiGraph(root, true, [...state.parsed.values()]);
        this.onChange(state.data);
    }
}

export { WikiIndexService };
