Implemented Tasks 2.1–2.4. Task 2.5 skipped; handoff.md unchanged. Nothing pushed.

Commits:

- `427eefd0` — `feat(electron): send the API token on every main-process request`
- `bbc9182e` — `feat(ui): authenticate the renderer's sockets and raw file URLs`
- `50de5869` — `feat(tui): send the local backend's API token`
- `f9324890` — `feat(cli): send TASKFLOW_API_TOKEN on every request`

Validation:

- TDD runs failed as expected before implementation for all four tasks.
- `bun test electron/src`: **76 passed**.
- UI tests run individually: connection-registry, backend-url, backend-store, hard-switch, and all three MarkdownPaneImpl files **passed**.
- `cd packages/tui && bun test`: **453 passed**.
- Both CLI test files: **100 passed**.
- `cd packages/backend && bun test`: **1,127 passed, 2 skipped, 19 failed**. All failures match the documented sandbox restrictions on `ps` and filesystem events.
- `TMPDIR=/private/tmp bun run typecheck` in Electron, UI, TUI, and backend: **passed**.
- Electron `bun run build`, shell `sh -n` and `dash -n`, changed-file ESLint and Prettier checks, and `git diff --check`: **passed**.

### Deviations

- Defaulted `Connection`’s new token argument to `null`, preserving existing direct constructor callers without editing unlisted files.
- Used the existing typed `BunWebSocket` constructor pattern in the TUI because DOM typings omit Bun’s headers option.

The unrelated untracked review brief remains untouched.

