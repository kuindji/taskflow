import SwiftUI
import Observation

@MainActor
@Observable
final class AppEnvironment {
    enum Status: Equatable { case connecting, connected(port: Int), failed(String) }
    private(set) var status: Status = .connecting
    private(set) var homedir: String?
    @ObservationIgnored let themeStore = ThemeStore()
    @ObservationIgnored let terminalSurfaces = TerminalSurfaceCache()
    @ObservationIgnored private let sidecar: SidecarManager
    @ObservationIgnored private(set) var client: WSClient?

    // UIViewModel needs no client — constructed eagerly so views can bind before boot completes.
    private(set) var ui: UIViewModel = UIViewModel()
    // TaskCreationViewModel needs no client — constructed eagerly as a request seam for toolbar/
    // context-menu actions; the 5F dialog host observes requests and clears them.
    private(set) var taskCreation = TaskCreationViewModel()

    // Client-dependent VMs — nil until compose(client:) is called from boot().
    private(set) var tasks: TaskViewModel?
    private(set) var projects: ProjectViewModel?
    private(set) var session: SessionViewModel?
    private(set) var flows: FlowViewModel?
    private(set) var search: SearchViewModel?
    private(set) var files: FileViewModel?
    private(set) var settings: SettingsViewModel?
    private(set) var notifications: NotificationViewModel?
    private(set) var runMenu: RunMenuViewModel?
    private(set) var diff: DiffViewModel?

    init() {
        let repoRoot = ProcessInfo.processInfo.environment["TASKFLOW_REPO_ROOT"]
            .map(URL.init(fileURLWithPath:))
        sidecar = SidecarManager(resourcesURL: Bundle.main.resourceURL, devRepoRoot: repoRoot)
    }

    // MARK: - Composition (factored out for offline testability)

