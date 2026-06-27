import XCTest
@testable import Taskflow

@MainActor
final class SessionViewModelTests: XCTestCase {
    private func tab(_ id: String) -> Tab { Tab(id: id, type: .shell, label: id) }

    // MARK: - arrayMove

    func testArrayMove() {
        XCTAssertEqual(SessionViewModel.arrayMove(["a", "b", "c"], 0, 2), ["b", "c", "a"])
        XCTAssertEqual(SessionViewModel.arrayMove(["a", "b", "c"], 2, 0), ["c", "a", "b"])
    }

    func testArrayMoveNoOp() {
        XCTAssertEqual(SessionViewModel.arrayMove(["a", "b"], 1, 1), ["a", "b"])
    }

    // MARK: - reorder

    func testReorderByIds() {
        let out = SessionViewModel.reorder([tab("a"), tab("b"), tab("c")], activeId: "a", overId: "c")
        XCTAssertEqual(out.map(\.id), ["b", "c", "a"])
    }

    func testReorderUnknownIdIsNoOp() {
        let tabs = [tab("a"), tab("b")]
        let out = SessionViewModel.reorder(tabs, activeId: "a", overId: "zzz")
        XCTAssertEqual(out.map(\.id), ["a", "b"])
    }

    // MARK: - move (cross-pane)

    func testMoveCrossPaneAppendsAndActivates() {
        let r = SessionViewModel.move(
            source: [tab("a"), tab("b")],
            target: [tab("x")],
            tabId: "a",
            insertIndex: nil,
            sourceActive: "a"
        )
        XCTAssertEqual(r?.source.map(\.id), ["b"])
        XCTAssertEqual(r?.target.map(\.id), ["x", "a"])
        XCTAssertEqual(r?.targetActive, "a")   // moved tab becomes active in target
        XCTAssertEqual(r?.sourceActive, "b")   // source reselects last survivor
    }

    func testMoveCrossPaneAtIndex() {
        let r = SessionViewModel.move(
            source: [tab("a")],
            target: [tab("x"), tab("y")],
            tabId: "a",
            insertIndex: 1,
            sourceActive: "a"
        )
        XCTAssertEqual(r?.target.map(\.id), ["x", "a", "y"])
        XCTAssertNil(r?.sourceActive)          // source now empty → nil
    }

    func testMoveUnknownTabIsNoOp() {
        XCTAssertNil(SessionViewModel.move(
            source: [tab("a")],
            target: [],
            tabId: "zzz",
            insertIndex: nil,
            sourceActive: "a"
        ))
    }

    func testMoveNonActiveTabPreservesSourceActive() {
        // Moving "b" while "a" is active — source active stays "a"
        let r = SessionViewModel.move(
            source: [tab("a"), tab("b")],
            target: [tab("x")],
            tabId: "b",
            insertIndex: nil,
            sourceActive: "a"
        )
        XCTAssertEqual(r?.source.map(\.id), ["a"])
        XCTAssertEqual(r?.sourceActive, "a")
        XCTAssertEqual(r?.targetActive, "b")
    }

