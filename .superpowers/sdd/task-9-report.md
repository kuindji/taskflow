# Task 9 Report: TaskCard diff badges + ProjectGroup branch label

## Status
DONE

## What was built

### Modified: `native/Sources/Taskflow/UI/Sidebar/TaskCard.swift`
Replaced the `// Phase 5C/diff-store seam` comment in `worktreeBadge(branch:pr:)` with live diff data:
- `let behind = env.diff?.state.behindByProject[task.id] ?? 0` — shows `↓<n>` in `.info` color when behind > 0
- `let stats = env.diff?.state.statsByProject[task.id]` — shows `+<adds>` (`.success`) and `-<dels>` (`.destructive`) when stats non-nil
- Removed the old stale comment from the `#pr.number` label (kept the render)
- Ports `TaskCard.tsx:318-326`

### Modified: `native/Sources/Taskflow/UI/Sidebar/ProjectGroup.swift`
Added branch label in the header `HStack` after `Text(project.name)` and before `Spacer(minLength: 4)`:
- `if let branch = env.diff?.state.branchByProject[project.id]` — renders `(<branch>)` in `.mutedForeground`, font size 10, lineLimit 1
- `theme` already in scope (`@Environment(\.appTheme)` at line 27); `env` already in scope (`@Environment(AppEnvironment.self)` at line 28)
- Ports `ProjectGroup.tsx:296-298`

## DiffViewModel field verification

Confirmed against `native/Sources/Taskflow/ViewModels/DiffViewModel.swift`:
- `behindByProject: [String: Int]` ✓
- `statsByProject: [String: DiffStats]` with `DiffStats.additions: Int`, `DiffStats.deletions: Int` ✓
- `branchByProject: [String: String]` ✓

All field names/types matched the brief exactly; no adaptations needed.

## Build result
`swift build` — clean (Build complete, 0 errors, 0 new warnings from project code)

## Test result
`swift test` — Executed 202 tests, with 0 failures (0 unexpected) in 30.1 seconds

## Commit
`71cf030` — feat(native): worktree diff/behind badges + project branch label (diff-store)
(2 files changed, 16 insertions, 2 deletions)

## Self-review
- No `as any` / force-unwraps introduced
- `env.diff` is optional-chained throughout — safe if `DiffViewModel` not yet wired (gracefully shows nothing)
- Behind badge only appears when `behind > 0` (no ghost `↓0`)
- Stats only appear when non-nil (the reducer sets `nil` when both additions+deletions are zero, matching TS behaviour)
- Branch label only appears when non-nil (no empty parens)
- `foregroundStyle` on individual text nodes (`.info`/`.success`/`.destructive`) correctly overrides the outer `.mutedForeground` applied to the whole HStack
- `lineLimit(1)` on branch label prevents overflow in narrow sidebar
- Both views remain `internal` — no new exports

## Concerns
None. The outer `.foregroundStyle(theme.color(.mutedForeground))` on the HStack sets the base color; individual badges use explicit `foregroundStyle` overrides, which in SwiftUI take precedence — consistent with how TS renders each badge with its own color class.
