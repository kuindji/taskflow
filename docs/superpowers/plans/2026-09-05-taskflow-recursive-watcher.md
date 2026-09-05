# Recursive Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace chokidar in the backend's explorer and wiki watchers with a thin service over Bun's recursive `fs.watch` that filters synchronously, coalesces events per window, and caps per-flush volume, so a flood of filesystem events can no longer hang the backend or grow its memory.

**Architecture:** One new service, `watchRecursive`, owns the native callback (ignore check, pending set, throttle timer) and hands batches to callers. `FileWatcher` turns a batch into `FileChangeEvent`s (stat for delete versus modify; `recursive: true` when collapsed). `WikiIndexService` feeds a batch into its existing re-parse path or does a full re-list when collapsed. The UI learns one new optional flag on `FileChangeEvent`.

**Tech Stack:** Bun 1.4 runtime (`node:fs` `watch` with `recursive: true`), `bun:test`, TypeScript, zustand (UI store).

**Spec:** `docs/superpowers/specs/2026-09-05-taskflow-recursive-watcher-design.md`

## Global Constraints

- Use `bun` for everything (`bun test`, `bun run typecheck`, `bun run lint`); never npm or yarn.
- No `as any`; no disabling eslint rules; export only what another module uses.
- Commit messages: no `Co-Authored-By` trailer (project rule).
- Do not run `bun run format` without a path; it rewrites the whole repo.
- `FileChangeEvent.type` stays `"create" | "modify" | "delete"`; the backend stops emitting `"create"`.
- Explorer watch ignore set (watch only, display list unchanged): current names plus `.venv`, `venv`, `__pycache__`, `.ruff_cache`, `.pytest_cache`, `.mypy_cache`, `Pods`, `.expo`, `.serverless`, `.turbo`, `.cache`, `.gradle`, `DerivedData`.
- Explorer window 100 ms, wiki window `debounceMs` (default 150), `maxPathsPerFlush` 200 for both.
- Platforms: macOS and Windows only.

## File Structure

- Create `packages/backend/src/services/recursive-watcher.ts`: native callback, ignore filter, pending set, throttle timer, batch collapsing. Pure helpers `toRelativeWatchPath` and `PendingBatch` are exported because the tests exercise them without a filesystem.
- Create `packages/backend/tests/services/recursive-watcher.test.ts`.
- Modify `packages/backend/src/services/file-watcher.ts`: `watch`, `stop`, `stopAll` use the service; `buildTree` and `listDir` untouched.
- Modify `packages/backend/tests/services/file-watcher.test.ts`: add delete and overflow cases.
- Modify `packages/backend/src/services/wiki-index.ts`: `watch` uses the service; `applyBatch`, `enqueue` and `rebuild` replace `flush`; `RootState` loses `timer` and `pending`, gains `work`.
- Modify `packages/shared/src/types/file.ts`: `recursive?: boolean` on `FileChangeEvent`.
- Modify `packages/ui/src/stores/file-store.ts`: recursive events refetch loaded directories under the path.
- Create `packages/ui/src/stores/file-store.test.ts`.
- Modify `packages/ui/src/components/panes/MarkdownPaneImpl.tsx`: reload on an ancestor recursive event.
- Modify `packages/backend/package.json` and `bun.lock`: drop chokidar.
- Create `scripts/watch-backlog-repro.mjs`: manual regression script.

---

### Task 1: `watchRecursive` service with pure helpers

**Files:**
- Create: `packages/backend/src/services/recursive-watcher.ts`
- Test: `packages/backend/tests/services/recursive-watcher.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface WatchBatch { paths: string[]; collapsed: boolean }
  interface RecursiveWatchOptions {
      ignoredNames: ReadonlySet<string>;
      windowMs: number;
      maxPathsPerFlush: number;
      onFlush: (batch: WatchBatch) => void;
      onError?: (error: Error) => void;
  }
  interface RecursiveWatchHandle { close(): void }
  function watchRecursive(root: string, options: RecursiveWatchOptions): RecursiveWatchHandle
  function toRelativeWatchPath(roots: readonly string[], filename: string): string | null
  class PendingBatch {
      constructor(maxPaths: number)
      add(relativePath: string): void   // collapses synchronously once the cap is crossed
      markRoot(): void                  // the root itself changed: everything collapses to [""]
      take(): WatchBatch                // returns and resets
  }
  ```
  `paths` are root-relative with forward slashes; `""` names the root itself. `collapsed: true` means every path is a directory whose loaded descendants must be rescanned. `roots` holds the root as given plus its real path, so an absolute filename reported against either form resolves. `PendingBatch` collapses inside `add`, so memory held between flushes is capped at `maxPaths` strings even when the event loop cannot run.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/backend/tests/services/recursive-watcher.test.ts
import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
    watchRecursive,
    toRelativeWatchPath,
    PendingBatch,
    type WatchBatch,
    type RecursiveWatchHandle,
} from "../../src/services/recursive-watcher";