    /// Constructs all client-dependent VMs, wires every cross-store closure, calls `bind()` once
    /// on each VM that declares one, then assigns the VMs. Called synchronously from `boot()` after
    /// the sidecar client is established. Exposed `internal` so `AppEnvironmentTests` can exercise
    /// the wiring offline with an unconnected `WSClient(url: ws://localhost:1)`.
    func compose(client: WSClient) {
        self.client = client

        let tasksVM         = TaskViewModel(client: client)
        let projectsVM      = ProjectViewModel(client: client)
        let sessionVM       = SessionViewModel(client: client)
        let flowsVM         = FlowViewModel(client: client)
        let searchVM        = SearchViewModel(client: client)
        let filesVM         = FileViewModel(client: client)
        let settingsVM      = SettingsViewModel(client: client)
        let notificationsVM = NotificationViewModel(client: client)
        let diffVM          = DiffViewModel(client: client)

        // ── Cross-store closure wiring ──────────────────────────────────────────────────────
        //
        // projects.onProjectShouldClearActive
        //   TS: `if (useUIStore.getState().activeProjectId === id) setActiveProject(null)`
        //   Called by hideProject, removeProject, and the project:removed WS handler.
        projectsVM.onProjectShouldClearActive = { [weak self] id in
            if id == self?.ui.activeProjectId { self?.ui.setActiveProject(nil) }
        }

        // projects.onProjectCollapseReset
        //   TS: `useUIStore.getState().setProjectCollapsed(id, false)` (removeProject only)
        projectsVM.onProjectCollapseReset = { [weak self] id in
            self?.ui.setProjectCollapsed(id, false)
        }

        // projects.onTasksShouldRefresh
        //   TS: `await useTaskStore.getState().fetchTasks()` (removeProject only)
        projectsVM.onTasksShouldRefresh = { [weak self] in
            Task { @MainActor [weak self] in await self?.tasks?.load() }
        }

        // settings.onLayoutHydrate
        //   TS: `useUIStore.getState().hydrateLayout(settings.layout.panels)` after fetchSettings
        settingsVM.onLayoutHydrate = { [weak self] panels in
            self?.ui.hydrateLayout(panels)
        }

        // flows.onRunFocus
        //   Port of `focusRunningActionTab` from `flow-store.ts`.
        //   Full logic implemented where the VMs support it today.
        //   Phase 4 seam: visual rendering of the focused tab requires AppShell (Task 9+),
        //   but the underlying state mutation (setActiveTab) is performed now.
        flowsVM.onRunFocus = { [weak self] run in
            // Guard 1 (TS line 205): only focus for *running* flows.
            guard run.status == .running, let self else { return }

            // Guard 2 (TS line 206-207): current action must have a sessionId and be running.
            let actionIdx = Int(run.currentActionIndex)
            guard run.actions.indices.contains(actionIdx) else { return }
            let action = run.actions[actionIdx]
            guard let sessionId = action.sessionId, action.status == .running else { return }

            // Determine workspace key — master flows have no focusable workspace (Phase 5 seam).
            let workspaceKey: String
            if let taskId = run.taskId {
                workspaceKey = WorkspaceKey.task(taskId)
            } else if let projectId = run.projectId {
                workspaceKey = WorkspaceKey.project(projectId)
            } else {
                // Phase 5: master-flow action focus is not yet modelled.
                return
            }

            // Guard 3 (TS lines 228-232): workspace-active check.
            //   run.taskId ? activeTaskId === run.taskId
            //              : activeProjectId === run.projectId && !activeTaskId
            let activeTaskId    = self.tasks?.activeTaskId
            let activeProjectId = self.ui.activeProjectId
            let isActive: Bool
            if let taskId = run.taskId {
                isActive = activeTaskId == taskId
            } else if let projectId = run.projectId {
                isActive = activeProjectId == projectId && activeTaskId == nil
            } else {
                isActive = false
            }
            guard isActive else { return }

            // Find the tab for this action's session and make it active (TS lines 234-236).
            // Phase 4: the visual pane that renders the focused tab is built in Task 9+.
            let tabs = self.session?.tabs(workspaceKey) ?? []
            if let tab = tabs.first(where: { $0.sessionId == sessionId }) {
                self.session?.setActiveTab(workspaceKey, tab.id)
            }
        }

        // files.onOpenFile — opens the file as an editor tab in the active workspace.
        filesVM.onOpenFile = { [weak self] path in
            guard let self else { return }
            let activeKey: String
            if let taskId = tasks?.activeTaskId {
                activeKey = WorkspaceKey.task(taskId)
            } else if let projectId = ui.activeProjectId {
                activeKey = WorkspaceKey.project(projectId)
            } else {
                activeKey = WorkspaceKey.master
            }
            let label = URL(fileURLWithPath: path).lastPathComponent
            let tab = Tab(id: "editor:\(path)", type: .editor, label: label, filePath: path)
            session?.addTab(activeKey, tab)
        }

        // diff.onStatsByProjectChanged — refresh the file explorer's git status when diff
        // stats change. Mirrors the useDiffStore.subscribe in file-store.ts:209-220.
        diffVM.onStatsByProjectChanged = { [weak self] in
            self?.files?.refreshGitStatusForWatchedPath()
        }

        // session cross-deps (post create/close refreshes)
        sessionVM.onFetchTasks = { [weak self] in
            await self?.tasks?.load()
        }
        sessionVM.onFetchProjects = { [weak self] in
            await self?.projects?.load()
        }
        // session.onTerminalEvict — evict the libghostty surface when a session ends.
        // SessionViewModel must NOT reference TerminalSurfaceCache directly; this closure
        // is the bridge (mirrors onFetchTasks/onFetchProjects injection pattern).
        sessionVM.onTerminalEvict = { [weak self] sid in
            self?.terminalSurfaces.evict(sid)
        }

        // ── Bind WS event subscriptions — called exactly once per VM ───────────────────────
        tasksVM.bind()
        projectsVM.bind()
        sessionVM.bind()
        flowsVM.bind()
        filesVM.bind()
        notificationsVM.bind()
        diffVM.bind()
        // SettingsViewModel: no WS subscriptions (no bind() method).
        // SearchViewModel:   no WS subscriptions (no bind() method).

        // ── Assign all VMs ────────────────────────────────────────────────────────────────
        self.tasks         = tasksVM
        self.projects      = projectsVM
        self.session       = sessionVM
        self.flows         = flowsVM
        self.search        = searchVM
        self.files         = filesVM
        self.settings      = settingsVM
        self.notifications = notificationsVM
        // RunMenuViewModel: no WS events (no bind()), no boot load (fetch is lazy via ensureLoaded).
        self.runMenu       = RunMenuViewModel(client: client)
        self.diff          = diffVM
    }

    // MARK: - Boot

    func boot() async {
        // Double-boot guard: only proceed from the initial .connecting state. A re-entrant
        // call (e.g. a second `.task`) must not re-create VMs and double-register WS handlers.
        guard case .connecting = status else { return }
        do {
            let client = try await sidecar.start()
            compose(client: client)

            // Parallel initial loads. All VMs are non-nil after compose().
            // Settings load is best-effort: SettingsViewModel.load() logs and swallows decode
            // errors so a malformed persisted JSON cannot abort boot.
            if let t = tasks, let p = projects, let f = flows, let s = settings, let n = notifications {
                async let _t: Void = t.load()
                async let _p: Void = p.load()
                async let _f: Void = f.load()
                async let _s: Void = s.load()
                async let _n: Void = n.load()
                _ = await (_t, _p, _f, _s, _n)
            }

            // After a successful start() the port is always set; the fallback is unreachable
            // in practice. Log if it ever triggers so a future regression is observable, not silent.
            let realPort = sidecar.port ?? {
                NSLog("[AppEnvironment] sidecar.port nil after successful start() — regression?")
                return 0
            }()
            status = .connected(port: realPort)
            if let info: SystemInfo = try? await client.request(.systemInfo, payload: [:]) {
                homedir = info.homedir
            }
        } catch {
            status = .failed("\(error)")
        }
    }

    func shutdown() { sidecar.stop() }
}
