import { watchRecursive, type RecursiveWatchHandle, type WatchBatch } from "./recursive-watcher";
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

const WIKI_MAX_PATHS_PER_FLUSH = 200;

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
    /** The generation this state was built in; a stop invalidates it. */
    generation: number;
    watcher: RecursiveWatchHandle | null;
    /** Serializes incremental updates and full rebuilds so they never interleave on `parsed`. */
    work: Promise<void>;
}

/**
 * One in-memory wiki index per root, kept fresh by a recursive watcher. A
 * changed page re-parses alone and the graph is rebuilt from the cached page
 * map — at ~110 files a full rebuild is milliseconds, so nothing is persisted.
 */
class WikiIndexService {
    private readonly onChange: (data: WikiIndexData) => void;
    private readonly debounceMs: number;
    private readonly roots = new Map<string, RootState>();
    private readonly building = new Map<string, Promise<WikiIndexData>>();
    /**
     * Bumped by `stopAll`. A build that started before a stop must not install
     * a watcher afterwards, while a `get` issued after the stop must still be
     * able to index and watch — so this is a generation counter, not a flag.
     */
    private generation = 0;

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
        this.generation++;
        const states = [...this.roots.values()];
        this.roots.clear();
        for (const state of states) state.watcher?.close();
        await Promise.all(states.map((state) => state.work));
    }

    private async build(root: string): Promise<WikiIndexData> {
        const generation = this.generation;
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
        // The scan is async, so a stop can land in the middle of it. Answer the
        // caller, but do not register a watcher nobody will ever close.
        if (generation !== this.generation) return data;

        const state: RootState = {
            data,
            parsed,
            generation,
            watcher: null,
            work: Promise.resolve(),
        };
        this.roots.set(root, state);
        state.watcher = this.watch(root, state);
        if (generation !== this.generation) {
            if (this.roots.get(root) === state) this.roots.delete(root);
            state.watcher.close();
        }
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
            const [source, stats] = await Promise.all([
                readFile(filePath, "utf-8"),
                stat(filePath),
            ]);
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

    private watch(root: string, state: RootState): RecursiveWatchHandle {
        return watchRecursive(root, {
            ignoredNames: IGNORED_NAMES,
            windowMs: this.debounceMs,
            maxPathsPerFlush: WIKI_MAX_PATHS_PER_FLUSH,
            onFlush: (batch) => this.enqueue(state, () => this.applyBatch(root, state, batch)),
            onError: (error) => {
                console.error(`Wiki watcher failed for ${root}:`, error);
                this.enqueue(state, () => this.rebuild(root, state));
            },
        });
    }

    private enqueue(state: RootState, job: () => Promise<void>): void {
        state.work = state.work.then(job, job);
    }

    /**
     * A markdown path re-parses alone. Any other path that turns out to be a
     * directory, or to be gone, means a rename or removal whose pages cannot
     * be followed one by one, so the root is re-listed instead.
     */
    private async applyBatch(root: string, state: RootState, batch: WatchBatch): Promise<void> {
        if (state.generation !== this.generation) return;
        if (batch.collapsed) return this.rebuild(root, state);

        const markdown: string[] = [];
        for (const relativePath of batch.paths) {
            const filePath = join(root, relativePath);
            if (MARKDOWN.test(relativePath)) {
                markdown.push(filePath);
                continue;
            }
            const directoryOrGone = await stat(filePath).then(
                (stats) => stats.isDirectory(),
                () => true,
            );
            if (directoryOrGone) return this.rebuild(root, state);
        }
        if (markdown.length === 0) return;

        for (const filePath of markdown) {
            const page = await this.parseFile(root, filePath);
            if (page) state.parsed.set(filePath, page);
            else state.parsed.delete(filePath);
        }
        if (state.generation !== this.generation) return;
        state.data = buildWikiGraph(root, true, [...state.parsed.values()]);
        this.onChange(state.data);
    }

    /**
     * Re-list the root and re-parse everything. A vanished root is pushed as
     * missing and forgotten, so the next `get` can index it again.
     */
    private async rebuild(root: string, state: RootState): Promise<void> {
        if (state.generation !== this.generation) return;
        const rootExists = await stat(root).then(
            (stats) => stats.isDirectory(),
            () => false,
        );
        if (!rootExists) {
            if (this.roots.get(root) === state) this.roots.delete(root);
            state.watcher?.close();
            state.data = buildWikiGraph(root, false, []);
            this.onChange(state.data);
            return;
        }
        const files = new Set(await this.listMarkdown(root));
        for (const known of [...state.parsed.keys()]) {
            if (!files.has(known)) state.parsed.delete(known);
        }
        for (const filePath of files) {
            const page = await this.parseFile(root, filePath);
            if (page) state.parsed.set(filePath, page);
            else state.parsed.delete(filePath);
        }
        if (state.generation !== this.generation) return;
        state.data = buildWikiGraph(root, true, [...state.parsed.values()]);
        this.onChange(state.data);
    }
}

export { WikiIndexService };