async function waitFor<T>(read: () => T | undefined, timeoutMs = 4000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = read();
        if (value !== undefined) return value;
        if (Date.now() > deadline) throw new Error("timed out waiting for condition");
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * FSEvents replays changes made shortly before the stream opened (the
 * directories `setup()` just created). Let that warm-up batch land and
 * discard it so each test only sees what it did itself.
 */
async function settled(batches: WatchBatch[]): Promise<void> {
    await sleep(400);
    batches.length = 0;
}

describe("toRelativeWatchPath", () => {
    it("normalizes backslashes", () => {
        expect(toRelativeWatchPath(["/root"], "a\\b\\c.txt")).toBe("a/b/c.txt");
    });

    it("makes an absolute filename relative to the root", () => {
        expect(toRelativeWatchPath(["/root"], "/root/a/b.txt")).toBe("a/b.txt");
    });

    it("resolves an absolute real path against the root's real path", () => {
        expect(toRelativeWatchPath(["/var/x", "/private/var/x"], "/private/var/x/a.txt")).toBe("a.txt");
    });

    it("returns the empty string for the root itself", () => {
        expect(toRelativeWatchPath(["/root"], "/root")).toBe("");
    });

    it("drops absolute filenames outside every root", () => {
        expect(toRelativeWatchPath(["/root"], "/elsewhere/x.txt")).toBeNull();
        expect(toRelativeWatchPath(["/root"], "/rootling/x.txt")).toBeNull();
    });
});

describe("PendingBatch", () => {
    it("passes small batches through unchanged and resets on take", () => {
        const batch = new PendingBatch(10);
        batch.add("a/1.txt");
        batch.add("b/2.txt");
        batch.add("a/1.txt");
        expect(batch.take()).toEqual({ paths: ["a/1.txt", "b/2.txt"], collapsed: false });
        expect(batch.take()).toEqual({ paths: [], collapsed: false });
    });

    it("collapses to parent directories as soon as the cap is crossed, and keeps adding parents", () => {
        const batch = new PendingBatch(3);
        for (const p of ["a/1.txt", "a/2.txt", "b/c/3.txt", "top.txt"]) batch.add(p);
        batch.add("a/4.txt");
        batch.add("b/c/5.txt");
        const taken = batch.take();
        expect(taken.collapsed).toBe(true);
        expect(taken.paths.sort()).toEqual(["", "a", "b/c"]);
    });

    it("collapses to the root when parents exceed the cap, and ignores further adds", () => {
        const batch = new PendingBatch(2);
        for (const p of ["a/1", "b/2", "c/3", "d/4"]) batch.add(p);
        batch.add("e/5");
        expect(batch.take()).toEqual({ paths: [""], collapsed: true });
    });

    it("collapses to the root when the root itself changed", () => {
        const batch = new PendingBatch(10);
        batch.add("a/1");
        batch.markRoot();
        batch.add("b/2");
        expect(batch.take()).toEqual({ paths: [""], collapsed: true });
    });

    it("never holds more than the cap in memory", () => {
        const batch = new PendingBatch(100);
        for (let i = 0; i < 100000; i++) batch.add(`dir${i % 1000}/file${i}.txt`);
        expect(batch.size).toBeLessThanOrEqual(100);
        expect(batch.take()).toEqual({ paths: [""], collapsed: true });
    });
});

describe("watchRecursive", () => {
    let root: string;
    let handle: RecursiveWatchHandle | null = null;

    afterEach(async () => {
        handle?.close();
        handle = null;
        if (root) await rm(root, { recursive: true, force: true });
    });

    async function setup(): Promise<void> {
        root = await realpath(await mkdtemp(join(tmpdir(), "taskflow-rw-")));
        await mkdir(join(root, "src", "deep"), { recursive: true });
        await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    }

    it("delivers a change under the root as a relative path", async () => {
        await setup();
        const batches: WatchBatch[] = [];
        handle = watchRecursive(root, {
            ignoredNames: new Set(["node_modules"]),
            windowMs: 30,
            maxPathsPerFlush: 100,
            onFlush: (batch) => batches.push(batch),
        });
        await settled(batches);
        await writeFile(join(root, "src", "deep", "a.txt"), "x");
        const batch = await waitFor(() => batches.find((b) => b.paths.includes("src/deep/a.txt")));
        expect(batch.collapsed).toBe(false);
    });

    it("never flushes for changes under an ignored directory", async () => {
        await setup();
        const batches: WatchBatch[] = [];
        handle = watchRecursive(root, {
            ignoredNames: new Set(["node_modules"]),
            windowMs: 30,
            maxPathsPerFlush: 100,
            onFlush: (batch) => batches.push(batch),
        });
        await settled(batches);
        for (let i = 0; i < 20; i++) {
            await writeFile(join(root, "node_modules", "pkg", `${i}.js`), "x");
        }
        await sleep(400);
        expect(batches).toEqual([]);
    });

    it("coalesces many changes inside one window into one flush of unique paths", async () => {
        await setup();
        const batches: WatchBatch[] = [];
        handle = watchRecursive(root, {
            ignoredNames: new Set(),
            windowMs: 300,
            maxPathsPerFlush: 100,
            onFlush: (batch) => batches.push(batch),
        });
        await settled(batches);
        for (let i = 0; i < 10; i++) {
            await writeFile(join(root, "src", `f${i % 5}.txt`), `${i}`);
        }
        await waitFor(() => (batches.length > 0 ? true : undefined));
        await sleep(400);
        expect(batches).toHaveLength(1);
        const paths = batches[0].paths.filter((p) => p.startsWith("src/f"));
        expect(new Set(paths).size).toBe(paths.length);
        expect(paths.length).toBeLessThanOrEqual(5);
    });

    it("keeps flushing while changes keep coming (throttle, not trailing debounce)", async () => {
        await setup();
        const batches: WatchBatch[] = [];
        handle = watchRecursive(root, {
            ignoredNames: new Set(),
            windowMs: 50,
            maxPathsPerFlush: 100,
            onFlush: (batch) => batches.push(batch),
        });
        await settled(batches);
        const started = Date.now();
        let i = 0;
        while (Date.now() - started < 800) {
            await writeFile(join(root, "src", `hot-${i++ % 20}.txt`), `${Date.now()}`);
            await sleep(10);
        }
        expect(batches.length).toBeGreaterThanOrEqual(3);
    });

    it("tolerates a second close", async () => {
        await setup();
        const w = watchRecursive(root, {
            ignoredNames: new Set(),
            windowMs: 30,
            maxPathsPerFlush: 100,
            onFlush: () => {},
        });
        w.close();
        expect(() => w.close()).not.toThrow();
    });

    it("collapses an oversized flush to parent directories", async () => {
        await setup();
        const batches: WatchBatch[] = [];
        handle = watchRecursive(root, {
            ignoredNames: new Set(),
            windowMs: 300,
            maxPathsPerFlush: 3,
            onFlush: (batch) => batches.push(batch),
        });
        await settled(batches);
        for (let i = 0; i < 8; i++) {
            await writeFile(join(root, "src", "deep", `f${i}.txt`), "x");
        }
        const batch = await waitFor(() => batches.find((b) => b.collapsed));
        expect(batch.paths).toEqual(["src/deep"]);
    });

    it("stops delivering after close", async () => {
        await setup();
        const batches: WatchBatch[] = [];
        handle = watchRecursive(root, {
            ignoredNames: new Set(),
            windowMs: 30,
            maxPathsPerFlush: 100,
            onFlush: (batch) => batches.push(batch),
        });
        await settled(batches);
        handle.close();
        handle = null;
        await writeFile(join(root, "src", "late.txt"), "x");
        await sleep(300);
        expect(batches).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/recursive-watcher.test.ts`
Expected: FAIL, module `../../src/services/recursive-watcher` not found.

- [ ] **Step 3: Write the implementation**

```ts
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
```

Behaviour notes verified on Bun 1.4 / macOS while planning: a root reached through a symlink (`/var/...`) still reports relative names; deleting the root produces no event and no error, the watcher just goes quiet. Windows may raise `EPERM` when the watched root is deleted; that reaches `onError`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/recursive-watcher.test.ts`
Expected: all PASS. If "keeps flushing while changes keep coming" is flaky on FSEvents latency, raise its loop from 600 ms to 1000 ms; do not lower the assertion below 3.

- [ ] **Step 5: Typecheck and lint the new file**

Run: `cd packages/backend && bunx tsc --noEmit && cd ../.. && bunx eslint packages/backend/src/services/recursive-watcher.ts packages/backend/tests/services/recursive-watcher.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/recursive-watcher.ts packages/backend/tests/services/recursive-watcher.test.ts
git commit -m "feat(backend): add recursive watcher with synchronous ignore and batching"
```

---

### Task 2: `recursive` flag on `FileChangeEvent`

**Files:**
- Modify: `packages/shared/src/types/file.ts:10-13`

**Interfaces:**
- Produces: `FileChangeEvent.recursive?: boolean`, used by Tasks 3, 5 and 6.

- [ ] **Step 1: Add the field**

```ts
export interface FileChangeEvent {
    type: "create" | "modify" | "delete";
    path: string;
    /**
     * Set when many changes were collapsed into one event: `path` is a
     * directory and everything loaded under it should be refreshed.
     */
    recursive?: boolean;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes (the field is optional).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/file.ts
git commit -m "feat(shared): mark collapsed file change events as recursive"
```

---

### Task 3: `FileWatcher.watch` on the new service

**Files:**
- Modify: `packages/backend/src/services/file-watcher.ts` (imports, lines 1-4; `ActiveWatcher`, lines 24-26; `shouldIgnorePath` and `watch`/`stop`/`stopAll`, lines 115-157)
- Test: `packages/backend/tests/services/file-watcher.test.ts`

**Interfaces:**
- Consumes: `watchRecursive`, `WatchBatch`, `RecursiveWatchHandle` from Task 1; `FileChangeEvent.recursive` from Task 2.
- Produces: unchanged public API `watch(dirPath, onChange)`, `stop(dirPath)`, `stopAll()`, plus an optional constructor argument `FileWatcherOptions { windowMs?: number; maxPathsPerFlush?: number }` so tests can force a collapse.

- [ ] **Step 1: Write the failing tests** (append inside `describe("FileWatcher")`, after "watches for file changes")

```ts
    it("collapses a burst into a recursive directory event", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-fw-test-"));
        await mkdir(join(tempDir, "src"));
        watcher = new FileWatcher({ windowMs: 300, maxPathsPerFlush: 3 });

        const events: FileChangeEvent[] = [];
        await watcher.watch(tempDir, (event) => events.push(event));
        // FSEvents replays the mkdir above once the stream opens; let it pass first.
        await new Promise((resolve) => setTimeout(resolve, 400));
        events.length = 0;
        for (let i = 0; i < 8; i++) {
            await writeFile(join(tempDir, "src", `f${i}.ts`), "x");
        }

        const started = Date.now();
        while (!events.some((e) => e.recursive) && Date.now() - started < 3000) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const collapsed = events.filter((e) => e.recursive);
        expect(collapsed.length).toBeGreaterThanOrEqual(1);
        expect(collapsed.every((e) => e.type === "modify")).toBe(true);
        expect(collapsed.some((e) => e.path.endsWith("/src"))).toBe(true);
    });

    it("reports a deleted file as delete and a written file as modify", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-fw-test-"));
        await writeFile(join(tempDir, "gone.ts"), "x");
        watcher = new FileWatcher();

        const events: FileChangeEvent[] = [];
        await watcher.watch(tempDir, (event) => events.push(event));
        await new Promise((resolve) => setTimeout(resolve, 100));
        await rm(join(tempDir, "gone.ts"));
        await writeFile(join(tempDir, "kept.ts"), "y");

        const started = Date.now();
        while (events.length < 2 && Date.now() - started < 3000) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const gone = events.find((e) => e.path.endsWith("/gone.ts"));
        const kept = events.find((e) => e.path.endsWith("/kept.ts"));
        expect(gone?.type).toBe("delete");
        expect(kept?.type).toBe("modify");
        expect(gone?.recursive).toBeUndefined();
    });

    it("does not report changes under a watch-ignored directory such as .venv", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-fw-test-"));
        await mkdir(join(tempDir, ".venv", "lib"), { recursive: true });
        watcher = new FileWatcher();

        const events: FileChangeEvent[] = [];
        await watcher.watch(tempDir, (event) => events.push(event));
        await new Promise((resolve) => setTimeout(resolve, 100));
        for (let i = 0; i < 10; i++) {
            await writeFile(join(tempDir, ".venv", "lib", `${i}.py`), "x");
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(events).toEqual([]);
    });
```

Add to the test file's imports: `import type { FileChangeEvent } from "@taskflow/shared";`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/file-watcher.test.ts`
Expected: the collapse test fails (`FileWatcher` takes no options and chokidar never sets `recursive`); the delete test fails (chokidar reports `add` as `create`, so `kept?.type` is `"create"`); the `.venv` test fails because chokidar does not ignore `.venv`.

- [ ] **Step 3: Rewrite the watching half of `FileWatcher`**

Replace the imports at the top of `file-watcher.ts`:

```ts
import type { FileNode, FileChangeEvent } from "@taskflow/shared";
import { readdir, readFile, stat } from "fs/promises";
import { join, basename } from "path";
import { watchRecursive, type WatchBatch, type RecursiveWatchHandle } from "./recursive-watcher";
```

Keep `IGNORED_NAMES`, `shouldIgnoreEntry`, `normalizePath`, `buildTree`, `listDir` as they are. Add the watch-only set after `IGNORED_NAMES`:

```ts
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
```

Replace `ActiveWatcher` and add the options type:

```ts
interface FileWatcherOptions {
    windowMs?: number;
    maxPathsPerFlush?: number;
}

interface ActiveWatcher {
    handle: RecursiveWatchHandle;
    /** Flipped by `stop` so a stat batch still in flight cannot emit afterwards. */
    state: { closed: boolean };
}
```

Delete `shouldIgnorePath`. Give the class a constructor and replace `watch`, `stop`, `stopAll`:

```ts
export class FileWatcher {
    private watchers = new Map<string, ActiveWatcher>();
    private readonly windowMs: number;
    private readonly maxPathsPerFlush: number;

    constructor(options: FileWatcherOptions = {}) {
        this.windowMs = options.windowMs ?? WATCH_WINDOW_MS;
        this.maxPathsPerFlush = options.maxPathsPerFlush ?? WATCH_MAX_PATHS_PER_FLUSH;
    }

    // buildTree and listDir unchanged

    async watch(dirPath: string, onChange: (event: FileChangeEvent) => void): Promise<void> {
        await this.stop(dirPath);
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
        };
        this.watchers.set(dirPath, active);
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

    async stop(dirPath: string): Promise<void> {
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
```

- [ ] **Step 4: Run the file watcher tests**

Run: `cd packages/backend && bun test tests/services/file-watcher.test.ts`
Expected: all PASS, including the pre-existing "watches for file changes" (its temp dir is under the `/var` symlink; `toRelativeWatchPath` handles an absolute real path if Bun reports one).

- [ ] **Step 5: Typecheck and lint**

Run: `cd packages/backend && bunx tsc --noEmit && cd ../.. && bunx eslint packages/backend/src/services/file-watcher.ts packages/backend/tests/services/file-watcher.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/file-watcher.ts packages/backend/tests/services/file-watcher.test.ts
git commit -m "fix(backend): watch workspaces with the recursive watcher instead of chokidar"
```

---

### Task 4: `WikiIndexService.watch` on the new service

**Files:**
- Modify: `packages/backend/src/services/wiki-index.ts` (imports line 1; `RootState` lines 35-43; `stopAll` lines 79-89; `build` lines 122-128; `watch` lines 165-197; `flush` lines 199-212)
- Test: `packages/backend/tests/services/wiki-index.test.ts` (existing tests unchanged; one added)

**Interfaces:**
- Consumes: `watchRecursive`, `RecursiveWatchHandle`, `WatchBatch` from Task 1.
- Produces: unchanged public API `get(root)`, `stopAll()`, constructor option `debounceMs`.

- [ ] **Step 1: Write the failing test** (append inside `describe("WikiIndexService")`; add `rename` to the `fs/promises` import at the top of the file)

```ts
    it("follows a renamed directory of pages", async () => {
        await service.get(root);
        await rename(join(root, "business"), join(root, "finance"));
        const data = await waitFor(() =>
            changes.at(-1)?.pages.some((p) => p.id === "finance/money") ? changes.at(-1) : undefined,
        );
        expect(data.pages.map((p) => p.id).sort()).toEqual(["finance/money", "index"]);
        expect(data.unresolved).toEqual([{ from: "index", target: "business/money" }]);
    });
```

- [ ] **Step 2: Run the wiki tests to verify the new one fails and the rest pass**

Run: `cd packages/backend && bun test tests/services/wiki-index.test.ts`
Expected: all tests pass, the new one included. (Observed while executing: chokidar's fsevents handler does follow a directory rename through its own `unlinkDir`/`addDir` bookkeeping, so this test is a regression guard for behaviour the new implementation must keep, not a red test.)

- [ ] **Step 3: Rewrite the watch path**

Replace line 1:

```ts
import { watchRecursive, type RecursiveWatchHandle, type WatchBatch } from "./recursive-watcher";
```

Add after `MARKDOWN`:

```ts
const WIKI_MAX_PATHS_PER_FLUSH = 200;
```

Replace `RootState`:

```ts
interface RootState {
    data: WikiIndexData;
    parsed: Map<string, ParsedWikiPage>;
    /** The generation this state was built in; a stop invalidates it. */
    generation: number;
    watcher: RecursiveWatchHandle | null;
    /** Serializes incremental updates and full rebuilds so they never interleave on `parsed`. */
    work: Promise<void>;
}
```

Replace `stopAll`:

```ts
    async stopAll(): Promise<void> {
        this.generation++;
        const states = [...this.roots.values()];
        this.roots.clear();
        for (const state of states) state.watcher?.close();
        await Promise.all(states.map((state) => state.work));
    }
```

In `build`, replace the block from `const state: RootState = {` through `return data;` with:

```ts
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
```

Replace `watch` and `flush` with the four methods below. Every non-ignored path is queued (no `accept` filter): a markdown path re-parses alone, while a path that turns out to be a directory or to be gone means a rename or removal whose pages cannot be followed one by one, so the root is re-listed.

```ts
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

    /** Re-list the root and re-parse everything. A vanished root is pushed as missing and forgotten, so the next `get` can index it again. */
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
```

- [ ] **Step 4: Run the wiki tests**

Run: `cd packages/backend && bun test tests/services/wiki-index.test.ts`
Expected: all PASS, including the rename test. If "pushes a new index when a page is deleted" times out, check that `join(root, relativePath)` matches the keys produced by `listMarkdown` (both build from the same `root` string).

- [ ] **Step 5: Typecheck and lint**

Run: `cd packages/backend && bunx tsc --noEmit && cd ../.. && bunx eslint packages/backend/src/services/wiki-index.ts packages/backend/tests/services/wiki-index.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/wiki-index.ts packages/backend/tests/services/wiki-index.test.ts
git commit -m "fix(backend): watch wiki roots with the recursive watcher instead of chokidar"
```

---

### Task 5: Explorer store handles recursive events

**Files:**
- Modify: `packages/ui/src/stores/file-store.ts` (helpers after `isDirLoaded`, line 42; module state lines 90-95; `FILE_CHANGED` handler lines 186-204)
- Create: `packages/ui/src/stores/file-store.test.ts`

**Interfaces:**
- Consumes: `FileChangeEvent.recursive` from Task 2.

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/stores/file-store.test.ts
import { describe, expect, mock, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { FileNode } from "@taskflow/shared";

const sent: { type: string; payload: unknown }[] = [];
const handlers = new Map<string, (payload: unknown) => void>();

await mock.module("@/hooks/useWebSocket", () => ({
    onEvent: (type: string, handler: (payload: unknown) => void) => {
        handlers.set(type, handler);
        return () => {};
    },
    sendRequest: (type: string, payload: unknown) => {
        sent.push({ type, payload });
        if (type === MSG.FILE_LIST_DIR) return Promise.resolve({ entries: [], gitignorePatterns: [] });
        return Promise.resolve({});
    },
    sendFireAndForget: (type: string, payload: unknown) => {
        sent.push({ type, payload });
    },
    getBackendPort: () => 7100,
    onStatusChange: () => () => {},
    connectWebSocket: () => Promise.resolve(),
}));

const { useFileStore } = await import("./file-store");

const root = "/repo";
const tree: FileNode = {
    name: "repo",
    path: root,
    type: "directory",
    loaded: true,
    children: [
        {
            name: "src",
            path: `${root}/src`,
            type: "directory",
            loaded: true,
            children: [
                { name: "deep", path: `${root}/src/deep`, type: "directory", loaded: true, children: [] },
                { name: "closed", path: `${root}/src/closed`, type: "directory", children: [] },
            ],
        },
        { name: "docs", path: `${root}/docs`, type: "directory", loaded: true, children: [] },
    ],
};

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 250));
}

function listedDirs(): string[] {
    return sent
        .filter((m) => m.type === MSG.FILE_LIST_DIR)
        .map((m) => (m.payload as { path: string }).path)
        .sort();
}

describe("file-store recursive change events", () => {
    test("a recursive event refetches every loaded directory at or under its path", async () => {
        await useFileStore.getState().watchPath(root);
        useFileStore.setState({ tree, treePath: root, watchedPath: root });
        sent.length = 0;

        handlers.get(MSG.FILE_CHANGED)?.({ type: "modify", path: `${root}/src`, recursive: true });
        await settle();

        // Loaded dirs at or under the path, plus the path's parent (the dir itself may be gone).
        expect(listedDirs()).toEqual([root, `${root}/src`, `${root}/src/deep`]);
    });

    test("a recursive event below the root also refreshes the nearest loaded parent", async () => {
        useFileStore.setState({ tree, treePath: root, watchedPath: root });
        sent.length = 0;

        // The collapsed directory may itself have been deleted; only its parent's listing can show that.
        handlers.get(MSG.FILE_CHANGED)?.({ type: "modify", path: `${root}/src/deep`, recursive: true });
        await settle();

        expect(listedDirs()).toEqual([`${root}/src`, `${root}/src/deep`]);
    });

    test("a plain event still refetches only the parent directory", async () => {
        useFileStore.setState({ tree, treePath: root, watchedPath: root });
        sent.length = 0;

        handlers.get(MSG.FILE_CHANGED)?.({ type: "modify", path: `${root}/docs/a.md` });
        await settle();

        expect(listedDirs()).toEqual([`${root}/docs`]);
    });

    test("an event for a sibling path that merely shares the root's prefix is ignored", async () => {
        useFileStore.setState({ tree, treePath: root, watchedPath: root });
        sent.length = 0;

        handlers.get(MSG.FILE_CHANGED)?.({ type: "modify", path: `${root}-old/docs/a.md` });
        await settle();

        expect(listedDirs()).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/ui/src/stores/file-store.test.ts`
Expected: the two recursive tests FAIL (the store treats a recursive event as a file and refetches only its parent). The plain-event and sibling-prefix tests pass on the old code (the sibling's parent is never a loaded directory, so nothing is fetched either way); they guard existing behaviour and the boundary check added below.

- [ ] **Step 3: Implement**

After `isDirLoaded` (line 42) add:

```ts
function isSameOrChild(path: string, root: string): boolean {
    return path === root || path.startsWith(root + "/");
}

function collectLoadedDirs(root: FileNode, prefix: string, out: Set<string>): void {
    if (root.type !== "directory") return;
    const inside = root.path === prefix || root.path.startsWith(prefix + "/");
    if (inside && root.loaded === true) out.add(root.path);
    if (!root.children) return;
    for (const child of root.children) {
        if (child.type !== "directory") continue;
        if (inside || prefix === child.path || prefix.startsWith(child.path + "/")) {
            collectLoadedDirs(child, prefix, out);
        }
    }
}
```

Add a module-level set next to `pendingChangedDirs` (search for its declaration near line 92):

```ts
const pendingRecursiveDirs = new Set<string>();
```

Replace the `FILE_CHANGED` handler body:

```ts
            onEvent(MSG.FILE_CHANGED, (payload) => {
                const event = payload as FileChangeEvent;
                const watchedPath = get().watchedPath;
                if (!watchedPath || !isSameOrChild(event.path, watchedPath)) return;
                if (event.recursive) {
                    pendingRecursiveDirs.add(event.path);
                    // The collapsed directory itself may be gone; its parent's listing shows that.
                    if (event.path !== watchedPath) {
                        pendingChangedDirs.add(event.path.substring(0, event.path.lastIndexOf("/")));
                    }
                } else {
                    pendingChangedDirs.add(event.path.substring(0, event.path.lastIndexOf("/")));
                }
                if (fileChangeRefreshTimer) clearTimeout(fileChangeRefreshTimer);
                fileChangeRefreshTimer = setTimeout(() => {
                    const tree = get().tree;
                    if (tree) {
                        const dirs = new Set<string>();
                        for (const dir of pendingChangedDirs) {
                            if (isDirLoaded(tree, dir)) dirs.add(dir);
                        }
                        for (const dir of pendingRecursiveDirs) collectLoadedDirs(tree, dir, dirs);
                        for (const dir of dirs) get().fetchDir(dir).catch(console.error);
                    }
                    pendingChangedDirs.clear();
                    pendingRecursiveDirs.clear();
                    get().fetchGitStatus(watchedPath).catch(console.error);
                }, 150);
            });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/ui/src/stores/file-store.test.ts`
Expected: all four PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `cd packages/ui && bunx tsc --noEmit && cd ../.. && bunx eslint packages/ui/src/stores/file-store.ts packages/ui/src/stores/file-store.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/stores/file-store.ts packages/ui/src/stores/file-store.test.ts
git commit -m "feat(ui): refresh loaded folders under a recursive file change event"
```

---

### Task 6: Markdown pane reloads on an ancestor recursive event

**Files:**
- Modify: `packages/ui/src/components/panes/MarkdownPaneImpl.tsx:266-273`

- [ ] **Step 1: Replace the effect**

```tsx
    // Track file changes
    useEffect(() => {
        return onEvent(MSG.FILE_CHANGED, (payload) => {
            const event = payload as FileChangeEvent;
            if (event.type === "delete") return;
            const covers = event.recursive
                ? filePath === event.path || filePath.startsWith(event.path + "/")
                : event.path === filePath;
            if (covers) void loadContent();
        });
    }, [filePath, loadContent]);
```

- [ ] **Step 2: Run the pane's existing tests, typecheck, lint**

Run: `bun test packages/ui/src/components/panes/MarkdownPaneImpl.checkbox.test.tsx && cd packages/ui && bunx tsc --noEmit && cd ../.. && bunx eslint packages/ui/src/components/panes/MarkdownPaneImpl.tsx`
Expected: PASS, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/panes/MarkdownPaneImpl.tsx
git commit -m "fix(ui): reload markdown pane when a recursive change covers its file"
```

---

### Task 7: Drop chokidar, add the regression script, full verification

**Files:**
- Modify: `packages/backend/package.json:24`, `bun.lock`
- Create: `scripts/watch-backlog-repro.mjs`

- [ ] **Step 1: Remove the dependency**

Run: `cd packages/backend && bun remove chokidar && cd ../.. && grep -c chokidar bun.lock; grep -n chokidar packages/backend/package.json`
Expected: `0` and no output. `fsevents` stays in `bun.lock` as an optional dependency of Vite/Rollup for the UI package; that is expected and outside the backend binary.

- [ ] **Step 2: Confirm nothing imports chokidar**

Run: `grep -rn chokidar packages electron --include='*.ts' --include='*.tsx' --include='*.json' | grep -v node_modules`
Expected: no output.

- [ ] **Step 3: Add the manual regression script**

```js
// scripts/watch-backlog-repro.mjs
// Manual check for the 2026-09-05 backend hang. A child process creates N
// files under the watched root while this thread is deliberately blocked, so
// a backlog of filesystem events accumulates. After the block, the script
// reports how long the event loop stayed starved while Bun dispatched the
// backlog and how much memory that left behind. Node caps a dispatch pass;
// Bun drains the whole backlog, which is why the backend keeps its per-event
// work to a synchronous ignore check and a Set insert.
//
// Usage: bun scripts/watch-backlog-repro.mjs /tmp/watch-repro [files=100000] [blockMs=20000]
import { watch, mkdirSync, rmSync } from "fs";
import { spawn } from "child_process";
import { join } from "path";

const ROOT = process.argv[2];
const N = Number(process.argv[3] ?? 100000);
const BLOCK_MS = Number(process.argv[4] ?? 20000);
if (!ROOT) throw new Error("usage: watch-backlog-repro <root> [files] [blockMs]");

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(join(ROOT, "src"), { recursive: true });

let events = 0;
const watcher = watch(ROOT, { recursive: true }, () => events++);
const rss = () => (process.memoryUsage().rss / 1e6).toFixed(0);
const t0 = Date.now();
const T = () => ((Date.now() - t0) / 1000).toFixed(2) + "s";
const rt = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
console.log(`[${rt}] watching ${ROOT}; N=${N} block=${BLOCK_MS}ms rss=${rss()}MB`);

const dir = join(ROOT, "src", "burst");
const script = `mkdir -p '${dir}' && cd '${dir}' && for i in $(seq 1 ${N}); do : > f$i; done && echo burst-done`;
const child = spawn("bash", ["-c", script], { stdio: "inherit" });

await new Promise((resolve) => setTimeout(resolve, 500));
console.log(`[${rt}] ${T()} blocking the JS thread for ${BLOCK_MS}ms`);
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BLOCK_MS);
const unblockedAt = Date.now();
console.log(`[${rt}] ${T()} unblocked; events so far=${events} rss=${rss()}MB`);

setTimeout(() => {
    console.log(`[${rt}] ${T()} first timer ran ${Date.now() - unblockedAt}ms after unblock; events=${events} rss=${rss()}MB`);
}, 0);

let ticks = 0;
const interval = setInterval(() => {
    ticks++;
    console.log(`[${rt}] ${T()} events=${events} rss=${rss()}MB`);
    if (ticks >= 5) {
        clearInterval(interval);
        watcher.close();
        child.kill();
        rmSync(ROOT, { recursive: true, force: true });
        process.exit(0);
    }
}, 2000);
```

- [ ] **Step 4: Run the script once to confirm it works**

Run: `bun scripts/watch-backlog-repro.mjs /tmp/watch-repro 50000 10000`
Expected: prints a "first timer ran ... after unblock" line; the number is well under a second, the root is removed afterwards.

- [ ] **Step 5: Full verification**

Run, in order:

```bash
bun run typecheck
bun run lint
cd packages/backend && bun test && cd ../..
bun test packages/ui/src/stores/file-store.test.ts
bun test packages/ui/src/components/panes/MarkdownPaneImpl.checkbox.test.tsx
```

Expected: all clean. UI component tests run per file on purpose (`mock.module` leaks across files).

- [ ] **Step 6: Build the backend binary and smoke it against a real workspace**

Run: `bun run build:backend:bin && ls -la packages/backend/dist/taskflow-backend`
Expected: builds without a `.node` embedding step for fsevents.

Then start the dev sandbox as described in the memory note "Dev backend sandbox" (fake `HOME`, `TASKFLOW_DEV_PORT`), open a project pointing at a large workspace such as `/Users/kuindji/Projects/TheFloorr/monorepo`, open the file explorer, and confirm: the watch starts instantly (no multi-second scan), editing a file refreshes its folder, and running `bun scripts/watch-backlog-repro.mjs <workspace>/src/burst-check 100000 5000` against a subfolder does not freeze the backend's health endpoint for more than a second.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/package.json bun.lock scripts/watch-backlog-repro.mjs
git commit -m "chore(backend): drop chokidar and add the watch backlog regression script"
```

---

## Self-review against the spec

- Service, callback rules, throttle timer, collapse rules, close and error handling: Task 1.
- Explorer watcher with the broader ignore set, stat labeling, `recursive` events, instant start: Tasks 2 and 3.
- Wiki watcher queuing every non-ignored path, incremental markdown re-parse, rebuild on directory-shaped or vanished paths and on collapse, serialized per root, generation logic intact: Task 4.
- UI refetch of loaded directories and markdown pane reload: Tasks 5 and 6.
- Dependency removal and manual regression script: Task 7.
- Type names used across tasks: `WatchBatch`, `RecursiveWatchOptions`, `RecursiveWatchHandle`, `watchRecursive`, `toRelativeWatchPath`, `PendingBatch`, `FileChangeEvent.recursive`, `FileWatcherOptions`, `collectLoadedDirs`, `isSameOrChild`, `pendingRecursiveDirs`, `enqueue`, `applyBatch`, `rebuild`. Each is defined in the task that introduces it and used with the same name afterwards.
- Review round 1 (Codex, gpt-5.5) changes folded in: real-path aware `toRelativeWatchPath`; wiki queues every non-ignored path and rebuilds on directory-shaped or vanished paths; wiki work serialized per root; `FileWatcher` stops emitting after `stop`; watcher errors surface as a recursive root event (explorer) or a rebuild (wiki); explorer refreshes the parent of a collapsed directory; boundary-aware root check in the store; overflow test for `FileWatcher`; throttle test writes rotating filenames.
- Review round 2 (Codex, gpt-5.5) changes folded in: collapsing moved into `PendingBatch.add` so memory between flushes is capped even while Bun drains a backlog without yielding (pure tests cover the state machine); a watcher error drops the dead handle from `FileWatcher.watchers`; the dependency check no longer expects `fsevents` to vanish from the lockfile (Vite keeps it).
