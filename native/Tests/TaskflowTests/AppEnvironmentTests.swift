import XCTest
@testable import Taskflow

/// Offline wiring smoke tests for `AppEnvironment`.
///
/// These tests exercise composition and closure wiring without any network or live sidecar.
/// A `WSClient(url: ws://localhost:1)` (borrowed from `WSClientTests`) is used as the
/// unconnected client — it registers event handlers without opening a socket.
@MainActor
final class AppEnvironmentTests: XCTestCase {

    // MARK: - Eager construction

    func testUIIsEagerlyConstructed() {
        // ui has no client dependency — must be non-nil immediately after init()
        let env = AppEnvironment()
        XCTAssertNotNil(env.ui)
    }

    func testClientDependentVMsAreNilBeforeCompose() {
        let env = AppEnvironment()
        XCTAssertNil(env.tasks)
        XCTAssertNil(env.projects)
        XCTAssertNil(env.session)
        XCTAssertNil(env.flows)
        XCTAssertNil(env.search)
        XCTAssertNil(env.files)
        XCTAssertNil(env.settings)
        XCTAssertNil(env.notifications)
        XCTAssertNil(env.runMenu)
        XCTAssertNil(env.diff)
        XCTAssertNil(env.schedules)
        XCTAssertNil(env.models)
        XCTAssertNil(env.settingsCatalog)
        XCTAssertNil(env.themeCatalog)
    }

    // MARK: - compose(client:) sets all VMs

    func testComposeSetsAllVMs() {
        let env = AppEnvironment()
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        env.compose(client: client)
        XCTAssertNotNil(env.tasks)
        XCTAssertNotNil(env.projects)
        XCTAssertNotNil(env.session)
        XCTAssertNotNil(env.flows)
        XCTAssertNotNil(env.search)
        XCTAssertNotNil(env.files)
        XCTAssertNotNil(env.settings)
        XCTAssertNotNil(env.notifications)
        XCTAssertNotNil(env.runMenu)
        XCTAssertNotNil(env.diff)
        XCTAssertNotNil(env.schedules)
        XCTAssertNotNil(env.models)
        XCTAssertNotNil(env.settingsCatalog)
        XCTAssertNotNil(env.themeCatalog)
    }

    func testUIRemainsNonNilAfterCompose() {
        let env = AppEnvironment()
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        env.compose(client: client)
        XCTAssertNotNil(env.ui)
    }

    // MARK: - Cross-dep closure wiring

    func testCrossDepClosuresAreWired() {
        let env = AppEnvironment()
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        env.compose(client: client)

        // projects cross-deps
        XCTAssertNotNil(env.projects?.onProjectShouldClearActive,
                        "projects.onProjectShouldClearActive must be wired in compose()")
        XCTAssertNotNil(env.projects?.onProjectCollapseReset,
                        "projects.onProjectCollapseReset must be wired in compose()")
        XCTAssertNotNil(env.projects?.onTasksShouldRefresh,
                        "projects.onTasksShouldRefresh must be wired in compose()")

        // settings → ui hydration
        XCTAssertNotNil(env.settings?.onLayoutHydrate,
                        "settings.onLayoutHydrate must be wired in compose()")

        // flows → session focus
        XCTAssertNotNil(env.flows?.onRunFocus,
                        "flows.onRunFocus must be wired in compose()")

        // session → task/project refresh (post create/close)
        XCTAssertNotNil(env.session?.onFetchTasks,
                        "session.onFetchTasks must be wired in compose()")
        XCTAssertNotNil(env.session?.onFetchProjects,
                        "session.onFetchProjects must be wired in compose()")

        // session → surface cache eviction (FIX 2)
        XCTAssertNotNil(env.session?.onTerminalEvict,
                        "session.onTerminalEvict must be wired in compose() so closed/exited terminals evict their cache entry")
    }

    // MARK: - files.onOpenFile wired in Phase 4

    func testFilesOnOpenFileIsWiredPhase4() {
        let env = AppEnvironment()
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        env.compose(client: client)
        // Phase 4: editor pane built — confirm the closure is now wired.
        XCTAssertNotNil(env.files?.onOpenFile,
                        "files.onOpenFile must be wired in compose() after Phase 4")
    }

    // MARK: - Closure effect: onProjectShouldClearActive clears active project

    func testOnProjectShouldClearActiveGuardsById() {
        let env = AppEnvironment()
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        env.compose(client: client)

        env.ui.setActiveProject("proj-1")
        XCTAssertEqual(env.ui.activeProjectId, "proj-1")

        // Clearing a different id must NOT change active project
        env.projects?.onProjectShouldClearActive?("proj-99")
        XCTAssertEqual(env.ui.activeProjectId, "proj-1", "different id must be ignored")

        // Clearing the matching id must set it to nil
        env.projects?.onProjectShouldClearActive?("proj-1")
        XCTAssertNil(env.ui.activeProjectId, "matching id must clear active project")
    }

