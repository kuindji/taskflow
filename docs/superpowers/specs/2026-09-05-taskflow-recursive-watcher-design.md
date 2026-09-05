# Recursive file watcher: replacing chokidar in the backend

Date: 2026-09-05
Status: approved design

## Problem

On 2026-09-05 the packaged backend hung for about twenty minutes at 100% CPU
and grew from 8 GB to 22 GB of memory. The main thread was inside the fsevents
native dispatch function, draining a backlog of roughly ten million filesystem
events in a single uninterrupted pass. While the backlog drained nothing else
ran: no WebSocket traffic, no pty reads, no health checks. Terminals inside
the app froze because their pty output could no longer be consumed.

Two backend services watch directories with chokidar 3.6 over fsevents:

- `FileWatcher.watch` (explorer): the active task's whole working directory.
- `WikiIndexService.watch`: the `wiki` attribute directory, kept until shutdown.

Measured costs of the current design on the TheFloorr monorepo:

- One chokidar watch costs 7.3 s CPU and 200 MB RSS, tracking 19k directories
  and 146k entries. It is repeated on every task switch.
- The ignore list (`node_modules`, `.git`, `.worktrees`, `dist`, `.next`,
  `.superpowers`) misses `.venv` (112k entries in that repo), `ios/Pods` (23k),
  Hasura migrations (4.5k), `.ruff_cache`, `.expo`.
- FSEvents delivers every event under the root. chokidar applies the ignore
  function in JavaScript after delivery, and for delete and rename events it
  issues an async `stat` before the ignore check.
- Bun's napi threadsafe-function bridge dispatches the entire queued backlog
  before yielding to the event loop (reproduced: 94k queued events dispatched
  before the first timer). Node caps a pass at 1000 items.

The exact source of the ten million events and the per-event retention of
about 3.5 KB in production were not established. The design below removes the
per-event work regardless of the source.

## Goals

1. A flood of events under ignored trees costs about a microsecond each and
   retains nothing, so the loop is blocked for at most seconds, not minutes.
2. Starting a watch is instant: no directory scan, no per-directory state.
3. Explorer, git change tracking, markdown panes and the wiki index keep
   working as they do today.
4. chokidar and fsevents leave the backend dependency tree.

Non-goals: Linux support beyond what Bun provides (the app ships for macOS and
Windows only); watching only expanded explorer folders; distinguishing
`create` from `modify`.

## Design

### `RecursiveWatcher` service

New file `packages/backend/src/services/recursive-watcher.ts`, wrapping
`fs.watch(root, { recursive: true })` from `node:fs`. Bun implements this with
FSEvents on macOS and ReadDirectoryChangesW on Windows.

```ts
interface RecursiveWatchOptions {
    /** Directory names that drop an event when they appear anywhere in the relative path. */
    ignoredNames: ReadonlySet<string>;
    /** Flush window in milliseconds. */
    windowMs: number;
    /** Above this many pending paths a flush collapses to parent directories, then to the root. */
    maxPathsPerFlush: number;
    onFlush: (batch: WatchBatch) => void;
    onError?: (error: Error) => void;
}

interface WatchBatch {
    /** Relative paths (forward slashes), or [""] when collapsed to the root. */
    paths: string[];
    /** True when the batch was collapsed and paths name directories to rescan recursively. */
    collapsed: boolean;
}

interface RecursiveWatchHandle {
    close(): void;
}

function watchRecursive(root: string, options: RecursiveWatchOptions): RecursiveWatchHandle;
```

Native callback, synchronous and allocation-light:

1. `filename` null or empty means the root itself: mark `pendingRoot = true`.
2. Replace backslashes with forward slashes. If the result is absolute, make
   it relative to the root as given or to its real path (Bun reports relative
   names on macOS even for symlinked roots, verified; the absolute branch is
   defensive); if it is outside both, drop it.
3. Split on `/`; if any segment is in `ignoredNames`, return.
4. Add to the pending `Set`. If no timer is armed, arm one for `windowMs`.

The timer is a throttle: it is armed by the first event after a flush and is
not reset by later events, so a continuous stream flushes once per window.

Flush:

1. Take the pending set and the root flag; reset both.
2. If the root flag is set or the set is larger than `maxPathsPerFlush`,
   collapse to the set of parent directories (`dirname`, with `"."` mapped to
   `""`). If still larger, collapse to `[""]`. `collapsed` is true in either
   case.
3. Call `onFlush({ paths, collapsed })`. The service does no stat itself, so
   callers decide what a path means.

`close()` closes the `fs.watch` handle, clears the timer and drops pending
state, and is safe to call twice. The `fs.watch` `error` event closes the
handle and calls `onError` once. On macOS a deleted root produces no event and
no error (verified); Windows may raise `EPERM`, which reaches `onError`.

