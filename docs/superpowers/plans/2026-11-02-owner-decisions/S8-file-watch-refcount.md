# S8 — Reference-counted file watches in the UI (A20 R4-1)

Decision: reference-count watches in the UI `file-store`; backend and
protocol unchanged.

Today: only the file explorer sends `FILE_WATCH`/`FILE_UNWATCH`
(`packages/ui/src/stores/file-store.ts:163,358`). The backend
(`packages/backend/src/services/file-watcher.ts:56`) keeps a `Set` of client
ids per watched dir and broadcasts `FILE_CHANGED` to all clients
(`handlers/file.ts:121`). With the explorer closed nothing is watched, so
markdown previews (and editors, after S9) go stale.

Work:
- In `file-store`, add `retainWatch(backendId, path)` /
  `releaseWatch(backendId, path)` with a count per (backend, path). Send
  `FILE_WATCH` on 0→1 and `FILE_UNWATCH` on 1→0. Concurrent retain/release
  while a request is in flight must end in the right state (serialize per
  key or reconcile after the reply).
- On reconnect of a backend, re-send `FILE_WATCH` for every key with a count
  above zero (check how the explorer re-watches today and replace that).
  On backend removal / store reset, drop its counts.
- The explorer uses retain/release instead of raw requests.
- Markdown preview panes (and any other `FILE_CHANGED` consumer: grep
  `FILE_CHANGED` in `packages/ui/src`) retain the watch for the workspace
  root containing their file while mounted, so they share the explorer's
  native watcher. Wiki pages already reload from the wiki index; leave them.
- No backend change.

Tests: file-store unit tests for counting, in-flight races, reconnect
re-send, reset; one preview test showing a `FILE_CHANGED` refresh with the
explorer closed.