    // MARK: - Closure effect: onProjectCollapseReset removes from collapsedProjectIds

    func testOnProjectCollapseResetClearsCollapsed() {
        let env = AppEnvironment()
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        env.compose(client: client)

        env.ui.setProjectCollapsed("proj-a", true)
        XCTAssertTrue(env.ui.collapsedProjectIds.contains("proj-a"))

        env.projects?.onProjectCollapseReset?("proj-a")
        XCTAssertFalse(env.ui.collapsedProjectIds.contains("proj-a"),
                       "collapse reset must remove project from collapsedProjectIds")
    }

    // MARK: - Session sync wiring (review fix: sync reducers were implemented but never called)

    private func makeSessionRef(_ id: String) -> SessionRef {
        SessionRef(id: id, type: "claude", label: "Claude", createdAt: "0",
                   instance: nil, trayExclude: nil)
    }

    func testOnTasksChangedSyncsSessionTabs() {
        let env = AppEnvironment()
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        env.compose(client: client)

        XCTAssertNotNil(env.tasks?.onTasksChanged,
                        "tasks.onTasksChanged must be wired in compose() so task sessions materialize as tabs")
        let task = TaskItem(
            id: "t1", projectId: "p", parentId: nil, title: "t", description: "",
            notes: "", worktree: TaskWorktree(enabled: false, path: nil, branch: nil, pr: nil),
            sessions: [makeSessionRef("sess-1")], createdAt: "0", status: "active",
            archivedAt: nil, pinned: false, initCommand: nil
        )
        env.tasks?.onTasksChanged?([task])
        XCTAssertEqual(env.session?.tabs("task:t1").compactMap(\.sessionId), ["sess-1"],
                       "a task's backend sessions must appear as workspace tabs")
    }

    func testOnProjectsChangedSyncsSessionTabs() {
        let env = AppEnvironment()
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        env.compose(client: client)

        XCTAssertNotNil(env.projects?.onProjectsChanged,
                        "projects.onProjectsChanged must be wired in compose()")
        let project = Project(
            id: "p1", name: "n", path: "/p", sessions: [makeSessionRef("sess-2")],
            createdAt: "0", defaultInitCommand: nil, prompt: nil,
            linkedProjects: nil, hidden: nil, locationValid: nil
        )
        env.projects?.onProjectsChanged?([project])
        XCTAssertEqual(env.session?.tabs("project:p1").compactMap(\.sessionId), ["sess-2"],
                       "a project's backend sessions must appear as workspace tabs")
    }

    func testMasterSessionsListEventSyncsTabs() {
        let env = AppEnvironment()
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        env.compose(client: client)

        let payload = Data(
            #"{"sessions":[{"id":"m1","type":"claude","label":"Claude","createdAt":"0"}]}"#.utf8)
        client.handleInbound(.event(type: "master:sessions-list", payload: payload))
        XCTAssertEqual(env.session?.tabs("master").compactMap(\.sessionId), ["m1"],
                       "a master:sessions-list broadcast must sync master workspace tabs")
    }

    // MARK: - shutdown() lifecycle (review fix: reopen after window close booted against a dead sidecar)

    func testShutdownResetsClientAndStatus() {
        let env = AppEnvironment()
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        env.compose(client: client)
        XCTAssertNotNil(env.client)

        env.shutdown()
        XCTAssertNil(env.client, "shutdown must release the client — the sidecar it talked to is gone")
        XCTAssertEqual(env.status, .connecting,
                       "shutdown must reset status so a window-reopen boot() passes its .connecting guard")
    }

    // MARK: - Closure effect: onLayoutHydrate writes widths to UIViewModel

    func testOnLayoutHydrateWritesClamped() {
        let env = AppEnvironment()
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        env.compose(client: client)

        let panels = PanelSettings(
            sidebarWidth: 999,          // will be clamped to 350
            fileExplorerWidth: 200,
            taskInfoWidth: 200,
            flowPanelWidth: 200,
            compactSidebar: false,
            collapsedProjectIds: ["x"],
            markdownEditorPosition: nil,
            markdownEditorSize: nil
        )
        env.settings?.onLayoutHydrate?(panels)

        XCTAssertEqual(env.ui.sidebarWidth, 350, "sidebar width must be clamped to max (350)")
        XCTAssertTrue(env.ui.collapsedProjectIds.contains("x"))
    }
}
