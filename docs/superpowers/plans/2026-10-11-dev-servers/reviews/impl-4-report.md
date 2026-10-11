Implemented Section 4 with TDD. Two commits made on `main`; nothing pushed.

- `3e6bfc6a` — `feat(ui): dev server store with per-backend slices and stop state`
- `ea6f37cf` — `feat(ui): dev servers button and popover in the sidebar toolbar`

Commands and results:

- `bun test <new test file>` — each failed for its missing module before implementation, then passed.
- `bun test <UI test file>`, one file at a time — **425 tests passed across 69 files**, zero failures.
- `bun run typecheck` — passed at both commit steps.
- `bunx eslint <step-listed files>` — passed at both steps.
- `bunx prettier --check <step-listed files>` — first step passed; second flagged two new popover files, then passed after `bunx prettier --write` on those files only.
- `git diff --cached --check` and final commit-range whitespace check — passed.

Deviations: none. Manual popover checks remain for Section 5, as planned.

