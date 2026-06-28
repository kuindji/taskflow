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
