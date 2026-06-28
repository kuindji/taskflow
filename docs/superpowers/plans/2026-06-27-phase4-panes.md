# Phase 4 — Panes (Real Pane Content) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase-3 `PanePlaceholder` with real, task-scoped pane content — a libghostty terminal, a native code editor + diff viewer, a browser, and a changes/markdown viewer — wired to the existing Bun backend over the already-built WS view-model layer.

**Architecture:** A single `PaneHost` view switches on the active tab's `TabType` and renders the matching pane. **All terminal sessions render through one libghostty `.inMemory` ("bring-your-own-bytes") surface fed by the backend WS stream** — the option-(d) result the Phase-0 spike proved, identical to how the Electron `xterm.js` frontend works today. The backend already owns every PTY (interactive *and* scheduled) and streams `terminal:output`; the native app never spawns a PTY, so the per-spawn env-scrub hazard is moot (the sandboxed sidecar owns spawning). The code editor uses the pinned `CodeEditSourceEditor`, reading/writing files over the WS `file:read`/`file:write` API (never the local filesystem). Two marked Phase-3 seams get filled here: `SessionViewModel` terminal-activity status and `FileViewModel.file:changed` debounce.

**Tech Stack:** Swift 6 / SwiftUI / AppKit (`NSViewRepresentable`), `GhosttyTerminal` (libghostty-spm 1.2.7), `CodeEditSourceEditor` 0.12.0, `WKWebView`, the existing `WSClient`/view-model layer.

## Global Constraints

