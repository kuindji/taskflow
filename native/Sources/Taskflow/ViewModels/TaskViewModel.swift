import Foundation
import Observation

/// 1:1 port of `packages/ui/src/stores/task-store.ts`.
///
/// Behavioral notes:
/// - `load()` maps to `fetchTasks` in the TS store (initial fetch + activeTaskId validation).
/// - Mutating actions apply local state updates immediately after the RPC, matching the TS store
///   — `insertCreated`/`upsertUpdated` dedup in WS-event handlers prevents double-application.
/// - `bind()` registers the three module-level WS subscriptions from the TS file:
///   `task:updated` → upsertUpdated, `task:created` → dedup+sort+append, `task:log-added` → appendLogEntry.
/// - `archiveTask`/`unarchiveTask`/`deleteTask` apply local filter immediately (no WS event for these);
///   `unarchiveTask` fire-and-forgets a `load()` reload, matching `void fetchTasks()` in TS.
@MainActor
@Observable
final class TaskViewModel {
    private(set) var tasks: [TaskItem] = []
    private(set) var archivedTasks: [TaskItem] = []
    var showArchive: Bool = false
    private(set) var activeTaskId: String? = nil
    private(set) var loading: Bool = false
    private(set) var taskLogs: [String: [TaskLogEntry]] = [:]

    @ObservationIgnored private let client: WSClient

    init(client: WSClient) {
        self.client = client
    }

    // MARK: - Load (fetchTasks equivalent)

    /// Fetches the active task list, sorts it, and clears `activeTaskId` if no longer present.
    func load() async {
        loading = true
        defer { loading = false }
        do {
            let resp: TaskListResponse = try await client.request(.taskList, payload: [:])
            let sorted = Self.sortByCreatedAtDesc(resp.tasks)
            tasks = sorted
            if let id = activeTaskId, !sorted.contains(where: { $0.id == id }) {
                activeTaskId = nil
            }
        } catch {}
    }

    // MARK: - Archived tasks

    /// Fetches and stores the archived task list.
    func fetchArchivedTasks() async {
        do {
            let resp: TaskListResponse = try await client.request(.taskListArchived, payload: [:])
            archivedTasks = Self.sortByCreatedAtDesc(resp.tasks)
        } catch {}
    }

    /// Sets `showArchive` and, when turning on, fire-and-forgets a fetch of archived tasks.
    func setShowArchive(_ show: Bool) {
        showArchive = show
        if show {
            Task { [weak self] in await self?.fetchArchivedTasks() }
        }
    }

    // MARK: - Bind (WS event subscriptions)

    /// Registers the three module-level WS event subscriptions from `task-store.ts`.
    /// Call once at composition (from `AppEnvironment.bind()`).
    func bind() {
        // task:updated → applyTaskUpdate (upsert + sort, matching task-store.ts:170-174)
        client.on(.taskUpdated) { [weak self] (t: TaskItem) in
            Task { @MainActor [weak self] in
                guard let self else { return }
                applyTaskUpdate(t)
            }
        }
        // task:created → dedup+sort+append (matches TS guard `!state.tasks.some(t => t.id === task.id)`)
        client.on(.taskCreated) { [weak self] (t: TaskItem) in
            Task { @MainActor [weak self] in
                guard let self else { return }
                tasks = Self.sortByCreatedAtDesc(Self.insertCreated(tasks, t))
            }
        }
        // task:log-added → appendLogEntry
        client.on(.taskLogAdded) { [weak self] (event: TaskLogAddedEvent) in
            Task { @MainActor [weak self] in
                guard let self else { return }
                taskLogs = Self.appendLog(taskLogs, taskId: event.taskId, entry: event.entry)
            }
        }
    }

    // MARK: - Actions

    func setActiveTask(_ id: String?) {
        activeTaskId = id
    }

    /// Creates a new task, inserts it into the sorted list, and returns it.
    /// The WS `task:created` event will also fire but `insertCreated` deduplicates it.
    @discardableResult
    func createTask(
        projectId: String,
        title: String? = nil,
        description: String,
        worktree: Bool? = nil,
        parentId: String? = nil,
        initCommand: String? = nil
    ) async throws -> TaskItem {
        var payload: [String: Any] = [
            "projectId": projectId,
            "description": description
        ]
        if let title { payload["title"] = title }
        if let worktree { payload["worktree"] = worktree }
        if let parentId { payload["parentId"] = parentId }
        if let initCommand { payload["initCommand"] = initCommand }
        let task: TaskItem = try await client.request(.taskCreate, payload: payload)
        tasks = Self.sortByCreatedAtDesc(tasks + [task])
        return task
    }

    /// Applies a task update into the sorted `tasks` list in place.
    /// Called directly (e.g. after HTTP-only updates); the WS `task:updated` event calls `upsertUpdated` via `bind()`.
    func applyTaskUpdate(_ task: TaskItem) {
        tasks = Self.sortByCreatedAtDesc(tasks.map { $0.id == task.id ? task : $0 })
    }