### Explorer: `FileWatcher.watch`

- Uses `watchRecursive` with `WATCH_IGNORED_NAMES`, `windowMs: 100`,
  `maxPathsPerFlush: 200`.
- `WATCH_IGNORED_NAMES` is the current `IGNORED_NAMES` plus `.venv`, `venv`,
  `__pycache__`, `.ruff_cache`, `.pytest_cache`, `.mypy_cache`, `Pods`,
  `.expo`, `.serverless`, `.turbo`, `.cache`, `.gradle`, `DerivedData`. The
  display list used by `buildTree` and `listDir` is unchanged.
- `onFlush` for a non-collapsed batch: `stat` every path in parallel; emit
  `{ type: "delete", path }` when the stat fails, otherwise
  `{ type: "modify", path }`. For a collapsed batch: emit
  `{ type: "modify", path, recursive: true }` per directory without stat
  (the root path itself when collapsed to the root).
- After `stop()` nothing is emitted, even from a stat batch still in flight.
- A watcher error is logged and surfaced as a recursive event for the root so
  the client refreshes what it has.
- `watch()` resolves as soon as the handle exists. `stop()` and `stopAll()`
  keep their signatures. The constructor accepts optional `windowMs` and
  `maxPathsPerFlush` overrides for tests.

`FileChangeEvent` in `packages/shared/src/types/file.ts` gains
`recursive?: boolean`. The `type` union is unchanged; the backend simply stops
emitting `create`.

### Wiki: `WikiIndexService.watch`

- Uses `watchRecursive` with its own `IGNORED_NAMES`, `windowMs:
  this.debounceMs`, `maxPathsPerFlush: 200`. Every non-ignored path is queued.
- Batches are applied one at a time per root through a promise chain, so an
  incremental update and a full rebuild never interleave on the parsed map.
- Non-collapsed batch: markdown paths re-parse alone (a missing file is a
  deletion). Any other path is stat'd; if it is a directory or gone, the
  change was a rename or removal whose pages cannot be followed one by one,
  so the root is rebuilt. A plain non-markdown file is ignored.
- Rebuild (also used for collapsed batches and watcher errors): re-list
  markdown under the root, drop parsed entries that no longer exist, parse the
  rest, rebuild the graph, push it. If the root itself is gone, push
  `rootExists: false`, close the watcher and forget the root so the next
  request can index it again.
- The generation and stop logic is unchanged. `watch` no longer waits for a
  ready event.

### UI

- `file-store.ts`: on a `recursive` event, refetch every loaded directory whose
  path equals or is under the event path, plus the event path's parent when
  the event is below the root (the collapsed directory may itself be gone);
  then refresh git status as today. The root check becomes boundary-aware
  (`path === root || path.startsWith(root + "/")`).
- `MarkdownPaneImpl.tsx`: also reload when a `recursive` event names an
  ancestor of the open file.

### Dependencies

Remove `chokidar` from `packages/backend/package.json` and refresh `bun.lock`.
No other module imports chokidar or fsevents.

### Manual regression scripts

`scripts/watch-backlog-repro.mjs` (adapted from the incident's reproduction)
blocks the JS thread while a child process creates files under the watched
root, then reports how long the loop stays starved and RSS before and after.
It documents the runtime behaviour this design works around.

## Testing

Written before the implementation, in `packages/backend/tests/services/`:

`recursive-watcher.test.ts`

- events under an ignored directory produce no flush;
- many events inside one window produce one flush containing unique paths;
- more than `maxPathsPerFlush` paths collapse to parent directories, and past
  the cap again to the root, with `collapsed: true`;
- a continuous stream of events flushes more than once;
- `close()` stops delivery and tolerates a second call;
- backslash and absolute-path normalization (pure helper, no filesystem).

`file-watcher.test.ts`: existing tests unchanged, plus: a deletion arrives as
`delete` and a write as `modify`; changes under `.venv` are not reported; an
overflow arrives as a `recursive` event for the directory.

`wiki-index.test.ts`: existing tests unchanged, plus: renaming a directory of
pages re-indexes them under the new ids.

UI store tests: a `recursive` event refetches loaded directories under it.

## Risks

- Bun's recursive watch may report filenames differently on Windows or for
  symlinked roots; normalization handles both cases and drops paths outside
  the root. Verified on macOS during design; Windows is verified by the
  Windows build before release.
- A flood of non-ignored paths (for example a build writing thousands of
  files into a source folder) collapses to directory events, so the explorer
  refetches loaded folders instead of receiving one event per file.