- **Platform:** macOS 14; SwiftPM tools-version 6.0; both targets `swiftLanguageMode(.v6)`. Do not lower these.
- **Dependencies are EXACT-pinned and already declared** in `native/Package.swift`: `libghostty-spm 1.2.7`, `CodeEditSourceEditor 0.12.0`, `CodeEditTextView 0.10.1`. Do **not** change versions or add new package dependencies.
- **Terminal architecture (D4 resolution):** render **all** sessions via `.inMemory(InMemoryTerminalSession)` fed by WS. Do **not** use the `.exec` backend in production panes and do **not** spawn PTYs from the app. (Rationale: the backend owns all PTYs; `.inMemory`-over-WS guarantees parity with Electron, needs zero backend change, and keeps spawning inside the sandboxed sidecar — see [[project_native_sidecar_sandbox]].)
- **All file and git access goes through the WS API** (`FileViewModel` / `MessageType.file*` / `git*`). Never read or write the local filesystem directly from a pane (worktree/sandbox paths only resolve backend-side).
- **TypeScript:** use `bun`, never `npm`/`yarn`.
- **Swift typing:** no `as Any`/`as!` escape hatches for protocol gaps — pursue proper types; reuse the generated/`shared` types and the existing view-model types before authoring new ones; keep declarations `private`/`internal` unless a cross-file consumer in this plan needs them (don't widen access "just in case").
- **Commits:** do NOT add `Co-Authored-By`. Log every commit hash and every edited file to Taskflow (`taskflow-cli log commit "<msg>" --hash <hash>`; `taskflow-cli log file "<relpath>"`).
- **TDD:** pure logic (sequence reconciliation, change-debounce dir collection, import-specifier parsing, language/diff parsing, activity-status reducers) is written test-first. UI wrappers are verified by build + a launched-app screenshot.

---

## File Structure

**New files (all under `native/Sources/Taskflow/`):**

- `UI/Panes/TerminalSessionBridge.swift` — `@MainActor @Observable` controller that owns one backend session's byte stream: requests `session:snapshot`, subscribes to `terminal:output`, reconciles by `sequence`, pushes bytes into an `InMemoryTerminalSession`, and forwards input/resize back over WS. Pure sequence logic is `static` + TDD'd.
- `UI/Panes/TerminalSurfaceCache.swift` — `@MainActor` cache keyed by `sessionId` holding the live `AppTerminalView` + `InMemoryTerminalSession` + `TerminalSessionBridge`, so a session survives tab switches without re-snapshotting.
- `UI/Panes/TerminalPane.swift` — `NSViewRepresentable` that vends the cached surface for a tab's `sessionId`, applies the theme, and bridges focus.
- `UI/Panes/LanguageDetection.swift` — pure file-extension → `CodeLanguage` map (TDD'd).
- `UI/Panes/EditorTheme.swift` — maps the current `AppTheme` to a `CodeEditSourceEditor` `EditorTheme`.
- `UI/Panes/EditorPane.swift` — code-editor view: loads via `file:read`, saves via `file:write` (⌘S), go-to-line, Cmd+click import-open.
- `UI/Panes/ImportNavigation.swift` — pure import-specifier extraction (port of `monaco-import-navigation.ts`) + `ts:resolve-import` call (TDD'd parser).
- `UI/Panes/DiffView.swift` — pure unified-diff parser (TDD'd) + a read-only diff renderer used by both editor-diff and the changes pane.
- `UI/Panes/ChangesPane.swift` — git-status file list (`git:status`) + per-file diff (`git:diff-file-content`).
- `UI/Panes/BrowserPane.swift` — the one real `WKWebView`, loading the tab's `url`.
- `UI/Panes/MarkdownPane.swift` — plain word-wrapped text view (markdown rendered as text, per the UI-scope decision).
- `UI/Workspace/PaneHost.swift` — the router: `switch activeTab.type` → the pane views above.

**Modified files:**

- `ViewModels/SessionViewModel.swift` — fill the `bind()` Phase-4 seam (terminal activity status) + add `SessionActivity` timers.
- `ViewModels/FileViewModel.swift` — fill the `watchPath` Phase-4 `file:changed` debounce seam.
- `App/AppEnvironment.swift` — own the `TerminalSurfaceCache`; inject `FileViewModel.onOpenFile`.
- `UI/Workspace/SplitContainer.swift` — replace `PanePlaceholder(for:)` with `PaneHost(activeTab:workspaceKey:)`.

**Deleted:** `UI/Workspace/PanePlaceholder.swift` (after `PaneHost` replaces its only call site — done in the final task).

**New test files (under `native/Tests/TaskflowTests/`):** `SessionActivityTests.swift`, `FileChangeDebounceTests.swift`, `TerminalSequenceTests.swift`, `LanguageDetectionTests.swift`, `ImportNavigationTests.swift`, `DiffParseTests.swift`.

---

## Interfaces shared across tasks

These names are introduced by the tasks below; later tasks rely on them. Exact signatures:

- `TerminalSessionBridge` (Task 3): `init(sessionId: String, client: WSClient, session: InMemoryTerminalSession)`; `func start()`; `func sendInput(_ data: Data)`; `func resize(cols: Int, rows: Int)`; `func stop()`. Pure: `static func reconcile(pending: [(seq: Int, data: String)], lastSequence: Int) -> (apply: [String], keep: [(seq: Int, data: String)])`.
- `TerminalSurfaceCache` (Task 4): `@MainActor final class`; `func surface(for sessionId: String, client: WSClient, theme: ResolvedThemeFile) -> AppTerminalView`; `func evict(_ sessionId: String)`.
- `LanguageDetection.language(forPath:) -> CodeLanguage` (Task 5).
- `EditorTheme.from(_ theme: AppTheme) -> EditorTheme` (Task 5).
- `ImportNavigation.specifier(inLine line: String, column: Int) -> String?` (Task 6).
- `DiffView.parse(_ unified: String) -> [DiffView.Line]` and `struct DiffView: View { init(unifiedDiff: String) }` (Task 7).
- `PaneHost` (Task 11): `init(activeTab: Tab?, workspaceKey: String)`.

---

## Task 1: Fill the `SessionViewModel` terminal-activity seam

Ports `session-subscriptions.ts` (terminal:output / session:status handlers) + `session-activity.ts` (interaction + timeout timers) into the `bind()` Phase-4 seam. This is the status machine that drives tab "working/attention" dots; it is independent of any pane view, so it ships first.

**Files:**
- Modify: `native/Sources/Taskflow/ViewModels/SessionViewModel.swift`
- Create: `native/Sources/Taskflow/ViewModels/SessionActivity.swift`
- Test: `native/Tests/TaskflowTests/SessionActivityTests.swift`

**Interfaces:**
- Consumes: existing `SessionViewModel.setSessionStatus`, `sessionStatus`, `SessionStatus` (generated), `WSClient.on`, `MessageType.terminalOutput`/`.sessionStatus`/`.sessionExited`.
- Produces: `SessionActivity` actor-isolated timer helper; `SessionViewModel.bind()` now subscribes to all three events. Used by `AppEnvironment` (already calls `bind()`).

**Reference (read before porting):** `packages/ui/src/stores/session-subscriptions.ts` (the three `onEvent` handlers, lines ~88–150) and `packages/ui/src/stores/session-activity.ts` (`isUserInteracting`, `scheduleActivityTimeout`, `clearActivityTimer`, `clearInteraction`, `settleInactiveSession`, and the activity-timeout constant). Port the behavior 1:1.

- [ ] **Step 1: Write failing activity-reducer tests.** `SessionActivity` exposes the pure decision the handlers make. Create `SessionActivityTests.swift`:

```swift
import XCTest
@testable import Taskflow

@MainActor
final class SessionActivityTests: XCTestCase {
    // terminal:output while "initializing" → transition straight to "working"
    func testInitializingToWorkingOnOutput() {
        XCTAssertEqual(SessionActivity.nextStatus(current: .initializing, isInteracting: false, usesActivity: true), .working)
    }
    // terminal:output while the user is actively typing → no status change
    func testNoChangeWhileInteracting() {
        XCTAssertNil(SessionActivity.nextStatus(current: .working, isInteracting: true, usesActivity: true))
    }
    // terminal:output for a session whose type does not use activity status → no change
    func testNoChangeWhenNotActivityType() {
        XCTAssertNil(SessionActivity.nextStatus(current: nil, isInteracting: false, usesActivity: false))
    }
    // terminal:output while idle on an activity session not yet "working" → "working"
    func testIdleOutputBecomesWorking() {
        XCTAssertEqual(SessionActivity.nextStatus(current: nil, isInteracting: false, usesActivity: true), .working)
    }
    // already "working" → leave as-is (nil = "no write needed")
    func testAlreadyWorkingNoWrite() {
        XCTAssertNil(SessionActivity.nextStatus(current: .working, isInteracting: false, usesActivity: true))
    }
}
```

- [ ] **Step 2: Run — verify fail.** Run: `cd native && swift test --filter SessionActivityTests` → FAIL (`SessionActivity` / `nextStatus` undefined).

- [ ] **Step 3: Implement `SessionActivity`.** Create `SessionActivity.swift`. Hold the timers and interaction set; expose the pure `nextStatus` decision (mirrors `session-subscriptions.ts`’ terminal:output branch) and the timer API (mirrors `session-activity.ts`). Use the activity-timeout value from `session-activity.ts` verbatim.

```swift
import Foundation

/// Port of `packages/ui/src/stores/session-activity.ts` + the terminal:output
/// status decision in `session-subscriptions.ts`. Timers settle a "working" session
/// to "attention" after inactivity; user keystrokes suppress activity-driven changes.
@MainActor
final class SessionActivity {
    /// Inactivity window before a working session settles to "attention".
    /// MUST match `ACTIVITY_TIMEOUT_MS` in session-activity.ts.
    static let timeoutMs: Int = /* copy the exact constant from session-activity.ts */ 0

    private var timers: [String: Task<Void, Never>] = [:]
    private var interacting: Set<String> = []

    /// Pure decision for a terminal:output event. Returns the status to write,
    /// or nil if no write is needed. Mirrors session-subscriptions.ts lines ~96–124.
    static func nextStatus(current: SessionStatus?, isInteracting: Bool, usesActivity: Bool) -> SessionStatus? {
        if current == .initializing { return .working }     // agent first output
        if isInteracting { return nil }
        if !usesActivity { return nil }
        if current != .working { return .working }
        return nil
    }

    func isInteracting(_ id: String) -> Bool { interacting.contains(id) }
    func markInteraction(_ id: String) { interacting.insert(id) }   // call from sendInput/resize
    func clearInteraction(_ id: String) { interacting.remove(id) }

    func scheduleTimeout(_ id: String, settle: @escaping @MainActor () -> Void) {
        timers[id]?.cancel()
        timers[id] = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(Self.timeoutMs))
            if Task.isCancelled { return }
            settle()
        }
    }
    func clearTimer(_ id: String) { timers[id]?.cancel(); timers.removeValue(forKey: id) }
}
```

Replace the `0` placeholder with the real constant read from `session-activity.ts`. If that file derives "uses activity status" from the session/tab type, port that predicate too (as a `SessionViewModel` helper mirroring `usesTerminalActivityStatus`).

- [ ] **Step 4: Run — verify pass.** Run: `cd native && swift test --filter SessionActivityTests` → PASS.

- [ ] **Step 5: Wire the seam in `SessionViewModel.bind()`.** Add an `@ObservationIgnored private let activity = SessionActivity()`. Replace the two `// Phase 4:` comment lines with real subscriptions; keep the existing `session:exited` handler and ALSO clear the activity timer/interaction there. Mirror `session-subscriptions.ts`:

```swift
func bind() {
    client.on(.sessionExited) { [weak self] (event: SessionExitedEvent) in
        Task { @MainActor [weak self] in
            guard let self else { return }
            exitedSessionIds.insert(event.sessionId)
            activity.clearTimer(event.sessionId)
            activity.clearInteraction(event.sessionId)
            sessionStatus.removeValue(forKey: event.sessionId)
        }
    }
    client.on(.terminalOutput) { [weak self] (event: TerminalOutputEvent) in
        Task { @MainActor [weak self] in
            guard let self else { return }
            let id = event.sessionId
            let next = SessionActivity.nextStatus(
                current: sessionStatus[id],
                isInteracting: activity.isInteracting(id),
                usesActivity: usesActivityStatus(id)
            )
            if let next { setSessionStatus(sessionId: id, status: next) }
            // schedule settle only when the session is (now) working
            if sessionStatus[id] == .working {
                activity.scheduleTimeout(id) { [weak self] in
                    self?.setSessionStatus(sessionId: id, status: .attention)
                }
            }
        }
    }
    client.on(.sessionStatus) { [weak self] (event: SessionStatusEvent) in
        Task { @MainActor [weak self] in
            guard let self else { return }
            setSessionStatus(sessionId: event.sessionId, status: event.status)
            if event.status == .working {
                activity.scheduleTimeout(event.sessionId) { [weak self] in
                    self?.setSessionStatus(sessionId: event.sessionId, status: .attention)
                }
            } else {
                activity.clearTimer(event.sessionId)
            }
        }
    }
}
```

Add `private func usesActivityStatus(_ sessionId: String) -> Bool` porting `usesTerminalActivityStatus` (it keys off the tab type — claude/codex/etc. use activity status; shell/editor do not). Also call `activity.markInteraction(sessionId)` at the top of `sendInput(sessionId:data:)` and `resizeTerminal(...)` to mirror the TS `markInteraction`. Confirm `TerminalOutputEvent` and `SessionStatusEvent` exist in `Generated/Models/` (they back the `terminal:output`/`session:status` payloads); if a field is missing, that's a codegen gap — regenerate via `bun native/scripts/codegen/generate.ts`, don't hand-author.

- [ ] **Step 6: Update the `bind()` doc-comment.** Remove the two `// Phase 4:` seam lines (now implemented) from the class doc-comment and the method.

- [ ] **Step 7: Build + full regression.** Run: `cd native && swift build` → clean; `swift test` → all green (102 prior + new). Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
cd /Users/kuindji/Projects/taskflow/.worktrees/build-native-app-experiment
git add native/Sources/Taskflow/ViewModels/SessionActivity.swift native/Sources/Taskflow/ViewModels/SessionViewModel.swift native/Tests/TaskflowTests/SessionActivityTests.swift
git commit -m "feat(native): fill SessionViewModel terminal-activity seam (session:status/terminal:output + timers)"
```
Then `taskflow-cli log commit "<msg>" --hash <hash>` and `taskflow-cli log file <each path>`.

---

## Task 2: Fill the `FileViewModel.file:changed` debounce seam

Ports the `file:changed` handler body from `file-store.ts` (lines ~186–204): on each change under the watched path, collect the parent dir, debounce 150ms, then refetch each currently-loaded affected dir + git status. (The diff-store subscription stays a Phase-5 seam.)

**Files:**
- Modify: `native/Sources/Taskflow/ViewModels/FileViewModel.swift`
- Test: `native/Tests/TaskflowTests/FileChangeDebounceTests.swift`

**Interfaces:**
- Consumes: existing `FileViewModel.fetchDir`, `fetchGitStatus`, `watchedPath`, `expandedDirs`, `WSClient.on`, `MessageType.fileChanged`, `FileChangeEvent` (generated).
- Produces: a pure `static func changedDirsToRefresh(eventPaths:watchedPath:loadedDirs:) -> [String]` + a private `FileChangeDebouncer`. Self-contained.

**Reference:** `packages/ui/src/stores/file-store.ts:181–222` (the `watchPath` body, the `pendingChangedDirs` set, the 150ms debounce, the per-loaded-dir refetch + `fetchGitStatus`).

- [ ] **Step 1: Write failing tests** for the pure dir-collection reducer. Create `FileChangeDebounceTests.swift`:

```swift
import XCTest
@testable import Taskflow

@MainActor
final class FileChangeDebounceTests: XCTestCase {
    func testIgnoresPathsOutsideWatchedRoot() {
        let out = FileViewModel.changedDirsToRefresh(
            eventPaths: ["/other/x.ts"], watchedPath: "/repo", loadedDirs: ["/repo"])
        XCTAssertTrue(out.isEmpty)
    }
    func testCollectsParentDirOfChangedFileWhenLoaded() {
        let out = FileViewModel.changedDirsToRefresh(
            eventPaths: ["/repo/src/a.ts"], watchedPath: "/repo", loadedDirs: ["/repo", "/repo/src"])
        XCTAssertEqual(out, ["/repo/src"])
    }
    func testSkipsParentDirNotLoaded() {
        let out = FileViewModel.changedDirsToRefresh(
            eventPaths: ["/repo/src/a.ts"], watchedPath: "/repo", loadedDirs: ["/repo"])
        XCTAssertTrue(out.isEmpty)   // /repo/src not loaded → nothing to refresh
    }
    func testDedupesMultipleChangesInSameDir() {
        let out = FileViewModel.changedDirsToRefresh(
            eventPaths: ["/repo/src/a.ts", "/repo/src/b.ts"], watchedPath: "/repo",
            loadedDirs: ["/repo", "/repo/src"])
        XCTAssertEqual(out, ["/repo/src"])
    }
}
```

- [ ] **Step 2: Run — verify fail.** Run: `cd native && swift test --filter FileChangeDebounceTests` → FAIL.

- [ ] **Step 3: Implement the reducer + debounce.** Add to `FileViewModel`:

```swift
/// Pure: from a batch of changed paths, the set of currently-loaded directories to refetch.
/// Mirrors file-store.ts: take each event path under watchedPath, its parent dir, keep only
/// dirs already loaded in the tree. Returns a stable de-duplicated, sorted list.
static func changedDirsToRefresh(eventPaths: [String], watchedPath: String, loadedDirs: Set<String>) -> [String] {
    var dirs = Set<String>()
    for p in eventPaths where p.hasPrefix(watchedPath) {
        guard let slash = p.lastIndex(of: "/") else { continue }
        let parent = String(p[..<slash])
        if loadedDirs.contains(parent) { dirs.insert(parent) }
    }
    return dirs.sorted()
}
```

Add `@ObservationIgnored private var changeDebounce: Task<Void, Never>?` and `@ObservationIgnored private var pendingChangedPaths: Set<String> = []`. In `watchPath`, inside the `if !fileChangeSubscriptionReady` block (KEEP the registration there per the seam note), register:

```swift
client.on(.fileChanged) { [weak self] (event: FileChangeEvent) in
    Task { @MainActor [weak self] in
        guard let self, let wp = watchedPath, event.path.hasPrefix(wp) else { return }
        pendingChangedPaths.insert(event.path)
        changeDebounce?.cancel()
        changeDebounce = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(150))
            if Task.isCancelled { return }
            guard let self, let wp = watchedPath else { return }
            let loaded = Self.loadedDirSet(tree)          // collect loaded dir paths from the tree
            let toRefresh = Self.changedDirsToRefresh(
                eventPaths: Array(pendingChangedPaths), watchedPath: wp, loadedDirs: loaded)
            pendingChangedPaths.removeAll()
            for dir in toRefresh { await fetchDir(dirPath: dir) }
            await fetchGitStatus(path: wp)
        }
    }
}
```

Add a private `static func loadedDirSet(_ node: FileNode?) -> Set<String>` walking the tree and collecting `path` of every `type == "directory"` node with `loaded == true`. Confirm `FileChangeEvent` has a `path` field (generated); regenerate codegen if not.

- [ ] **Step 4: Run — verify pass + build.** Run: `cd native && swift test --filter FileChangeDebounceTests` → PASS; `swift build` → clean.

- [ ] **Step 5: Update the seam comments** in `watchPath`/class doc — remove the `// Phase 4:` lines now implemented; keep the `// Phase 5:` diff-store note.

- [ ] **Step 6: Commit.** `feat(native): fill FileViewModel file:changed debounce seam` (+ taskflow logs).

---

## Task 3: `TerminalSessionBridge` — WS byte-stream controller (TDD core)

The headless core of the terminal: requests the snapshot, subscribes to `terminal:output`, reconciles out-of-order/duplicate chunks by `sequence`, pushes bytes into an `InMemoryTerminalSession`, and forwards input/resize. No SwiftUI yet — pure logic is fully tested. Port of `packages/ui/src/components/panes/terminal/terminal-lifecycle.ts` (`ensureHistoryLoaded`, `flushPendingChunks`, history fallback).

**Files:**
- Create: `native/Sources/Taskflow/UI/Panes/TerminalSessionBridge.swift`
- Test: `native/Tests/TaskflowTests/TerminalSequenceTests.swift`

**Interfaces:**
- Consumes: `WSClient` (`request`/`send`/`on`), `MessageType.sessionSnapshot`/`.sessionHistory`/`.terminalOutput`/`.sessionInput`/`.terminalResize`, `SessionSnapshotResponse`/`SessionHistoryResponse`/`TerminalOutputEvent` (generated), `InMemoryTerminalSession.receive(_:)` (GhosttyTerminal).
- Produces: `TerminalSessionBridge` with `init(sessionId:client:session:)`, `start()`, `sendInput(_:)`, `resize(cols:rows:)`, `stop()`, and `static reconcile(...)`. Used by `TerminalSurfaceCache` (Task 4).

**Reference:** `terminal-lifecycle.ts:268–286` (snapshot load: write snapshot, hide cursor if `cursorHidden`, then `flushPendingChunks(pending, lastSequence)`), the history fallback (`session:history` when `snapshot == null`), and the sequence-gating in `flushPendingChunks` (drop chunks `<= lastSequence`, apply the rest in order, keep buffering until history loads).

- [ ] **Step 1: Write failing sequence tests.** Create `TerminalSequenceTests.swift`:

```swift
import XCTest
@testable import Taskflow

final class TerminalSequenceTests: XCTestCase {
    typealias Chunk = (seq: Int, data: String)
    func testDropsChunksAtOrBeforeLastSequence() {
        let r = TerminalSessionBridge.reconcile(
            pending: [(1, "a"), (2, "b"), (3, "c")], lastSequence: 2)
        XCTAssertEqual(r.apply, ["c"])
        XCTAssertTrue(r.keep.isEmpty)
    }
    func testAppliesInSequenceOrderRegardlessOfArrival() {
        let r = TerminalSessionBridge.reconcile(
            pending: [(3, "c"), (1, "a"), (2, "b")], lastSequence: 0)
        XCTAssertEqual(r.apply, ["a", "b", "c"])
    }
    func testEmptyPendingIsNoOp() {
        let r = TerminalSessionBridge.reconcile(pending: [], lastSequence: 5)
        XCTAssertTrue(r.apply.isEmpty)
        XCTAssertTrue(r.keep.isEmpty)
    }
}
```

- [ ] **Step 2: Run — verify fail.** Run: `cd native && swift test --filter TerminalSequenceTests` → FAIL.

- [ ] **Step 3: Implement `TerminalSessionBridge`.**

```swift
import Foundation
import GhosttyTerminal

/// Owns one backend session's byte stream and feeds a libghostty .inMemory surface.
/// Port of terminal-lifecycle.ts: snapshot-first load, sequence-gated live stream.
@MainActor
final class TerminalSessionBridge {
    private let sessionId: String
    private let client: WSClient
    private let session: InMemoryTerminalSession

    private var historyLoaded = false
    private var lastSequence = 0
    private var pending: [(seq: Int, data: String)] = []
    private var unsubscribe: (() -> Void)?

    init(sessionId: String, client: WSClient, session: InMemoryTerminalSession) {
        self.sessionId = sessionId
        self.client = client
        self.session = session
    }

    /// Pure: split buffered chunks into the ordered set to apply now (seq > lastSequence)
    /// and the set to keep buffering (none, once history is loaded). Mirrors flushPendingChunks.
    static func reconcile(pending: [(seq: Int, data: String)], lastSequence: Int)
        -> (apply: [String], keep: [(seq: Int, data: String)]) {
        let fresh = pending.filter { $0.seq > lastSequence }.sorted { $0.seq < $1.seq }
        return (fresh.map { $0.data }, [])
    }

    func start() {
        // Subscribe BEFORE requesting the snapshot so no live chunk is lost in the gap.
        unsubscribe = client.on(.terminalOutput) { [weak self] (event: TerminalOutputEvent) in
            Task { @MainActor [weak self] in
                guard let self, event.sessionId == sessionId else { return }
                if historyLoaded {
                    if event.sequence > lastSequence {
                        session.receive(event.data)
                        lastSequence = event.sequence
                    }
                } else {
                    pending.append((event.sequence, event.data))   // buffer until snapshot lands
                }
            }
        }
        Task { @MainActor in await loadHistory() }
    }

    private func loadHistory() async {
        do {
            let snap: SessionSnapshotResponse = try await client.request(
                .sessionSnapshot, payload: ["sessionId": sessionId])
            if let snapshot = snap.snapshot {
                session.receive(snapshot)
                if snap.cursorHidden { session.receive("\u{1b}[?25l") }   // DECTCEM hide
                lastSequence = snap.lastSequence
            } else {
                let hist: SessionHistoryResponse = try await client.request(
                    .sessionHistory, payload: ["sessionId": sessionId])
                session.receive(hist.data)
                lastSequence = hist.lastSequence
            }
        } catch {
            // snapshot failed → fall back to history; if that fails, start empty (live stream continues)
            if let hist: SessionHistoryResponse = try? await client.request(
                .sessionHistory, payload: ["sessionId": sessionId]) {
                session.receive(hist.data)
                lastSequence = hist.lastSequence
            }
        }
        let r = Self.reconcile(pending: pending, lastSequence: lastSequence)
        for chunk in r.apply { session.receive(chunk) }
        if let last = pending.map({ $0.seq }).max(), last > lastSequence { lastSequence = last }
        pending = r.keep
        historyLoaded = true
    }

    func sendInput(_ data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        client.send(.sessionInput, payload: ["sessionId": sessionId, "data": text])
    }
    func resize(cols: Int, rows: Int) {
        client.send(.terminalResize, payload: ["sessionId": sessionId, "cols": cols, "rows": rows])
    }
    func stop() { unsubscribe?(); unsubscribe = nil }
}
```

Confirm `SessionSnapshotResponse` (`snapshot: String?`, `lastSequence: Int`, `cursorHidden: Bool`), `SessionHistoryResponse` (`data: String`, `lastSequence: Int`), and `TerminalOutputEvent` (`sessionId`, `data`, `sequence`) exist in `Generated/Models/`; regenerate codegen if a field is missing.

- [ ] **Step 4: Run — verify pass + build.** `cd native && swift test --filter TerminalSequenceTests` → PASS; `swift build` → clean.

- [ ] **Step 5: Commit.** `feat(native): TerminalSessionBridge — WS byte-stream + sequence reconciliation` (+ logs).

---

## Task 4: `TerminalSurfaceCache` + `TerminalPane` (live terminal)

Wraps `AppTerminalView` in an `NSViewRepresentable`, fed by an `.inMemory` session + `TerminalSessionBridge`. The cache keeps each session's surface alive across tab switches (carry-forward: persist sessions across tabs). Theming via `GhosttyThemeConfig.pairs`.

**Files:**
- Create: `native/Sources/Taskflow/UI/Panes/TerminalSurfaceCache.swift`
- Create: `native/Sources/Taskflow/UI/Panes/TerminalPane.swift`
- Modify: `native/Sources/Taskflow/App/AppEnvironment.swift` (own the cache; expose `terminalSurfaces`)

**Interfaces:**
- Consumes: `GhosttyTerminal` (`AppTerminalView`/`TerminalView`, `TerminalViewState`, `InMemoryTerminalSession(write:resize:)`, `TerminalSurfaceOptions(backend:)`, `TerminalConfiguration`, `InMemoryTerminalViewport`), `TerminalSessionBridge` (Task 3), `GhosttyThemeConfig.pairs(from:)`, `ResolvedThemeFile`, `ThemeStore.current`/`loadFile`.
- Produces: `TerminalSurfaceCache.surface(for:client:theme:)` / `.evict(_:)`; `TerminalPane(sessionId:)` SwiftUI view. Used by `PaneHost` (Task 11).

**Reference:** `experiments/native-spike/Sources/NativeSpike/AppDelegate.swift:124–143` (the `.inMemory` setup: `InMemoryTerminalSession(write:resize:)`, `TerminalViewState(configSource:)`, `terminal.configuration = TerminalSurfaceOptions(backend: .inMemory(session))`) and `BackendWatch.swift` (write→`sendInput`, resize→`sendResize`, `session.receive`). `InMemoryTerminalViewport.columns/rows` are `UInt16` → cast to `Int`.

- [ ] **Step 1: Implement `TerminalSurfaceCache`.** Create the cache; building a surface wires the `InMemoryTerminalSession` callbacks to the bridge and starts it:

```swift
import AppKit
import GhosttyTerminal

/// Keeps each backend session's libghostty surface alive across tab switches so
/// re-selecting a tab does not re-snapshot. Carry-forward from Phase 3.
@MainActor
final class TerminalSurfaceCache {
    private struct Entry { let view: AppTerminalView; let state: TerminalViewState; let bridge: TerminalSessionBridge }
    private var entries: [String: Entry] = [:]

    func surface(for sessionId: String, client: WSClient, theme: ResolvedThemeFile) -> AppTerminalView {
        if let e = entries[sessionId] { return e.view }

        // Bridge is created first so the session callbacks can capture it.
        var bridgeRef: TerminalSessionBridge?
        let session = InMemoryTerminalSession(
            write: { data in Task { @MainActor in bridgeRef?.sendInput(data) } },
            resize: { viewport in
                Task { @MainActor in bridgeRef?.resize(cols: Int(viewport.columns), rows: Int(viewport.rows)) }
            }
        )
        let bridge = TerminalSessionBridge(sessionId: sessionId, client: client, session: session)
        bridgeRef = bridge

        // Apply theme as generated config alongside the .inMemory backend.
        let config = TerminalConfiguration(startingFrom: .default) { builder in
            for (key, value) in GhosttyThemeConfig.pairs(from: theme) { builder.withCustom(key, value) }
        }
        let state = TerminalViewState(configSource: .generated(config.rendered))
        let view = AppTerminalView(frame: .zero)
        view.delegate = state
        view.controller = state.controller
        view.configuration = TerminalSurfaceOptions(backend: .inMemory(session))

        bridge.start()
        entries[sessionId] = Entry(view: view, state: state, bridge: bridge)
        return view
    }

    func evict(_ sessionId: String) {
        entries[sessionId]?.bridge.stop()
        entries.removeValue(forKey: sessionId)
    }
}
```

> **Palette caveat to verify in this step:** `builder.withCustom("palette", "0=#…")` is called 16 times with the same key. Inspect `config.rendered` after building (print/log once in DEBUG) and confirm all 16 `palette` entries survive. If `withCustom` de-dupes by key (only the last palette line survives), encode each as a distinct key the renderer accepts (e.g. `withCustom("palette", "N=…")` may need the index folded into the value only, which is already the case) — if it still collapses, fall back to NOT theming the palette (background/foreground/cursor/selection only) and record it as a known Phase-4 limitation in the results writeup. Do not block the task on full palette parity.

> **`.inMemory` + generated-config caveat:** the spike used `configSource: .none` for `.inMemory`. If the community fork ignores the generated config for the host-managed backend (terminal renders with libghostty defaults despite the pairs), keep the code as written, note it as a limitation, and theme is then applied only where honored. The functional requirement (renders the live stream) does not depend on theming.

- [ ] **Step 2: Implement `TerminalPane`.** Create the `NSViewRepresentable` vending the cached view:

```swift
import SwiftUI
import GhosttyTerminal

struct TerminalPane: NSViewRepresentable {
    let sessionId: String
    @Environment(AppEnvironment.self) private var env

    func makeNSView(context: Context) -> AppTerminalView {
        env.terminalSurfaces.surface(
            for: sessionId, client: env.client, theme: env.themeStore.currentFile)
    }
    func updateNSView(_ nsView: AppTerminalView, context: Context) {}
}
```

If `AppEnvironment` exposes the `WSClient` under a different name than `client`, use that. Add a `currentFile: ResolvedThemeFile` accessor to `ThemeStore` if it only exposes `AppTheme` (load via the existing `ThemeStore.loadFile(id:)` keyed on `current`); reuse `ResolvedThemeFile`, don't author a new type.

- [ ] **Step 3: Own the cache in `AppEnvironment`.** Add `let terminalSurfaces = TerminalSurfaceCache()` to `AppEnvironment` (it is `@MainActor`). Ensure `env.client`/`env.themeStore` are reachable by `TerminalPane` (they already exist from Phase 3).

- [ ] **Step 4: Build.** Run: `cd native && swift build` → clean (the `TreeSitter*` "unable to open object file" warnings disappear once `GhosttyTerminal`/`CodeEditSourceEditor` are actually linked). Expected: PASS. Run `swift test` → still green.

- [ ] **Step 5: Visual verification.** Temporarily route `PaneHost`/`SplitContainer` is not built yet, so verify via a tiny DEBUG harness: in `PrimitivesGallery` (or a `#if DEBUG` preview), embed `TerminalPane(sessionId:)` for a live session id. Build the app bundle (`bash native/scripts/build-app.sh` then the dev bundle script), launch against the **sandbox** sidecar, create a `claude`/`shell` session via the sidebar, and screenshot the rendered terminal. Save to `native/evidence/p4-04-terminal-live.png`. Confirm: live TUI renders; typing advances the agent; resizing reflows. (Drag/focus visual checks are dogfood items.)

- [ ] **Step 6: Commit.** `feat(native): live terminal pane via .inMemory + surface cache (persists across tab switches)` (+ logs + evidence file logged).

---

## Task 5: `EditorPane` — native code editor (load/save/go-to-line/theme)

`CodeEditSourceEditor` editor that reads/writes via the WS file API, detects language from the extension, themes from `AppTheme`, supports ⌘S save and go-to-line. (Cmd+click import-open is Task 6.)

**Files:**
- Create: `native/Sources/Taskflow/UI/Panes/LanguageDetection.swift`
- Create: `native/Sources/Taskflow/UI/Panes/EditorTheme.swift`
- Create: `native/Sources/Taskflow/UI/Panes/EditorPane.swift`
- Test: `native/Tests/TaskflowTests/LanguageDetectionTests.swift`

**Interfaces:**
- Consumes: `CodeEditSourceEditor`, `CodeEditLanguages` (`CodeLanguage`), `CursorPosition`, `EditorTheme`; `FileViewModel.readFile`/`writeFile`; `AppTheme`/`ThemeToken`.
- Produces: `LanguageDetection.language(forPath:)`, `EditorTheme.from(_:)`, `EditorPane(filePath:)`. Used by `PaneHost` (Task 11) and Task 6 (adds the import gesture).

**Reference:** `experiments/native-slice/Sources/NativeSlice/UI/EditorPane.swift` (the `CodeEditSourceEditor($text, language:, theme:, font:, tabWidth:, lineHeight:, wrapLines:, cursorPositions:, showMinimap:)` initializer + the load-in-`init` caveat — but the slice read the local FS; **this pane reads over WS instead**).

- [ ] **Step 1: Write failing language-detection tests.** Create `LanguageDetectionTests.swift`:

```swift
import XCTest
import CodeEditLanguages
@testable import Taskflow

final class LanguageDetectionTests: XCTestCase {
    func testSwift() { XCTAssertEqual(LanguageDetection.language(forPath: "/a/b.swift").id, CodeLanguage.swift.id) }
    func testTypeScript() { XCTAssertEqual(LanguageDetection.language(forPath: "/a/b.ts").id, CodeLanguage.typescript.id) }
    func testTSX() { XCTAssertEqual(LanguageDetection.language(forPath: "/a/b.tsx").id, CodeLanguage.tsx.id) }
    func testJSON() { XCTAssertEqual(LanguageDetection.language(forPath: "/a/b.json").id, CodeLanguage.json.id) }
    func testUnknownFallsBackToDefault() {
        XCTAssertEqual(LanguageDetection.language(forPath: "/a/b.unknownext").id, CodeLanguage.default.id)
    }
}
```

- [ ] **Step 2: Run — verify fail.** `cd native && swift test --filter LanguageDetectionTests` → FAIL.

- [ ] **Step 3: Implement `LanguageDetection`.** Prefer `CodeLanguage.detectLanguageFrom(url:)` if `CodeEditLanguages` provides it (check the package API); otherwise an explicit extension map. Either way `language(forPath:)` returns a `CodeLanguage`, defaulting to `.default`:

```swift
import Foundation
import CodeEditLanguages

enum LanguageDetection {
    static func language(forPath path: String) -> CodeLanguage {
        let url = URL(fileURLWithPath: path)
        let detected = CodeLanguage.detectLanguageFrom(url: url)   // use if available
        return detected.id == .plainText ? mapByExtension(url.pathExtension) : detected
    }
    private static func mapByExtension(_ ext: String) -> CodeLanguage {
        switch ext.lowercased() {
        case "swift": return .swift
        case "ts": return .typescript
        case "tsx": return .tsx
        case "js", "mjs", "cjs": return .javascript
        case "jsx": return .jsx
        case "json": return .json
        case "css": return .css
        case "html": return .html
        case "md", "markdown": return .markdown
        default: return .default
        }
    }
}
```

Adjust to the real `CodeLanguage` case names if `CodeEditLanguages` differs (the tests pin the expected ids — fix the map until they pass).

- [ ] **Step 4: Run — verify pass.** `swift test --filter LanguageDetectionTests` → PASS.

- [ ] **Step 5: Implement `EditorTheme.from(_:)`.** Map `AppTheme` tokens to `EditorTheme` (reuse the slice's `EditorTheme(text:insertionPoint:invisibles:background:lineHighlight:selection:keywords:commands:types:attributes:variables:values:numbers:strings:characters:comments:)` shape). Pull colors from the live theme so the editor matches the app:

```swift
import SwiftUI
import CodeEditSourceEditor

enum EditorTheme {
    static func from(_ theme: AppTheme) -> CodeEditSourceEditor.EditorTheme {
        func ns(_ token: ThemeToken) -> NSColor { NSColor(theme.color(token)) }
        return .init(
            text:           .init(color: ns(.foreground)),
            insertionPoint: ns(.primary),
            invisibles:     .init(color: ns(.mutedForeground)),
            background:     ns(.background),
            lineHighlight:  ns(.muted),
            selection:      ns(.accent),
            keywords:       .init(color: ns(.primary)),
            commands:       .init(color: ns(.info)),
            types:          .init(color: ns(.info)),
            attributes:     .init(color: ns(.accentForeground)),
            variables:      .init(color: ns(.foreground)),
            values:         .init(color: ns(.success)),
            numbers:        .init(color: ns(.warning)),
            strings:        .init(color: ns(.success)),
            characters:     .init(color: ns(.success)),
            comments:       .init(color: ns(.mutedForeground))
        )
    }
}
```

Match the exact `EditorTheme` initializer/`Attribute` type from `CodeEditSourceEditor` 0.12.0; the slice file is the authoritative shape.

- [ ] **Step 6: Implement `EditorPane`.** Loads over WS (async), so unlike the slice it cannot read in `init`. Load in `.task`, hold `text`/`cursors`/`loaded` state, and key the view by `filePath` so a different file gets a fresh editor (the in-place file-swap fix):

```swift
import SwiftUI
import CodeEditSourceEditor

struct EditorPane: View {
    let filePath: String
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    @State private var text = ""
    @State private var cursors: [CursorPosition] = [CursorPosition(line: 1, column: 1)]
    @State private var loaded = false
    @State private var saveError: String?

    var body: some View {
        Group {
            if loaded {
                CodeEditSourceEditor(
                    $text,
                    language: LanguageDetection.language(forPath: filePath),
                    theme: EditorTheme.from(theme),
                    font: .monospacedSystemFont(ofSize: 13, weight: .regular),
                    tabWidth: 4, lineHeight: 1.2, wrapLines: false,
                    cursorPositions: $cursors, showMinimap: false
                )
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: filePath) {            // reload when the file path changes
            loaded = false
            do { text = try await env.file.readFile(path: filePath); loaded = true }
            catch { text = "// could not read \(filePath)"; loaded = true }
        }
        .background(
            Button("") { Task { try? await env.file.writeFile(path: filePath, content: text) } }
                .keyboardShortcut("s", modifiers: .command).hidden()
        )
        .id(filePath)
    }
}
```

Use the real `FileViewModel` accessor name on `AppEnvironment` (e.g. `env.file`). Go-to-line: expose a small helper that sets `cursors = [CursorPosition(line: n, column: 1)]` (used by Task 6 / future callers). If the 0.12.0 `CodeEditSourceEditor` initializer signature differs from the slice's, conform to the real one (the slice is the proven reference).

- [ ] **Step 7: Build + visual verify.** `cd native && swift build` → clean; `swift test` → green. Then, via the same DEBUG harness as Task 4, embed `EditorPane(filePath:)` on a real repo file, launch, screenshot syntax-highlit content + an edit+⌘S round-trip (confirm the file changed on disk via the backend). Save `native/evidence/p4-05-editor.png`.

- [ ] **Step 8: Commit.** `feat(native): native code editor pane (WS load/save, language detection, themed)` (+ logs + evidence).

---

## Task 6: Cmd+click import-open

Adds Cmd+click on an import specifier → `ts:resolve-import` → open the resolved file via `FileViewModel.onOpenFile`. The specifier extraction is a pure port of `monaco-import-navigation.ts`.

**Files:**
- Create: `native/Sources/Taskflow/UI/Panes/ImportNavigation.swift`
- Modify: `native/Sources/Taskflow/UI/Panes/EditorPane.swift` (add the gesture)
- Test: `native/Tests/TaskflowTests/ImportNavigationTests.swift`

**Interfaces:**
- Consumes: `MessageType.tsResolveImport`, the resolve response type (generated), `FileViewModel.onOpenFile`.
- Produces: `ImportNavigation.specifier(inLine:column:)` (pure), `ImportNavigation.resolve(specifier:fromFile:client:) async -> String?`.

**Reference:** `packages/ui/src/components/panes/editor/monaco-import-navigation.ts` (the specifier regex + how it derives the import string under the cursor) and the backend `ts:resolve-import` handler (`packages/backend/src/handlers/` — payload shape `{ fromPath/specifier }`, response resolved path). Known accepted loss: same-file local go-to-definition (master plan 4.3).

- [ ] **Step 1: Write failing specifier tests.** Port representative cases from `monaco-import-navigation.ts`. Create `ImportNavigationTests.swift`:

```swift
import XCTest
@testable import Taskflow

final class ImportNavigationTests: XCTestCase {
    func testExtractsDoubleQuotedSpecifierUnderCursor() {
        let line = #"import { x } from "./foo/bar";"#
        // column within the "./foo/bar" token
        XCTAssertEqual(ImportNavigation.specifier(inLine: line, column: 22), "./foo/bar")
    }
    func testExtractsSingleQuotedSpecifier() {
        let line = "import y from '@scope/pkg'"
        XCTAssertEqual(ImportNavigation.specifier(inLine: line, column: 18), "@scope/pkg")
    }
    func testReturnsNilOutsideAnySpecifier() {
        XCTAssertNil(ImportNavigation.specifier(inLine: #"const a = 1;"#, column: 4))
    }
    func testRequireSpecifier() {
        let line = #"const m = require("./util")"#
        XCTAssertEqual(ImportNavigation.specifier(inLine: line, column: 22), "./util")
    }
}
```

- [ ] **Step 2: Run — verify fail.** `cd native && swift test --filter ImportNavigationTests` → FAIL.

- [ ] **Step 3: Implement `ImportNavigation`.** Find the quoted string token containing `column`; restrict to lines that look like import/require/from (mirror the TS regex). Then the resolve call:

```swift
import Foundation

enum ImportNavigation {
    /// Returns the module specifier (quoted string) under `column`, if the line is an import/require.
    /// Pure port of monaco-import-navigation.ts.
    static func specifier(inLine line: String, column: Int) -> String? {
        let importish = line.range(of: #"\b(import|export|require|from)\b"#, options: .regularExpression) != nil
        guard importish else { return nil }
        let chars = Array(line)
        guard column >= 0, column <= chars.count else { return nil }
        // Scan quoted tokens; return the one whose range covers `column`.
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c == "\"" || c == "'" {
                let quote = c; let start = i + 1; var j = start
                while j < chars.count && chars[j] != quote { j += 1 }
                if column >= start && column <= j { return String(chars[start..<j]) }
                i = j + 1; continue
            }
            i += 1
        }
        return nil
    }

    /// Resolves a specifier to an absolute path via the backend; nil if unresolved.
    static func resolve(specifier: String, fromFile: String, client: WSClient) async -> String? {
        struct Resp: Decodable { let path: String? }   // align field names to the generated type
        let resp: Resp? = try? await client.request(
            .tsResolveImport, payload: ["fromPath": fromFile, "specifier": specifier])
        return resp?.path
    }
}
```

Replace the inline `Resp` with the real generated response type and the real payload keys from the backend handler (read it; do not guess). Tune the specifier regex/cases against `monaco-import-navigation.ts` until the tests pass.

- [ ] **Step 4: Run — verify pass.** `swift test --filter ImportNavigationTests` → PASS.

- [ ] **Step 5: Wire the gesture in `EditorPane`.** Add a Cmd+click handler that maps the click to a line/column (use the editor's `cursors` after a click, or an `NSClickGestureRecognizer` overlay reading the cursor position), extracts the specifier, resolves it, and calls `env.file.onOpenFile?(resolvedPath)`. Keep it minimal: on `⌘`-modified primary click, read the current `cursors.first`, get that line's text from `text`, call `ImportNavigation.specifier(inLine:column:)`, then `resolve`, then `onOpenFile`. If precise hit-testing against `CodeEditSourceEditor` is not exposed in 0.12.0, drive it off the current cursor position (the user ⌘-clicks to move the cursor, then we read it) — document this as the Phase-4 mechanism.

- [ ] **Step 6: Build + verify.** `swift build` clean; `swift test` green. Visual: ⌘-click an import in a TS file in the launched app → the resolved file opens as a new editor tab. Screenshot `native/evidence/p4-06-import-open.png`.

- [ ] **Step 7: Commit.** `feat(native): Cmd+click import-open via ts:resolve-import` (+ logs + evidence).

---

## Task 7: Diff parsing + `DiffView` (read-only diff viewer)

A pure unified-diff parser + a read-only SwiftUI renderer, reused by the changes pane (Task 8). Covers master-plan 4.2's "read-only diff viewer".

**Files:**
- Create: `native/Sources/Taskflow/UI/Panes/DiffView.swift`
- Test: `native/Tests/TaskflowTests/DiffParseTests.swift`

**Interfaces:**
- Consumes: `AppTheme` (for +/- colors).
- Produces: `DiffView.Line` (`enum kind { case addition, deletion, context, hunkHeader, fileHeader }`, `text: String`), `DiffView.parse(_:) -> [Line]`, `DiffView(unifiedDiff: String)` View. Used by `ChangesPane` (Task 8) and `PaneHost` (`changes` tab, Task 11).

- [ ] **Step 1: Write failing parser tests.** Create `DiffParseTests.swift`:

```swift
import XCTest
@testable import Taskflow

final class DiffParseTests: XCTestCase {
    func testClassifiesLineKinds() {
        let diff = """
        diff --git a/x.ts b/x.ts
        @@ -1,2 +1,2 @@
         context
        -old
        +new
        """
        let lines = DiffView.parse(diff)
        XCTAssertEqual(lines.map(\.kind), [.fileHeader, .hunkHeader, .context, .deletion, .addition])
    }
    func testStripsLeadingMarkerFromText() {
        let lines = DiffView.parse("+added")
        XCTAssertEqual(lines.first?.kind, .addition)
        XCTAssertEqual(lines.first?.text, "added")
    }
    func testEmptyDiffIsEmpty() { XCTAssertTrue(DiffView.parse("").isEmpty) }
}
```

- [ ] **Step 2: Run — verify fail.** `cd native && swift test --filter DiffParseTests` → FAIL.

- [ ] **Step 3: Implement `DiffView`.**

```swift
import SwiftUI

struct DiffView: View {
    enum Kind: Equatable { case addition, deletion, context, hunkHeader, fileHeader }
    struct Line: Equatable, Identifiable { let id = UUID(); let kind: Kind; let text: String }

    let lines: [Line]
    @Environment(\.appTheme) private var theme
    init(unifiedDiff: String) { self.lines = Self.parse(unifiedDiff) }

    static func parse(_ unified: String) -> [Line] {
        guard !unified.isEmpty else { return [] }
        return unified.split(separator: "\n", omittingEmptySubsequences: false).map { raw in
            let s = String(raw)
            if s.hasPrefix("diff --git") || s.hasPrefix("index ") || s.hasPrefix("--- ") || s.hasPrefix("+++ ") {
                return Line(kind: .fileHeader, text: s)
            }
            if s.hasPrefix("@@") { return Line(kind: .hunkHeader, text: s) }
            if s.hasPrefix("+") { return Line(kind: .addition, text: String(s.dropFirst())) }
            if s.hasPrefix("-") { return Line(kind: .deletion, text: String(s.dropFirst())) }
            if s.hasPrefix(" ") { return Line(kind: .context, text: String(s.dropFirst())) }
            return Line(kind: .context, text: s)
        }
    }

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(lines) { line in
                    Text(line.text.isEmpty ? " " : line.text)
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(fg(line.kind))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(bg(line.kind))
                }
            }.padding(.vertical, 4)
        }
    }
    private func fg(_ k: Kind) -> Color {
        switch k { case .hunkHeader, .fileHeader: return theme.mutedForeground; default: return theme.foreground }
    }
    private func bg(_ k: Kind) -> Color {
        switch k {
        case .addition: return theme.color(.success).opacity(0.12)
        case .deletion: return theme.color(.destructive).opacity(0.12)
        default: return .clear
        }
    }
}
```

Use real `AppTheme` accessors (`mutedForeground` may be `color(.mutedForeground)` — match `AppTheme.swift`).

- [ ] **Step 4: Run — verify pass + build.** `swift test --filter DiffParseTests` → PASS; `swift build` → clean.

- [ ] **Step 5: Commit.** `feat(native): unified-diff parser + read-only DiffView` (+ logs).

---

## Task 8: `ChangesPane` (git status + per-file diff)

The `changes` tab: lists changed files from `git:status` and shows the selected file's diff via `git:diff-file-content`, rendered with `DiffView`.

**Files:**
- Create: `native/Sources/Taskflow/UI/Panes/ChangesPane.swift`

**Interfaces:**
- Consumes: `MessageType.gitStatus`/`.gitDiffFileContent`, `GitStatusResponse`/`GitStatusResult` (generated, already used by `FileViewModel`), `DiffView` (Task 7), the diff-file-content response type (generated).
- Produces: `ChangesPane(repoPath:)`. Used by `PaneHost` (Task 11).

**Reference:** `FileViewModel.fetchGitStatus` already calls `git:status` and decodes `GitStatusResult`. Read the backend `git:diff-file-content` handler for its exact payload (`{ path, repoPath?, staged? }`) and response (`{ diff }` / unified text).

- [ ] **Step 1: Implement `ChangesPane`.**

```swift
import SwiftUI

struct ChangesPane: View {
    let repoPath: String
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    @State private var status: GitStatusResult?
    @State private var selected: String?
    @State private var diff = ""

    var body: some View {
        HStack(spacing: 0) {
            List(changedPaths, id: \.self, selection: $selected) { path in
                Text(URL(fileURLWithPath: path).lastPathComponent)
                    .font(.system(.body, design: .monospaced))
            }
            .frame(width: 240)
            Divider().background(theme.border)
            if diff.isEmpty { Text("Select a file").foregroundStyle(theme.mutedForeground)
                .frame(maxWidth: .infinity, maxHeight: .infinity) }
            else { DiffView(unifiedDiff: diff) }
        }
        .task(id: repoPath) { await loadStatus() }
        .onChange(of: selected) { _, new in if let new { Task { await loadDiff(new) } } }
    }

    private var changedPaths: [String] { /* flatten GitStatusResult into the list of file paths */ [] }

    private func loadStatus() async {
        let resp: GitStatusResponse? = try? await env.client.request(.gitStatus, payload: ["path": repoPath])
        status = resp?.status
    }
    private func loadDiff(_ path: String) async {
        struct Resp: Decodable { let diff: String }   // align to the generated type
        let resp: Resp? = try? await env.client.request(
            .gitDiffFileContent, payload: ["path": path, "repoPath": repoPath])
        diff = resp?.diff ?? ""
    }
}
```

Replace the `changedPaths` stub by reading the real `GitStatusResult` shape (modified/staged/untracked arrays — see `GitTypes.swift`) and the inline `Resp` with the generated `git:diff-file-content` response type and correct payload keys (read the backend handler). Use `env.client`'s real accessor name.

- [ ] **Step 2: Build + visual verify.** `swift build` clean. In the launched app, open a task whose worktree has changes, open a `changes` tab (or the DEBUG harness), select a file → diff renders with +/- coloring. Screenshot `native/evidence/p4-08-changes.png`.

- [ ] **Step 3: Commit.** `feat(native): changes pane (git status list + per-file diff)` (+ logs + evidence).

---

## Task 9: `BrowserPane` (the one real WKWebView)

**Files:**
- Create: `native/Sources/Taskflow/UI/Panes/BrowserPane.swift`

**Interfaces:**
- Consumes: `WebKit`. Produces: `BrowserPane(url:)`. Used by `PaneHost` (Task 11).

- [ ] **Step 1: Implement `BrowserPane`.**

```swift
import SwiftUI
import WebKit

struct BrowserPane: NSViewRepresentable {
    let url: String

    func makeNSView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero)
        load(url, into: view)
        return view
    }
    func updateNSView(_ nsView: WKWebView, context: Context) {
        if context.coordinator.lastURL != url { load(url, into: nsView) }
    }
    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator { var lastURL: String? }

    private func load(_ s: String, into view: WKWebView) {
        guard let u = URL(string: s) else { return }
        view.load(URLRequest(url: u))
    }
}
```

Store `lastURL` in the coordinator and set it in `updateNSView` to avoid reloading on every redraw. (App Sandbox/network entitlements: the bundle already loads remote content for the WS connection; if a future hardened-runtime build blocks navigation, that's a Phase-6 entitlement item — note it, don't block here.)

- [ ] **Step 2: Build + visual verify.** `swift build` clean. Launch, open a `browser` tab pointed at a URL → page loads. Screenshot `native/evidence/p4-09-browser.png`.

- [ ] **Step 3: Commit.** `feat(native): browser pane (WKWebView)` (+ logs + evidence).

---

## Task 10: `MarkdownPane` (plain word-wrapped text)

Per the UI-scope decision, markdown renders as plain word-wrapped text (no WKWebView). Loads file content over WS.

**Files:**
- Create: `native/Sources/Taskflow/UI/Panes/MarkdownPane.swift`

**Interfaces:**
- Consumes: `FileViewModel.readFile`, `AppTheme`. Produces: `MarkdownPane(filePath:)`. Used by `PaneHost` (Task 11).

- [ ] **Step 1: Implement `MarkdownPane`.**

```swift
import SwiftUI

struct MarkdownPane: View {
    let filePath: String
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme
    @State private var content = ""

    var body: some View {
        ScrollView {
            Text(content)
                .font(.system(.body, design: .default))
                .foregroundStyle(theme.foreground)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
        }
        .background(theme.background)
        .task(id: filePath) {
            content = (try? await env.file.readFile(path: filePath)) ?? "Could not read \(filePath)"
        }
    }
}
```

- [ ] **Step 2: Build + verify.** `swift build` clean; launch + screenshot a rendered `.md` file. `native/evidence/p4-10-markdown.png`.

- [ ] **Step 3: Commit.** `feat(native): markdown pane (word-wrapped text)` (+ logs + evidence).

---

## Task 11: `PaneHost` router + `SplitContainer` integration (end-to-end)

Wire all panes into the spine: replace `PanePlaceholder` with a `PaneHost` that switches on the active tab's type, inject `FileViewModel.onOpenFile`, and verify the whole workspace end-to-end. This is the integration gate.

**Files:**
- Create: `native/Sources/Taskflow/UI/Workspace/PaneHost.swift`
- Modify: `native/Sources/Taskflow/UI/Workspace/SplitContainer.swift`
- Modify: `native/Sources/Taskflow/App/AppEnvironment.swift` (inject `onOpenFile`)
- Delete: `native/Sources/Taskflow/UI/Workspace/PanePlaceholder.swift`

**Interfaces:**
- Consumes: all pane views (Tasks 4–10), `Tab`/`TabType`, `AppEnvironment` (resolving `repoPath`/`url`/`filePath` per tab).
- Produces: `PaneHost(activeTab:workspaceKey:)`.

- [ ] **Step 1: Implement `PaneHost`.** Switch on `activeTab?.type`. Terminal-family types (`claude`, `codex`, `opencode`, `gemini`, `cursor`, `pi`, `shell`) need a `sessionId`; `editor`/`markdown` need `filePath`; `browser` needs `url`; `changes` needs the workspace repo path.

```swift
import SwiftUI

struct PaneHost: View {
    let activeTab: Tab?
    let workspaceKey: String
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    var body: some View {
        Group {
            switch activeTab?.type {
            case .claude, .codex, .opencode, .gemini, .cursor, .pi, .shell:
                if let sid = activeTab?.sessionId { TerminalPane(sessionId: sid) } else { empty }
            case .editor:
                if let p = activeTab?.filePath { EditorPane(filePath: p) } else { empty }
            case .markdown:
                if let p = activeTab?.filePath { MarkdownPane(filePath: p) } else { empty }
            case .browser:
                if let u = activeTab?.url { BrowserPane(url: u) } else { empty }
            case .changes:
                if let repo = repoPath { ChangesPane(repoPath: repo) } else { empty }
            case .none:
                empty
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var empty: some View {
        Text("No content").font(.caption2).foregroundStyle(theme.foreground.opacity(0.2))
            .frame(maxWidth: .infinity, maxHeight: .infinity).background(theme.color(.card))
    }
    /// Resolve the repo/worktree path for the workspace (task worktree or project path).
    private var repoPath: String? { /* derive from workspaceKey via env.task/env.project */ nil }
}
```

Implement `repoPath` by mapping `workspaceKey` (`WorkspaceKey.task(...)`/`.project(...)`) back to the owning task's worktree path or the project path via `env.task`/`env.project` (read those VMs' lookup APIs). For changes/editor without a backing path, `empty` is acceptable.

- [ ] **Step 2: Swap the call site in `SplitContainer`.** Replace `PanePlaceholder(for: env.session?.activeTab(paneKey))` with `PaneHost(activeTab: env.session?.activeTab(paneKey), workspaceKey: paneKey)`. Leave the surrounding `VStack`/drop-destination untouched.

- [ ] **Step 3: Inject `onOpenFile`.** In `AppEnvironment` (where the other cross-store closures are wired in Phase 3's Task 8), set `file.onOpenFile = { [weak self] path in self?.session?... }` to open the file as an editor tab in the active workspace. Use the existing session/UI APIs to add an `editor` tab (create a `Tab(id:UUID, type:.editor, label: filename, filePath: path)` and `session.addTab(activeWorkspaceKey, tab)`). Reuse `SessionViewModel.normalizeSessionLabel`/`addTab`; don't invent a new path.

- [ ] **Step 4: Delete `PanePlaceholder.swift`.** Confirm no remaining references (`grep -rn PanePlaceholder native/Sources`), then delete the file.

- [ ] **Step 5: Build + full regression.** Run: `cd native && swift build` → clean; `swift test` → all green (Phase-3 102 + all Phase-4 additions). Expected: PASS.

- [ ] **Step 6: End-to-end visual verification.** Build the dev app bundle, launch against the **sandbox** sidecar, and exercise: (a) select a task → its sessions show as tabs; (b) a `claude`/`shell` tab renders the live terminal and accepts input; (c) open a file → editor renders + ⌘S saves + ⌘-click import opens; (d) a `changes` tab shows the diff; (e) a `browser` tab loads; (f) switch away from a terminal tab and back → session persists (no re-snapshot flash). Screenshots: `native/evidence/p4-11-workspace-terminal.png`, `p4-11-workspace-editor.png`, `p4-11-workspace-changes.png`. Confirm the host production Taskflow is untouched (isolation intact).

- [ ] **Step 7: Commit.** `feat(native): PaneHost router wires real panes into the spine; remove PanePlaceholder` (+ logs + evidence).

---

## Task 12: Results writeup + SDD ledger + memory update

**Files:**
- Create: `native/../docs/superpowers/specs/2026-06-27-phase4-panes-results.md`
- Modify: `.superpowers/sdd/progress.md`
- Modify: `/Users/kuindji/.claude/projects/-Users-kuindji-Projects-taskflow/memory/project_native_app_experiment_status.md` (+ `MEMORY.md` pointer if the hook line changes)

- [ ] **Step 1: Write the results spec** mirroring `2026-06-27-phase3-structural-spine-results.md`: what each task landed; test counts (`swift test` total, codegen `bun test` still 7); the evidence index (`p4-*.png`); the **D4 resolution** (all sessions via `.inMemory`-over-WS; `.exec` not used; env-scrub hazard moot) and the master-plan 4.1–4.5 acceptance mapping; honest caveats (palette/`.inMemory` theming if it didn't fully apply; ⌘-click hit-testing mechanism; drag/focus = dogfood-verify); carry-forwards resolved (terminal session persistence; editor file-swap; file:changed/activity seams) and any new open items (e.g. WKWebView entitlements → Phase 6).

- [ ] **Step 2: Update the SDD ledger** `.superpowers/sdd/progress.md` with per-task status + minor-findings triage (same format as Phase 3).

- [ ] **Step 3: Update the resume-point memory** `project_native_app_experiment_status.md`: mark Phase 4 COMPLETE, set new HEAD, note the D4 resolution, and set the next step = Phase 5 (feature-area breadth fan-out). Keep it ≤ the existing structure; update the `MEMORY.md` pointer line if the hook changed.

- [ ] **Step 4: Commit.** `docs: Phase 4 panes results + ledger` (+ logs). Then verify the branch is left as-is (no merge/PR), matching prior phases.

---

## Self-Review

**Spec coverage (master-plan Phase 4 units):**
- 4.1 Terminal pane (interactive + watched) → Tasks 3+4 (one `.inMemory`-over-WS path covers both; activity status = Task 1). ✅
- 4.2 Native code editor + diff → Task 5 (editor) + Task 7 (read-only diff). ✅
- 4.3 Cmd+click import-open → Task 6 (known loss: same-file go-to-def, documented). ✅
- 4.4 Browser pane → Task 9. ✅
- 4.5 Changes + Markdown panes → Task 8 (changes) + Task 10 (markdown). ✅
- Phase-3 carry-forward seams: SessionViewModel activity (Task 1), FileViewModel file:changed (Task 2), session persistence across tabs (Task 4 cache), editor file-swap (Task 5 `.id(filePath)` + WS load). ✅
- Integration + task-scoping (panes driven by the active tab) → Task 11. ✅

**Placeholder scan:** the few `/* ... */` stubs (`changedPaths` flatten, `repoPath` resolution, inline `Resp` decodables) are explicitly flagged as "replace with the real generated type / VM lookup — read the source, do not guess", with the authoritative file named in each case. These are deliberate "consult the real type" markers, not hand-wave TODOs; each has a concrete resolution instruction and a passing test or build gate. The terminal palette/`.inMemory`-theming caveats carry explicit decision rules + fallbacks.

**Type consistency:** `TerminalSessionBridge.reconcile`/`start`/`sendInput`/`resize`/`stop`, `TerminalSurfaceCache.surface(for:client:theme:)`, `LanguageDetection.language(forPath:)`, `EditorTheme.from(_:)`, `ImportNavigation.specifier(inLine:column:)`/`resolve(specifier:fromFile:client:)`, `DiffView.parse`/`Line`/`Kind`, `PaneHost(activeTab:workspaceKey:)` are used consistently across the Interfaces blocks and call sites. Generated payload/response types (`SessionSnapshotResponse`, `SessionHistoryResponse`, `TerminalOutputEvent`, `SessionStatusEvent`, `FileChangeEvent`, `GitStatusResponse`) are referenced as already-existing/codegen-owned and verified-or-regenerated in their first task.
