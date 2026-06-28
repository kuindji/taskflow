## Task 8 Report: SearchPane + AppShell wiring

### Implemented
- Created `native/Sources/Taskflow/UI/Panels/SearchPane.swift` — full search/replace panel with query + replace text fields, flag toggles (CaseSensitive/WholeWord/Regex), Filter toggle revealing include/exclude pattern fields, debounced auto-search (300ms, ≥3 chars), Replace All button, embedded `SearchResultsView`.
- Modified `native/Sources/Taskflow/UI/Shell/AppShell.swift` — replaced `panelPlaceholder("Search", ...)` with `SearchPane()` in the mutually-exclusive file-explorer/search Group.

### Binding / primitive adaptations

**AppTextField**: The brief used `AppTextField(placeholder: "Search", text: $s.query)` but the struct's memberwise init is `init(text: Binding<String>, placeholder: String)` — `text` is declared first. Corrected all call sites to `AppTextField(text: $s.query, placeholder: "Search")` etc.

**AppButton**: The brief used `AppButton("Replace All", kind: .secondary)` (unlabeled first arg) but the struct declares `let title: String`, so the memberwise init requires the `title:` label. Corrected to `AppButton(title: "Replace All", kind: .secondary)`.

**AppIcon glyphs**: All four lucide names used resolve in `AppIcon.symbol(forLucide:)` — no substitutions needed:
- `"CaseSensitive"` → `"textformat"`
- `"WholeWord"` → `"textformat.abc"`
- `"Regex"` → `"asterisk"`
- `"Filter"` → `"line.3.horizontal.decrease.circle"`

**@Bindable**: `SearchViewModel` is `@Observable @MainActor final class` with plain `var query`, `var replacement`, `var includePattern`, `var excludePattern`. `@Bindable var s = search` inside the `if let search` branch compiles cleanly and `$s.query` etc. produce valid bindings.

### Build + test results
- `swift build`: clean (0 errors, pre-existing linker object-file warnings from tree-sitter deps only)
- `swift test`: 202 tests, 0 failures

### Files changed
- Created: `native/Sources/Taskflow/UI/Panels/SearchPane.swift`
- Modified: `native/Sources/Taskflow/UI/Shell/AppShell.swift`

### Self-review findings
- No `public` or superfluous `internal` modifiers added.
- No `as any` casts.
- No new types — reused existing `SearchViewModel`, `ActiveWorkspace`, `AppTextField`, `AppButton`, `AppIcon`, `SearchResultsView`.
- `debounce` Task is cancelled before each reschedule and the `Task.isCancelled` guard prevents stale search triggers after cancellation.
- `replaceAll` is wrapped in a `Task { await ... }` so the synchronous button action closure stays sync.
- `workingDir` computed via `ActiveWorkspace.workingDir(in: env)` — same as `FileExplorerPane`, no inline re-derivation.

### Concerns
None. The brief's call-site syntax had two mismatches with actual primitive init signatures (parameter label order/presence); both corrected before writing.
