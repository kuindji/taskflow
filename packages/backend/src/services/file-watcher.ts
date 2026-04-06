import type { FileNode, FileChangeEvent } from "@taskflow/shared";
import chokidar, { type FSWatcher } from "chokidar";
import { readdir, readFile } from "fs/promises";
import { join, basename } from "path";

const IGNORED_NAMES = new Set([
    "node_modules",
    ".git",
    ".worktrees",
    "dist",
    ".next",
    ".superpowers",
    ".DS_Store",
]);

function shouldIgnoreEntry(name: string): boolean {
    return IGNORED_NAMES.has(name);
}

function normalizePath(p: string): string {
    return p.replace(/\\/g, "/");
}

interface ActiveWatcher {
    watcher: FSWatcher;
}

interface BuildTreeResult {
    tree: FileNode;
    gitignorePatterns: string[];
}

export class FileWatcher {
    private watchers = new Map<string, ActiveWatcher>();

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

    private shouldIgnorePath(path: string): boolean {
        return path
            .split("/")
            .filter(Boolean)
            .some((segment) => shouldIgnoreEntry(segment));
    }

    async watch(dirPath: string, onChange: (event: FileChangeEvent) => void): Promise<void> {
        await this.stop(dirPath);

        const watcher = chokidar.watch(dirPath, {
            ignored: (path) => this.shouldIgnorePath(path),
            ignoreInitial: true,
            ignorePermissionErrors: true,
            persistent: true,
        });

        watcher.on("add", (path) => onChange({ type: "create", path: normalizePath(path) }));
        watcher.on("addDir", (path) => onChange({ type: "create", path: normalizePath(path) }));
        watcher.on("change", (path) => onChange({ type: "modify", path: normalizePath(path) }));
        watcher.on("unlink", (path) => onChange({ type: "delete", path: normalizePath(path) }));
        watcher.on("unlinkDir", (path) => onChange({ type: "delete", path: normalizePath(path) }));

        await new Promise<void>((resolve, reject) => {
            watcher.once("ready", () => resolve());
            watcher.once("error", reject);
        });

        this.watchers.set(dirPath, { watcher });
    }

    async stop(dirPath: string): Promise<void> {
        const w = this.watchers.get(dirPath);
        if (w) {
            this.watchers.delete(dirPath);
            await w.watcher.close();
        }
    }

    async stopAll(): Promise<void> {
        await Promise.all(Array.from(this.watchers.keys(), (path) => this.stop(path)));
    }
}
