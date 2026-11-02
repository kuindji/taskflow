# S9 — Editor and checkbox writes that respect disk changes

Findings A18 R2-2 and A20 R2-1. Needs S8 (watches while the explorer is
closed).

Decision:
- Clean Monaco buffers reload on `FILE_CHANGED` for their path.
- Dirty buffers show a bar "Changed on disk — Reload / Keep mine".
- `FILE_WRITE` gets an optional expected-content field (hash or mtime: pick
  one, a content hash is safer against coarse mtimes); the backend refuses a
  write whose disk content no longer matches, and the editor then offers
  Reload or Overwrite.
- The markdown preview checkbox toggle sends what it read and retries once on
  conflict, so an agent edit between read and write is not lost.

Code: `packages/ui/src/components/panes/EditorPaneImpl.tsx` (Monaco),
`packages/ui/src/components/panes/MarkdownPaneImpl.tsx` (checkbox writes,
around lines 77 and 366), backend `FILE_WRITE` in
`packages/backend/src/handlers/file.ts:95`, payload types in
`packages/shared/src/types` (grep `FileWritePayload`), `MSG.FILE_WRITE` in
`packages/shared/src/constants.ts:115`. Also check `FILE_READ`'s response so
the client can get the hash/mtime of what it loaded without a second read.

Work:
- Shared: optional `expected` field on the write payload; a distinct,
  typed conflict the client can recognise (not a string match). Thrown
  errors cannot carry one: `WsResponse.error` is a string
  (`shared/src/types/ws.ts:37`), the server sends only `err.message`
  (`ws/server.ts:195`), the client rebuilds a plain `Error`
  (`ui/src/lib/connection.ts:154`). Return the conflict as a typed result
  of `FILE_WRITE` (e.g. `{ success: false, conflict: true }`) rather than
  changing the transport.
- Backend: there is no per-path write serialization today
  (`handlers/file.ts:95` reads, checks and writes with independent awaits).
  Add one keyed by resolved path around read-compare-write, used by every
  `FILE_WRITE` (with or without `expected`), so two writes with the same
  `expected` cannot both pass. Absent field → today's behaviour otherwise.
- UI helpers: `file-store` `readFile` returns only the content and
  `writeFile` discards the response (`stores/file-store.ts:438,445`); a
  resolved conflict result would reach the editor's success path and clear
  dirty (`EditorPaneImpl.tsx:119`). Extend them: `readFile` also returns the
  hash of what it read, `writeFile` takes `expected` and returns the typed
  result. Both panes must check it before treating a save as done.
- Which events count: the watcher sends collapsed batches as directory
  events with `recursive: true` (`backend/src/services/file-watcher.ts:224`),
  so a checkout or a large agent edit may name only an ancestor. The editor
  reacts to an exact-path event or a recursive event covering its file, from
  its own backend. Move the coverage test in `MarkdownPaneImpl.tsx:275-283`
  into a shared helper and use it in both panes.
- Editor: remember what was loaded; on a covering `FILE_CHANGED`, re-read;
  clean → replace the model content keeping cursor/scroll where possible;
  dirty → show the bar. Save sends `expected`; on conflict show
  Reload / Overwrite (Overwrite resends without `expected`).
- A write the editor itself made must not trigger its own reload or bar
  (compare the re-read with what it just saved).
- Keep the loaded/saved baseline with the Monaco model, not the pane:
  models outlive their pane and are shared by split panes
  (`EditorPaneImpl.tsx:198` reuses a dirty model without re-reading,
  `:254` keeps models after unmount). Store it per (backend, model), update
  on save and reload, drop it when the model is disposed or the backend
  resets.
- Checkbox: send `expected` from its read; on conflict re-read, re-apply the
  toggle to the fresh text if the checkbox is still found, retry once, else
  surface an error.

Tests: backend write with matching / mismatched / absent expected; editor
reload-clean, bar-dirty (exact and recursive-ancestor events), save conflict
through the real `file-store` helpers leaves the buffer dirty, no self-reload; checkbox conflict
retry; two concurrent writes with the same `expected`, exactly one wins;
dirty model unmounted and remounted, then external edit and save, conflicts;
split panes on one model share the baseline. Owner check: edit a file in the editor while an agent edits it.
