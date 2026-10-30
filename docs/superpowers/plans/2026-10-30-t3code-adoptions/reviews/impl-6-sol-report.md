Implemented Tasks 6.1–6.4, including the 2000 ms async snapshot parser wait. Skipped Task 6.4 Step 6; `handoff.md` is unchanged.

Commits made:

- `24d21dc8` — `fix(backend): request terminal resync after dropped output`
- `3259c05b` — `fix(ui): suppress terminal input through replay completion`
- `2660ddc5` — `fix(ui): resync terminal state after output loss and reconnect`
- `0532144b` — `fix(tui): resync terminal state after dropped output`

Validation commands and results:

| Commands | Result |
|---|---|
| Scoped `bun test` runs for broadcaster/server, snapshot/API/handler, writer, attachment/lifecycle, backend-store/provider, and TUI bridge | Expected TDD failures first, then all passed |
| `TMPDIR=/private/tmp bun run typecheck` | Pass |
| `bun test packages/shared` | 224 pass |
| `bun test packages/backend` | 1139 pass, 2 skip, 19 known sandbox failures |
| `bun test packages/ui` | 435 pass, 63 failures from known mock leakage |
| Separate `bun test` invocation for every UI test file | All 79 files pass |
| `bun test packages/tui` | 464 pass |
| Changed-file `bunx prettier --write`, `bunx prettier --check`, and `bunx eslint` | Pass |
| `git diff --check` | Pass |

The wire event is `terminal:resync`, with `TerminalResyncEvent` carrying `{ sessionIds }`. Output numbering remains per session. Web recovery readiness is published after validated attach/rehandshake bootstrap and on dev-renderer reconnect.

Deviations: no design deviations. The referenced Superpowers execution skills were unavailable, so I followed the plan directly.

Nothing was pushed. No branches or worktrees were created. The pre-existing untracked review brief remains untouched.

