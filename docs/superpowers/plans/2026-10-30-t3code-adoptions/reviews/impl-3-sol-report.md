Implemented all requested tasks in order. No push, branch, worktree or handoff edits.

Commits:

- `aae85582` — `fix(remote): disable SSH multiplexing for app connections`
- `a742840d` — `refactor(remote): share tunnel reconnect policy with the TUI`
- `f2d891c1` — `fix(ui): automatically reconnect dropped remote backends`
- `e355fe74` — `fix(desktop): retry remote connections on resume and online`
- `d4718675` — `fix(remote): refresh a stale cached port over ssh`

Validation:

- All specified focused test commands followed red → green.
- `TMPDIR=/private/tmp bun run typecheck` — passed.
- `bun test packages/shared` — 240 passed.
- `bun test packages/tui` — 467 passed.
- `bun test electron` — 78 passed.
- `bun test packages/ui` — failed with the documented mock leakage: 60 failures, 6 errors.
- Every UI test file passed individually, including affected-file reruns.
- `bunx prettier --write/--check` on changed files, scoped `bunx eslint`, and `git diff --check` — passed.

### Deviations

- Fixed the exhaustive state handling in `MachineSection.tsx` because adding `reconnecting` caused a compile error.
- Made the resume subscription optional to support existing partial test bridges.
- The referenced Superpowers execution skills were unavailable; followed the written steps directly.

The unrelated untracked review brief remains untouched.

