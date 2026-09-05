// packages/backend/src/services/recursive-watcher.ts
import { watch, realpathSync } from "fs";
import { isAbsolute, relative } from "path";

export interface WatchBatch {
    /** Root-relative paths with forward slashes; "" names the root itself. */
    paths: string[];
    /** True when `paths` are directories whose loaded descendants must be rescanned. */
    collapsed: boolean;
}

export interface RecursiveWatchOptions {
    /** Directory or file names that drop an event when they appear anywhere in the relative path. */
    ignoredNames: ReadonlySet<string>;
    /** Flush window in milliseconds; armed by the first event after a flush, not reset by later ones. */
    windowMs: number;
    /** Above this many pending paths a flush collapses to parent directories, then to the root. */
    maxPathsPerFlush: number;
    onFlush: (batch: WatchBatch) => void;
    onError?: (error: Error) => void;
}

export interface RecursiveWatchHandle {
    close(): void;
}

function normalizeSlashes(p: string): string {
    return p.replace(/\\/g, "/");
}

/**
 * Turn what `fs.watch` reports into a root-relative, forward-slash path.
 * Bun reports relative names (verified on macOS, symlinked roots included),
 * but an absolute name is tolerated and resolved against any of `roots`,
 * which holds the root as given and its real path. Returns "" for the root
 * itself and null for an absolute path outside every root.
 */
export function toRelativeWatchPath(roots: readonly string[], filename: string): string | null {
    const normalized = normalizeSlashes(filename);
    if (!isAbsolute(normalized)) return normalized;
    for (const root of roots) {
        const rel = normalizeSlashes(relative(root, normalized));
        if (rel === "") return "";
        if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) continue;
        return rel;
    }
    return null;
}

function rootForms(root: string): string[] {
    try {
        const real = realpathSync(root);
        return real === root ? [root] : [root, real];
    } catch {
        return [root];
    }
}

function hasIgnoredSegment(relativePath: string, ignoredNames: ReadonlySet<string>): boolean {
    let start = 0;
    while (start <= relativePath.length) {
        let end = relativePath.indexOf("/", start);
        if (end === -1) end = relativePath.length;
        if (end > start && ignoredNames.has(relativePath.slice(start, end))) return true;
        start = end + 1;
    }
    return false;
}

function parentOf(relativePath: string): string {
    const slash = relativePath.lastIndexOf("/");
    return slash === -1 ? "" : relativePath.slice(0, slash);
}

/**
 * What accumulated between two flushes. Collapses *while adding*, not at
 * flush time: Bun dispatches a native event backlog without yielding, so a
 * flood of non-ignored paths would otherwise be retained in full until the
 * timer could run. Past `maxPaths` the batch keeps parent directories
 * instead of files; past it again, or when the root itself changed, it
 * keeps only the root.
 */
export class PendingBatch {
    private readonly maxPaths: number;
    private paths = new Set<string>();
    private mode: "paths" | "parents" | "root" = "paths";

    constructor(maxPaths: number) {
        this.maxPaths = maxPaths;
    }

    add(relativePath: string): void {
        if (this.mode === "root") return;
        this.paths.add(this.mode === "parents" ? parentOf(relativePath) : relativePath);
        if (this.paths.size <= this.maxPaths) return;
        if (this.mode === "paths") {
            const parents = new Set<string>();
            for (const p of this.paths) parents.add(parentOf(p));
            this.paths = parents;
            this.mode = "parents";
            if (parents.size <= this.maxPaths) return;
        }
        this.markRoot();
    }

    markRoot(): void {
        this.mode = "root";
        this.paths.clear();
    }

    get size(): number {
        return this.mode === "root" ? 1 : this.paths.size;
    }

    take(): WatchBatch {
        const batch: WatchBatch =
            this.mode === "root"
                ? { paths: [""], collapsed: true }
                : { paths: [...this.paths], collapsed: this.mode === "parents" };
        this.paths = new Set();
        this.mode = "paths";
        return batch;
    }
}

export function watchRecursive(root: string, options: RecursiveWatchOptions): RecursiveWatchHandle {
    const { ignoredNames, windowMs, maxPathsPerFlush, onFlush, onError } = options;
    const roots = rootForms(root);
    const pending = new PendingBatch(maxPathsPerFlush);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const flush = (): void => {
        timer = null;
        if (closed) return;
        onFlush(pending.take());
    };

    const arm = (): void => {
        if (timer === null) timer = setTimeout(flush, windowMs);
    };

    const watcher = watch(root, { recursive: true }, (_eventType, filename) => {
        if (closed) return;
        const name = filename ?? "";
        const rel = name === "" ? "" : toRelativeWatchPath(roots, name);
        if (rel === null) return;
        if (rel === "") {
            pending.markRoot();
            arm();
            return;
        }
        if (hasIgnoredSegment(rel, ignoredNames)) return;
        pending.add(rel);
        arm();
    });

    const close = (): void => {
        if (closed) return;
        closed = true;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        pending.take();
        watcher.close();
    };

    watcher.on("error", (error: Error) => {
        if (closed) return;
        close();
        onError?.(error);
    });

    return { close };
}
