import Foundation
import Observation

/// 1:1 port of `packages/ui/src/stores/project-store.ts`.
///
/// Behavioral notes:
/// - `load()` maps to `fetchProjects` in the TS store (initial fetch).
///   The TS store also conditionally calls `setActiveProject(null)` when the loaded project
///   list no longer contains the active project; that check is omitted here because
///   `ProjectViewModel` does not own the active-project state — wired in Task 8.
/// - `addProject`/`forkProject` append locally after the RPC (WS `project:created` deduplicates).
/// - `updateProject`/`hideProject` apply local upsert immediately after the RPC
///   (WS `project:updated` is also broadcast and handled idempotently).
/// - `removeProject` drops the project locally after the RPC, then reproduces the three TS
///   cross-store effects in order: guarded clear-active, collapse-reset, and a task refresh.
/// - `reorderProjects` applies an optimistic reorder, then confirms with the server.
/// - `bind()` registers the four module-level WS event subscriptions from the TS file.
///
/// Cross-store dependencies are modelled as injected closures (wired in Task 8). Each TS effect
/// maps to a distinct closure, and the AFFECTED project id always flows through so Task 8 can
/// reproduce the TS guards (`if (useUIStore.getState().activeProjectId === id)`):
/// - `onProjectShouldClearActive(id)` → `if id == ui.activeProjectId { ui.setActiveProject(nil) }`
///   (called by `hideProject`, `removeProject`, and the `project:removed` WS handler).
/// - `onProjectCollapseReset(id)` → `ui.setProjectCollapsed(id, false)` (called by `removeProject` only).
/// - `onTasksShouldRefresh()` → `taskVM.load()` (called by `removeProject` only).
@MainActor
@Observable
final class ProjectViewModel {
    private(set) var projects: [Project] = [] {
        didSet { onProjectsChanged?(projects) }
    }

    /// Fired on every mutation of `projects` — the native analogue of the web app's
    /// `useEffect(() => syncWithProjects(projects), [projects])` (useSidebarData.ts).
    /// Wired in `AppEnvironment.compose()` to `SessionViewModel.syncWithProjects`.
    var onProjectsChanged: (([Project]) -> Void)?
    private(set) var loading: Bool = false

    /// Injected: invoked with the AFFECTED project id wherever the TS store guards
    /// `if (useUIStore.getState().activeProjectId === id) useUIStore.getState().setActiveProject(null)`.
    /// Task 8 wires the guard: `if id == ui.activeProjectId { ui.setActiveProject(nil) }`.
    /// Called by `hideProject`, `removeProject`, and the `project:removed` WS handler.
    var onProjectShouldClearActive: ((String) -> Void)?

    /// Injected: mirrors `useUIStore.getState().setProjectCollapsed(id, false)` in TS `removeProject`.
    /// Called by `removeProject` only.
    var onProjectCollapseReset: ((String) -> Void)?

    /// Injected: mirrors `await useTaskStore.getState().fetchTasks()` in TS `removeProject`.
    /// Called by `removeProject` only.
    var onTasksShouldRefresh: (() -> Void)?

    @ObservationIgnored private let client: WSClient

    init(client: WSClient) {
        self.client = client
    }

    // MARK: - Load (fetchProjects equivalent)

    /// Fetches the full project list. Called once by `AppEnvironment.boot()`.
    func load() async {
        loading = true
        defer { loading = false }
        do {
            let resp: ProjectListResponse = try await client.request(.projectList, payload: [:])
            projects = resp.projects
        } catch {}
    }

    // MARK: - Bind (WS event subscriptions)

    /// Registers the four module-level WS event subscriptions from `project-store.ts`.
    /// Call once at composition (from `AppEnvironment.bind()`).
    func bind() {
        // project:created → dedup (matches TS guard `!state.projects.some(p => p.id === project.id)`)
        client.on(.projectCreated) { [weak self] (project: Project) in
            Task { @MainActor [weak self] in
                guard let self else { return }
                projects = Self.applyCreated(projects, project)
            }
        }
        // project:removed → filter out; signal guarded clear-active with the affected id.
        // Matches TS handler: filter, then `if (activeProjectId === id) setActiveProject(null)`.
        // No setProjectCollapsed / fetchTasks here — the TS WS handler does neither.
        client.on(.projectRemoved) { [weak self] (event: ProjectRemovePayload) in
            Task { @MainActor [weak self] in
                guard let self else { return }
                projects = Self.applyRemoved(projects, id: event.id)
                onProjectShouldClearActive?(event.id)
            }
        }
        // project:updated → replace in place
        client.on(.projectUpdated) { [weak self] (project: Project) in
            Task { @MainActor [weak self] in
                guard let self else { return }
                projects = Self.applyUpdated(projects, project)
            }
        }
        // project:reordered → reorder from another window (matches TS `onEvent(MSG.PROJECT_REORDERED, ...)`)
        client.on(.projectReordered) { [weak self] (event: ProjectReorderPayload) in
            Task { @MainActor [weak self] in
                guard let self else { return }
                projects = Self.applyReorder(projects, orderedIds: event.orderedIds)
            }
        }
    }

