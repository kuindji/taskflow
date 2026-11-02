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
  typed conflict error the client can recognise (not a string match).
- Backend: compare and write under the existing per-path write handling;
  absent field → today's behaviour (other callers unchanged).
- Editor: remember what was loaded; on `FILE_CHANGED` for its path, re-read;
  clean → replace the model content keeping cursor/scroll where possible;
  dirty → show the bar. Save sends `expected`; on conflict show
  Reload / Overwrite (Overwrite resends without `expected`).
- A write the editor itself made must not trigger its own reload or bar
  (compare the re-read with what it just saved).
- Checkbox: send `expected` from its read; on conflict re-read, re-apply the
  toggle to the fresh text if the checkbox is still found, retry once, else
  surface an error.

Tests: backend write with matching / mismatched / absent expected; editor
reload-clean, bar-dirty, save conflict, no self-reload; checkbox conflict
retry. Owner check: edit a file in the editor while an agent edits it.