    /// Sends a partial update RPC and re-sorts the updated item into `tasks`.
    /// The WS `task:updated` event will also fire and is idempotent.
    func updateTask(
        id: String,
        title: String? = nil,
        description: String? = nil,
        notes: String? = nil,
        worktree: TaskWorktree? = nil,
        pinned: Bool? = nil
    ) async throws {
        var payload: [String: Any] = ["id": id]
        if let title { payload["title"] = title }
        if let description { payload["description"] = description }
        if let notes { payload["notes"] = notes }
        if let pinned { payload["pinned"] = pinned }
        if let worktree,
           let data = try? JSONEncoder().encode(worktree),
           let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            payload["worktree"] = dict
        }
        let updated: TaskItem = try await client.request(.taskUpdate, payload: payload)
        tasks = Self.sortByCreatedAtDesc(tasks.map { $0.id == id ? updated : $0 })
    }

    /// Archives a task and its children, clears `activeTaskId` if affected, and optionally refreshes the archived list.
    func archiveTask(id: String) async throws {
        _ = try await client.requestRaw(.taskArchive, payload: ["id": id])
        let wasActive = activeTaskId == id ||
            tasks.contains(where: { $0.parentId == id && $0.id == activeTaskId })
        tasks = tasks.filter { $0.id != id && $0.parentId != id }
        if wasActive { activeTaskId = nil }
        if showArchive {
            Task { [weak self] in await self?.fetchArchivedTasks() }
        }
    }

    /// Unarchives a task/children from `archivedTasks` and fire-and-forgets a reload of active tasks.
    func unarchiveTask(id: String) async throws {
        _ = try await client.requestRaw(.taskUnarchive, payload: ["id": id])
        archivedTasks = archivedTasks.filter { $0.id != id && $0.parentId != id }
        Task { [weak self] in await self?.load() }
    }

    /// Deletes a task and its children from both lists, clears `activeTaskId` if affected.
    func deleteTask(id: String, deleteWorktree: Bool? = nil) async throws {
        var payload: [String: Any] = ["id": id]
        if let deleteWorktree { payload["deleteWorktree"] = deleteWorktree }
        _ = try await client.requestRaw(.taskDelete, payload: payload)
        let wasActive = activeTaskId == id ||
            tasks.contains(where: { $0.parentId == id && $0.id == activeTaskId })
        tasks = tasks.filter { $0.id != id && $0.parentId != id }
        archivedTasks = archivedTasks.filter { $0.id != id && $0.parentId != id }
        if wasActive { activeTaskId = nil }
    }

    /// Fetches the log entries for a task and stores them in `taskLogs[taskId]`.
    func fetchTaskLog(taskId: String) async throws {
        let resp: TaskLogListResponse = try await client.request(.taskLogList, payload: ["taskId": taskId])
        taskLogs[taskId] = resp.entries
    }

    /// Appends a single log entry to `taskLogs[taskId]`.
    func appendLogEntry(taskId: String, entry: TaskLogEntry) {
        taskLogs = Self.appendLog(taskLogs, taskId: taskId, entry: entry)
    }

    // MARK: - Pure Reducers (static, TDD'd)

    /// Replaces `updated` in-place in `tasks` by id; appends if not found.
    static func upsertUpdated(_ tasks: [TaskItem], _ updated: TaskItem) -> [TaskItem] {
        if let i = tasks.firstIndex(where: { $0.id == updated.id }) {
            var copy = tasks; copy[i] = updated; return copy
        }
        return tasks + [updated]
    }

    /// Appends `created` to `tasks` unless a task with the same id already exists.
    static func insertCreated(_ tasks: [TaskItem], _ created: TaskItem) -> [TaskItem] {
        tasks.contains(where: { $0.id == created.id }) ? tasks : tasks + [created]
    }

    /// Appends `entry` to `logs[taskId]`, creating the array if it does not exist.
    static func appendLog(
        _ logs: [String: [TaskLogEntry]],
        taskId: String,
        entry: TaskLogEntry
    ) -> [String: [TaskLogEntry]] {
        var copy = logs
        copy[taskId, default: []].append(entry)
        return copy
    }

    // MARK: - Private sort helper

    /// Mirrors `sortTasksByCreatedAtDesc` from `task-store.ts`:
    /// pinned first, then by `createdAt` ISO-8601 descending, ties broken by `id` ascending.
    private static func sortByCreatedAtDesc(_ tasks: [TaskItem]) -> [TaskItem] {
        let formatter = ISO8601DateFormatter()
        return tasks.sorted { a, b in
            if a.pinned != b.pinned { return a.pinned }
            let aTime = formatter.date(from: a.createdAt)?.timeIntervalSince1970 ?? 0
            let bTime = formatter.date(from: b.createdAt)?.timeIntervalSince1970 ?? 0
            if aTime != bTime { return aTime > bTime }
            return a.id < b.id
        }
    }
}