    // MARK: - Actions

    /// Adds a project by path and appends it locally.
    @discardableResult
    func addProject(path: String) async throws -> Project {
        let project: Project = try await client.request(.projectAdd, payload: ["path": path])
        projects = projects + [project]
        return project
    }

    /// Updates project fields and replaces it in the local list.
    @discardableResult
    func updateProject(
        id: String,
        name: String? = nil,
        path: String? = nil,
        hidden: Bool? = nil,
        defaultInitCommand: String? = nil,
        prompt: String? = nil,
        linkedProjects: [LinkedProject]? = nil
    ) async throws -> Project {
        var payload: [String: Any] = ["id": id]
        if let name { payload["name"] = name }
        if let path { payload["path"] = path }
        if let hidden { payload["hidden"] = hidden }
        if let defaultInitCommand { payload["defaultInitCommand"] = defaultInitCommand }
        if let prompt { payload["prompt"] = prompt }
        if let linkedProjects,
           let data = try? JSONEncoder().encode(linkedProjects),
           let arr = try? JSONSerialization.jsonObject(with: data) {
            payload["linkedProjects"] = arr
        }
        let project: Project = try await client.request(.projectUpdate, payload: payload)
        projects = Self.applyUpdated(projects, project)
        return project
    }

    /// Sets `hidden: true` on a project; signals the guarded clear-active effect with the id.
    /// TS `hideProject` does NOT call setProjectCollapsed or fetchTasks — neither do we.
    func hideProject(id: String) async throws {
        let project: Project = try await client.request(
            .projectUpdate, payload: ["id": id, "hidden": true]
        )
        projects = Self.applyUpdated(projects, project)
        // TS: if (activeProjectId === id) setActiveProject(null)
        onProjectShouldClearActive?(id)
    }

    /// Removes a project and reproduces the three TS cross-store effects in order.
    func removeProject(id: String) async throws {
        _ = try await client.requestRaw(.projectRemove, payload: ["id": id])
        projects = Self.applyRemoved(projects, id: id)
        // TS order: guarded clear-active, then setProjectCollapsed(id, false), then fetchTasks().
        onProjectShouldClearActive?(id)   // if (activeProjectId === id) setActiveProject(null)
        onProjectCollapseReset?(id)        // setProjectCollapsed(id, false)
        onTasksShouldRefresh?()            // await fetchTasks()
    }

    /// Forks a project into a new worktree branch and appends the new project locally.
    @discardableResult
    func forkProject(
        projectId: String,
        branch: String,
        folderName: String? = nil
    ) async throws -> ProjectForkResponse {
        var payload: [String: Any] = ["projectId": projectId, "branch": branch]
        if let folderName { payload["folderName"] = folderName }
        let response: ProjectForkResponse = try await client.request(.projectFork, payload: payload)
        projects = projects + [response.project]
        return response
    }

    /// Optimistically reorders projects locally, then confirms with the server.
    func reorderProjects(orderedIds: [String]) async throws {
        // Optimistic update first (matches TS pattern)
        projects = Self.applyReorder(projects, orderedIds: orderedIds)
        let resp: ProjectListResponse = try await client.request(
            .projectReorder, payload: ["orderedIds": orderedIds]
        )
        projects = resp.projects
    }

    // MARK: - Pure Reducers (static, TDD'd)

    /// Reorders `projects` so items whose id appears in `orderedIds` come first (in that order);
    /// remaining projects append in their original relative order. Unknown ids are ignored.
    /// Mirrors `orderProjectsByIds` from `packages/shared/src/utils/project-order.ts`.
    static func applyReorder(_ projects: [Project], orderedIds: [String]) -> [Project] {
        let byId = Dictionary(uniqueKeysWithValues: projects.map { ($0.id, $0) })
        var result: [Project] = []
        var used = Set<String>()
        for id in orderedIds {
            if let p = byId[id], !used.contains(id) {
                result.append(p)
                used.insert(id)
            }
        }
        for p in projects where !used.contains(p.id) {
            result.append(p)
        }
        return result
    }

    /// Replaces the project whose id matches `updated.id`; leaves the list unchanged if not found.
    static func applyUpdated(_ projects: [Project], _ updated: Project) -> [Project] {
        projects.map { $0.id == updated.id ? updated : $0 }
    }

    /// Removes the project with the given id; returns the list unchanged if not found.
    static func applyRemoved(_ projects: [Project], id: String) -> [Project] {
        projects.filter { $0.id != id }
    }

    /// Appends `created` unless a project with the same id already exists (dedup).
    static func applyCreated(_ projects: [Project], _ created: Project) -> [Project] {
        projects.contains(where: { $0.id == created.id }) ? projects : projects + [created]
    }
}