    // MARK: - Demo-tab reorder (state-path proof for p3-10-reorder-after evidence)
    //
    // Reproduces the exact demo state seeded by WorkspaceView in DEBUG builds:
    //   [Claude, Shell, Editor]
    // Simulates dragging the Claude tab chip over the Shell chip (same pane):
    //   TabItem.dropDestination fires with dropped.tabId="demo-claude-1", tab.id="demo-shell-1"
    //   → session.reorderTabs(key, activeId: "demo-claude-1", overId: "demo-shell-1")
    // Expected result: [Shell, Claude, Editor]
    func testDemoTabReorderViaInstanceMethod() {
        let client = WSClient(url: URL(string: "ws://127.0.0.1:1")!)
        let vm = SessionViewModel(client: client)
        let key = WorkspaceKey.master

        vm.addTab(key, Tab(id: "demo-claude-1", type: .claude, label: "Claude"))
        vm.addTab(key, Tab(id: "demo-shell-1",  type: .shell,  label: "Shell"),  activate: false)
        vm.addTab(key, Tab(id: "demo-editor-1", type: .editor, label: "Editor"), activate: false)

        // Before drag: Claude | Shell | Editor
        XCTAssertEqual(vm.tabs(key).map(\.id),
                       ["demo-claude-1", "demo-shell-1", "demo-editor-1"],
                       "initial order")
        XCTAssertEqual(vm.activeTabByWorkspace[key], "demo-claude-1", "Claude active before drag")

        // Simulate: drag Claude chip → drop on Shell chip (same pane)
        vm.reorderTabs(key, activeId: "demo-claude-1", overId: "demo-shell-1")

        // After drag: Shell | Claude | Editor  (Claude still active; only order changed)
        XCTAssertEqual(vm.tabs(key).map(\.id),
                       ["demo-shell-1", "demo-claude-1", "demo-editor-1"],
                       "order after drag-reorder")
        XCTAssertEqual(vm.activeTabByWorkspace[key], "demo-claude-1",
                       "active tab unchanged after reorder")
    }

    // MARK: - FIX 1: sendInput routes through VM (marks interaction)

    /// Verifies that `sendInput` calls `markInteraction` on the activity tracker so the
    /// 500ms suppression window engages.  Uses the internal `isInteractingTestSeam` — a
    /// thin delegating method that avoids making `activity` visible outside the type.
    func testSendInputMarksInteraction() {
        let client = WSClient(url: URL(string: "ws://127.0.0.1:1")!)
        let vm = SessionViewModel(client: client)

        XCTAssertFalse(vm.isInteractingTestSeam("s1"), "no interaction recorded yet")
        vm.sendInput(sessionId: "s1", data: "hello")
        XCTAssertTrue(vm.isInteractingTestSeam("s1"),
                      "sendInput must mark interaction so the suppression window engages")
    }

    // MARK: - FIX 2: onTerminalEvict fires even when closeSession RPC throws

    /// Verifies that `onTerminalEvict` is called BEFORE the async RPC so the surface cache
    /// is always released — even when the server-side close throws (dead socket here).
    ///
    /// Choice rationale: testing `closeSession` directly (rather than the `session:exited`
    /// WS event) is fully deterministic — no live socket needed.  A dead `WSClient` causes
    /// `requestRaw` to throw immediately, which is exactly the failure mode we need to cover.
    func testCloseSessionCallsOnTerminalEvictEvenOnThrow() async {
        let client = WSClient(url: URL(string: "ws://127.0.0.1:1")!)
        let vm = SessionViewModel(client: client)
        var evicted: [String] = []
        vm.onTerminalEvict = { evicted.append($0) }

        try? await vm.closeSession(sessionId: "session-abc")

        XCTAssertEqual(evicted, ["session-abc"],
                       "onTerminalEvict must fire before requestRaw so eviction is not skipped on throw")
    }

    // addTab id-dedup: reopening the same file's editor tab (sessionId == nil) must focus the
    // existing tab, not append a duplicate. Without id-dedup, N opens → N identical tabs.
    func testAddTabIdDedupForEditorTabs() {
        let client = WSClient(url: URL(string: "ws://127.0.0.1:1")!)
        let vm = SessionViewModel(client: client)
        let key = WorkspaceKey.master

        let tab = Tab(id: "editor:/x.swift", type: .editor, label: "x.swift", filePath: "/x.swift")
        vm.addTab(key, tab)
        vm.addTab(key, tab) // reopen same path → must focus, not duplicate

        XCTAssertEqual(vm.tabs(key).count, 1, "same-id editor tab must not duplicate")
        XCTAssertEqual(vm.activeTabByWorkspace[key], "editor:/x.swift",
                       "reopened editor tab must be active")
    }
}
