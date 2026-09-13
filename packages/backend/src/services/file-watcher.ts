import type { FileNode, FileChangeEvent } from "@taskflow/shared";
import { readdir, readFile, stat } from "fs/promises";
import { join, basename } from "path";
import { watchRecursive, type WatchBatch, type RecursiveWatchHandle } from "./recursive-watcher";

const IGNORED_NAMES = new Set([
    "node_modules",
    ".git",
    ".worktrees",
    "dist",
    ".next",
    ".superpowers",
    ".DS_Store",
]);

/** Generated trees the explorer still lists, but never watches. */
const WATCH_IGNORED_NAMES: ReadonlySet<string> = new Set([
    ...IGNORED_NAMES,
    ".venv",
    "venv",
    "__pycache__",
    ".ruff_cache",
    ".pytest_cache",
    ".mypy_cache",
    "Pods",
    ".expo",
    ".serverless",
    ".turbo",
    ".cache",
    ".gradle",
    "DerivedData",
]);

const WATCH_WINDOW_MS = 100;
const WATCH_MAX_PATHS_PER_FLUSH = 200;

function shouldIgnoreEntry(name: string): boolean {
    return IGNORED_NAMES.has(name);
}

function normalizePath(p: string): string {
    return p.replace(/\\/g, "/");
}

interface FileWatcherOptions {
    windowMs?: number;
    maxPathsPerFlush?: number;
}

interface ActiveWatcher {
    handle: RecursiveWatchHandle;
    /** Flipped by `stop` so a stat batch still in flight cannot emit afterwards. */
    state: { closed: boolean };
    /** Clients holding this watch. The handle closes when the last one goes. */
    owners: Set<string>;
}

interface BuildTreeResult {
    tree: FileNode;
    gitignorePatterns: string[];
}

export class FileWatcher {
    private watchers = new Map<string, ActiveWatcher>();
    private readonly windowMs: number;
    private readonly maxPathsPerFlush: number;

    constructor(options: FileWatcherOptions = {}) {
        this.windowMs = options.windowMs ?? WATCH_WINDOW_MS;
        this.maxPathsPerFlush = options.maxPathsPerFlush ?? WATCH_MAX_PATHS_PER_FLUSH;
    }

    async buildTree(dirPath: string, depth = 0): Promise<BuildTreeResult> {
        const name = basename(dirPath);
        const children: FileNode[] = [];
        const node: FileNode = { name, path: normalizePath(dirPath), type: "directory", children };

        let gitignorePatterns: string[] = [];

        if (depth > 10) return { tree: node, gitignorePatterns };

        try {
            const entries = await readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (shouldIgnoreEntry(entry.name)) continue;

                const fullPath = join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    const { tree: childTree } = await this.buildTree(fullPath, depth + 1);
                    children.push(childTree);
                } else {
                    children.push({
                        name: entry.name,
                        path: normalizePath(fullPath),
                        type: "file",
                    });
                }
            }
            children.sort((a, b) => {
                if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
        } catch {
            /* permission denied */
        }

        if (depth === 0) {
            try {
                const content = await readFile(join(dirPath, ".gitignore"), "utf-8");
                gitignorePatterns = content.split("\n");
            } catch {
                // No .gitignore — return empty patterns
            }
        }

        return { tree: node, gitignorePatterns };
    }

    async listDir(dirPath: string): Promise<{ entries: FileNode[]; gitignorePatterns: string[] }> {
        const entries: FileNode[] = [];
        let gitignorePatterns: string[] = [];

        try {
            const dirEntries = await readdir(dirPath, { withFileTypes: true });
            for (const entry of dirEntries) {
                if (shouldIgnoreEntry(entry.name)) continue;
                const fullPath = normalizePath(join(dirPath, entry.name));
                entries.push({
                    name: entry.name,
                    path: fullPath,
                    type: entry.isDirectory() ? "directory" : "file",
                });
            }
            entries.sort((a, b) => {
                if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
        } catch {
            /* permission denied */
        }

        try {
            const content = await readFile(join(dirPath, ".gitignore"), "utf-8");
            gitignorePatterns = content.split("\n");
        } catch {
            // No .gitignore
        }

        return { entries, gitignorePatterns };
    }

    /**
     * Watch `dirPath` on behalf of `clientId`. Several clients may watch one
     * path: the recursive watcher is shared and reference counted, because two
     * clients on one backend is now normal and one of them releasing must not
     * blind the other.
     */
    async watch(
        dirPath: string,
        clientId: string,
        onChange: (event: FileChangeEvent) => void,
    ): Promise<void> {
        const existing = this.watchers.get(dirPath);
        if (existing) {
            existing.owners.add(clientId);
            return;
        }
        const state = { closed: false };
        const emit = (event: FileChangeEvent): void => {
            if (!state.closed) onChange(event);
        };
        const active: ActiveWatcher = {
            handle: watchRecursive(dirPath, {
                ignoredNames: WATCH_IGNORED_NAMES,
                windowMs: this.windowMs,
                maxPathsPerFlush: this.maxPathsPerFlush,
                onFlush: (batch) => void this.emitBatch(dirPath, batch, emit),
                onError: (error) => {
                    console.error(`File watcher failed for ${dirPath}:`, error);
                    // The native watcher is gone. Forget it so the next FILE_WATCH
                    // creates a fresh one, and tell the client to refresh what it has.
                    if (this.watchers.get(dirPath) === active) this.watchers.delete(dirPath);
                    emit({ type: "modify", path: normalizePath(dirPath), recursive: true });
                    state.closed = true;
                },
            }),
            state,
            owners: new Set([clientId]),
        };
        this.watchers.set(dirPath, active);
    }

    /** Drop one client's interest in a path. Closes the handle only when the last goes. */
    async release(dirPath: string, clientId: string): Promise<void> {
        const entry = this.watchers.get(dirPath);
        if (!entry) return;
        entry.owners.delete(clientId);
        if (entry.owners.size === 0) await this.stop(dirPath);
    }

    /** Drop every path a client owned. Called when its connection closes. */
    async releaseClient(clientId: string): Promise<void> {
        const paths = [...this.watchers.entries()]
            .filter(([, entry]) => entry.owners.has(clientId))
            .map(([path]) => path);
        for (const path of paths) await this.release(path, clientId);
    }

    private async emitBatch(
        root: string,
        batch: WatchBatch,
        emit: (event: FileChangeEvent) => void,
    ): Promise<void> {
        if (batch.collapsed) {
            for (const rel of batch.paths) {
                const path = rel === "" ? root : join(root, rel);
                emit({ type: "modify", path: normalizePath(path), recursive: true });
            }
            return;
        }
        await Promise.all(
            batch.paths.map(async (rel) => {
                const path = join(root, rel);
                const exists = await stat(path).then(
                    () => true,
                    () => false,
                );
                emit({ type: exists ? "modify" : "delete", path: normalizePath(path) });
            }),
        );
    }

    private async stop(dirPath: string): Promise<void> {
        const active = this.watchers.get(dirPath);
        if (active) {
            this.watchers.delete(dirPath);
            active.state.closed = true;
            active.handle.close();
        }
    }

    async stopAll(): Promise<void> {
        await Promise.all(Array.from(this.watchers.keys(), (path) => this.stop(path)));
    }
}
