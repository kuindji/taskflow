# Handoff: Move Session Between Owners

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next section needs. Don't add narrative.

Plan: `../2026-10-03-move-session.md`. Spec: `docs/superpowers/specs/2026-10-03-move-session-design.md`. TaskTray: `TSK-3`.

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| 1 | Shared types + log move | not started | |
| 2 | Owner registry | not started | |
| 3 | Move API (lifecycle, WS, REST) | not started | |
| 4 | CLI (sh, binary, docs) | not started | |
| 5 | UI drag | not started | |
| 6 | Links, TUI check, manual, review | not started | |

## Facts for the next section

- Commit before Section 1 (base for the final review): `642ce64f`. The spec commit is already in it.
- The plan was reviewed by gpt-6.1-sol before execution. See the review notes at the end of the plan index.

## Deviations from the spec

- UI refusals use the existing `alert()` dialog (`@/stores/dialog-store`), not a toast. The app has no toast system.
