import Foundation
import Observation

/// 1:1 port of `packages/ui/src/stores/session-store.ts` tab/pane state machine,
/// plus helpers from `session-helpers.ts` (normalizeSessionLabel, createSessionTab)
/// and `session-sync.ts` (syncOwnerTabs with reference preservation).
///
/// Behavioral notes:
/// - `tabsByWorkspace` / `activeTabByWorkspace` / `sessionStatus` / `lastTerminalSize`
///   mirror the Zustand store state exactly.
/// - `createSession` / `closeSession` cross-deps (post-create fetchTasks/fetchProjects)
///   are injected closures (`onFetchTasks` / `onFetchProjects`), not direct store refs.
/// - `bind()` registers three WS event handlers: `session:exited` tracks exited sessions;
///   `terminal:output` and `session:status` drive the working/attention status machine
///   via `SessionActivity` (port of `session-activity.ts`).
/// - `syncWithTasks` / `syncWithProjects` port `syncOwnerTabs` with Equatable guard:
///   dictionaries are only reassigned when the content actually changed, avoiding
///   needless view invalidation (the `@Observable` equivalent of TS reference preservation).
@MainActor
@Observable
final class SessionViewModel {

    // MARK: - State

    private(set) var tabsByWorkspace: [String: [Tab]] = [:]
    private(set) var activeTabByWorkspace: [String: String] = [:]
    private(set) var sessionStatus: [String: SessionStatus] = [:]

    struct TerminalSize: Equatable {
        var cols: Int
        var rows: Int
    }
    private(set) var lastTerminalSize: TerminalSize?

    // MARK: - Private

    @ObservationIgnored private let client: WSClient
    @ObservationIgnored private var exitedSessionIds = Set<String>()
    @ObservationIgnored private let activity = SessionActivity()
    /// Owner IDs with an in-flight createSession call targeting a non-default workspace key.
    /// While pending, syncWithTasks/syncWithProjects must not auto-place sessions for that owner.
    @ObservationIgnored private var pendingSessionCreates = Set<String>()

    // MARK: - Injected cross-deps

    /// Called (fire-and-forget) after createSession/closeSession to refresh the task list.
    var onFetchTasks: (() async -> Void)?
    /// Called (fire-and-forget) after createSession/closeSession to refresh the project list.
    var onFetchProjects: (() async -> Void)?
    /// Called when a terminal session ends (either via session:exited or closeSession) so the
    /// surface cache can release the libghostty surface and bridge.  Mirrors the
    /// onFetchTasks/onFetchProjects injection pattern — SessionViewModel must NOT reference
    /// TerminalSurfaceCache directly.
    var onTerminalEvict: ((String) -> Void)?

    init(client: WSClient) {
        self.client = client
    }

    // MARK: - Bind

    func bind() {
        client.on(.sessionExited) { [weak self] (event: SessionExitedEvent) in
            Task { @MainActor [weak self] in
                guard let self else { return }
                exitedSessionIds.insert(event.sessionId)
                activity.clearTimer(event.sessionId)
                activity.clearInteraction(event.sessionId)
                sessionStatus.removeValue(forKey: event.sessionId)
                onTerminalEvict?(event.sessionId)
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
                        // Phase 5 seam: port `settleInactiveSession` (session-activity.ts) to
                        // settle to nil when the session is focused, .attention otherwise.
                        // No window/tab-focus tracking exists yet, so always settle to .attention.
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
                        // Phase 5 seam: focus-aware `settleInactiveSession` (session-activity.ts) —
                        // settle to nil when focused, .attention otherwise. No focus tracking yet.
                        self?.setSessionStatus(sessionId: event.sessionId, status: .attention)
                    }
                } else {
                    activity.clearTimer(event.sessionId)
                }
            }
        }
    }

    /// Port of `usesTerminalActivityStatus` from `session-helpers.ts` (lines 119–132).
    /// Returns true for AI agent tab types that drive working/attention status via terminal output.
    private func usesActivityStatus(_ sessionId: String) -> Bool {
        let type = tabsByWorkspace.values.lazy
            .flatMap { $0 }
            .first { $0.sessionId == sessionId }?
            .type
        switch type {
        case .claude, .codex, .opencode, .gemini, .cursor, .pi:
            return true
        default:
            return false
        }
    }

    // MARK: - isSessionExited

    func isSessionExited(_ sessionId: String) -> Bool {
        exitedSessionIds.contains(sessionId)
    }

    // MARK: - Session lifecycle (createSession / closeSession / sendInput / resizeTerminal)

    @discardableResult
    func createSession(
        taskId: String? = nil,
        projectId: String? = nil,
        master: Bool = false,
        type: TabType,
        label: String? = nil,
        cwd: String? = nil,
        targetWorkspaceKey: String? = nil,
        agentOptions: AgentLaunchOptions? = nil
    ) async throws -> String {
        guard taskId != nil || projectId != nil || master else {
            throw NSError(
                domain: "SessionViewModel", code: 1,
                userInfo: [NSLocalizedDescriptionKey:
                    "Either taskId, projectId, or master is required"]
            )
        }

        let ownerId = taskId ?? projectId
        let pendingKey = ownerId ?? (master ? "master" : nil)
        if targetWorkspaceKey != nil, let key = pendingKey {
            pendingSessionCreates.insert(key)
        }

        var payload: [String: Any] = ["type": type.rawValue]
        if let taskId { payload["taskId"] = taskId }
        if let projectId { payload["projectId"] = projectId }
        if master { payload["master"] = true }
        if let label { payload["label"] = label }
        if let cwd { payload["cwd"] = cwd }
        if let size = lastTerminalSize {
            payload["cols"] = size.cols
            payload["rows"] = size.rows
        }
        if let agentOptions,
           let data = try? JSONEncoder().encode(agentOptions),
           let obj = try? JSONSerialization.jsonObject(with: data) {
            payload["agentOptions"] = obj
        }

        let resp: SessionCreateResponse = try await client.request(.sessionCreate, payload: payload)
        let sessionId = resp.sessionId

        let normalizedLabel = Self.normalizeSessionLabel(type: type, label: label)
        var newTab = Tab(id: sessionId, type: type, label: normalizedLabel, sessionId: sessionId)
        if type == .shell { newTab.autoTitle = true }

        let workspaceKey: String
        if let targetKey = targetWorkspaceKey {
            workspaceKey = targetKey
        } else if let taskId {
            workspaceKey = WorkspaceKey.task(taskId)
        } else if let ownerId {
            workspaceKey = WorkspaceKey.project(ownerId)
        } else {
            workspaceKey = WorkspaceKey.master
        }

        addTab(workspaceKey, newTab)
        if let key = pendingKey { pendingSessionCreates.remove(key) }

        if taskId != nil, let fetch = onFetchTasks {
            Task { await fetch() }
        }
        if projectId != nil, let fetch = onFetchProjects {
            Task { await fetch() }
        }

        return sessionId
    }

    func closeSession(sessionId: String) async throws {
        // Evict the surface cache entry BEFORE the async RPC so the surface is always
        // released — even when requestRaw throws (e.g. session already gone server-side).
        onTerminalEvict?(sessionId)
        _ = try await client.requestRaw(.sessionClose, payload: ["sessionId": sessionId])
        if let fetch = onFetchTasks { Task { await fetch() } }
        if let fetch = onFetchProjects { Task { await fetch() } }
    }

    func sendInput(sessionId: String, data: String) {
        activity.markInteraction(sessionId)
        client.send(.sessionInput, payload: ["sessionId": sessionId, "data": data])
    }

    /// Test seam: exposes SessionActivity.isInteracting without making `activity` internal-visible.
    /// For use in SessionViewModelTests only — not part of the production API.
    func isInteractingTestSeam(_ sessionId: String) -> Bool {
        activity.isInteracting(sessionId)
    }

    func resizeTerminal(sessionId: String, cols: Int, rows: Int) {
        activity.markInteraction(sessionId)
        lastTerminalSize = TerminalSize(cols: cols, rows: rows)
        client.send(.terminalResize, payload: ["sessionId": sessionId, "cols": cols, "rows": rows])
    }

    // MARK: - Tab mutations

    func addTab(_ key: String, _ tab: Tab, activate: Bool = true) {
        let existing = tabsByWorkspace[key] ?? []

        // Prevent duplicate tabs for the same session
        if let sessionId = tab.sessionId,
           let existingTab = existing.first(where: { $0.sessionId == sessionId }) {
            // Always activate the existing tab on duplicate (mirrors TS behavior)
            activeTabByWorkspace[key] = existingTab.id
            return
        }

        // Same-id tab already present (e.g. reopening the same file's editor tab, which has
        // no sessionId): focus it, don't duplicate. Session tabs have id == sessionId, so this
        // guard is consistent with — and never conflicts with — the sessionId dedup above.
        if let existingTab = existing.first(where: { $0.id == tab.id }) {
            if activate { activeTabByWorkspace[key] = existingTab.id }
            return
        }

        tabsByWorkspace[key] = existing + [tab]

        // Remove duplicate from sibling pane
        if let sessionId = tab.sessionId {
            let siblingKey = key.hasSuffix(":right")
                ? String(key.dropLast(":right".count))
                : "\(key):right"
            if let siblingTabs = tabsByWorkspace[siblingKey],
               siblingTabs.contains(where: { $0.sessionId == sessionId }) {
                tabsByWorkspace[siblingKey] = siblingTabs.filter { $0.sessionId != sessionId }
            }
        }

        if activate {
            activeTabByWorkspace[key] = tab.id
        }
    }

    func closeTab(_ key: String, _ tabId: String) async {
        let currentTabs = tabsByWorkspace[key] ?? []
        guard let tab = currentTabs.first(where: { $0.id == tabId }) else { return }

        do {
            if let sessionId = tab.sessionId {
                exitedSessionIds.remove(sessionId)
                try await closeSession(sessionId: sessionId)
            }
        } catch {}

        // Re-read state (closeSession is async; state may have changed)
        let tabs = (tabsByWorkspace[key] ?? []).filter { $0.id != tabId }
        let currentActive = activeTabByWorkspace[key]
        let newActiveId = currentActive == tabId
            ? (tabs.last?.id ?? "")
            : currentActive ?? ""

        tabsByWorkspace[key] = tabs
        activeTabByWorkspace[key] = newActiveId

        if let sessionId = tab.sessionId {
            sessionStatus.removeValue(forKey: sessionId)
        }
    }

    func setActiveTab(_ key: String, _ tabId: String) {
        activeTabByWorkspace[key] = tabId

        // Clear 'attention' status when the user switches to that tab (mirrors TS setActiveTab)
        let currentTabs = tabsByWorkspace[key] ?? []
        if let newTab = currentTabs.first(where: { $0.id == tabId }),
           let sessionId = newTab.sessionId,
           sessionStatus[sessionId] == .attention {
            sessionStatus.removeValue(forKey: sessionId)
        }
    }

    func setSessionStatus(sessionId: String, status: SessionStatus?) {
        if let status {
            sessionStatus[sessionId] = status
        } else {
            sessionStatus.removeValue(forKey: sessionId)
        }
    }

    func getTaskStatus(taskId: String) -> SessionStatus? {
        let key = WorkspaceKey.task(taskId)
        let tabs = tabsByWorkspace[key] ?? []
        var hasAttention = false
        var hasInitializing = false
        for tab in tabs {
            guard let sessionId = tab.sessionId,
                  let s = sessionStatus[sessionId] else { continue }
            if s == .working { return .working }
            if s == .attention { hasAttention = true }
            if s == .initializing { hasInitializing = true }
        }
        if hasAttention { return .attention }
        if hasInitializing { return .initializing }
        return nil
    }

    func renameTab(_ key: String, _ tabId: String, newLabel: String) {
        let existing = tabsByWorkspace[key] ?? []
        guard let tab = existing.first(where: { $0.id == tabId }) else { return }

        let labelChanged = tab.label != newLabel
        let autoTitleChanged = tab.autoTitle != false

        guard labelChanged || autoTitleChanged else { return }

        tabsByWorkspace[key] = existing.map { t in
            guard t.id == tabId else { return t }
            var updated = t
            updated.label = newLabel
            updated.autoTitle = false
            return updated
        }

        if labelChanged, let sessionId = tab.sessionId {
            client.send(.sessionRename, payload: ["sessionId": sessionId, "label": newLabel])
        }
    }

    func reorderTabs(_ key: String, activeId: String, overId: String) {
        guard let existing = tabsByWorkspace[key] else { return }
        tabsByWorkspace[key] = Self.reorder(existing, activeId: activeId, overId: overId)
    }

    func updateAutoTitle(_ key: String, tabId: String, title: String) {
        let existing = tabsByWorkspace[key] ?? []
        guard let tab = existing.first(where: { $0.id == tabId }) else { return }
        guard tab.type == .shell, tab.autoTitle != false, tab.label != title else { return }

        tabsByWorkspace[key] = existing.map { t in
            guard t.id == tabId else { return t }
            var updated = t
            updated.label = title
            updated.autoTitle = true
            return updated
        }
    }

    // MARK: - Queries

    func tabs(_ key: String) -> [Tab] {
        tabsByWorkspace[key] ?? []
    }

    func activeTab(_ key: String) -> Tab? {
        let t = tabs(key)
        guard let activeId = activeTabByWorkspace[key] else { return nil }
        return t.first { $0.id == activeId }
    }

    // MARK: - Merge / move

    func mergeSplitTabs(_ key: String) {
        let rightKey = WorkspaceKey.right(key)
        let rightTabs = tabsByWorkspace[rightKey] ?? []

        tabsByWorkspace.removeValue(forKey: rightKey)
        activeTabByWorkspace.removeValue(forKey: rightKey)

        guard !rightTabs.isEmpty else { return }

        let baseTabs = tabsByWorkspace[key] ?? []
        tabsByWorkspace[key] = baseTabs + rightTabs
    }

    func moveTabToPane(source: String, target: String, tabId: String, insertIndex: Int? = nil) {
        let sourceTabs = tabsByWorkspace[source] ?? []
        let targetTabs = tabsByWorkspace[target] ?? []
        let sourceActive = activeTabByWorkspace[source]

        guard let result = Self.move(
            source: sourceTabs, target: targetTabs,
            tabId: tabId, insertIndex: insertIndex,
            sourceActive: sourceActive
        ) else { return }

        tabsByWorkspace[source] = result.source
        tabsByWorkspace[target] = result.target
        activeTabByWorkspace[source] = result.sourceActive ?? ""
        activeTabByWorkspace[target] = result.targetActive
    }

    // MARK: - Sync with tasks / projects / master sessions

    func syncWithTasks(_ tasks: [TaskItem]) {
        let owners = tasks.map { SyncOwner(id: $0.id, sessions: $0.sessions) }
        let (nextTabs, nextActive) = computeSyncOwnerTabs(
            owners: owners,
            keyPrefix: "task:",
            getWorkspaceKey: { WorkspaceKey.task($0) }
        )
        if nextTabs != tabsByWorkspace { tabsByWorkspace = nextTabs }
        if nextActive != activeTabByWorkspace { activeTabByWorkspace = nextActive }
    }

    func syncWithProjects(_ projects: [Project]) {
        let owners = projects.map { SyncOwner(id: $0.id, sessions: $0.sessions) }
        let (nextTabs, nextActive) = computeSyncOwnerTabs(
            owners: owners,
            keyPrefix: "project:",
            getWorkspaceKey: { WorkspaceKey.project($0) }
        )
        if nextTabs != tabsByWorkspace { tabsByWorkspace = nextTabs }
        if nextActive != activeTabByWorkspace { activeTabByWorkspace = nextActive }
    }

    /// Direct port of `syncWithMasterSessions` from `session-store.ts`.
    func syncWithMasterSessions(_ sessions: [SessionRef]) {
        let workspaceKey = WorkspaceKey.master
        let rightKey = WorkspaceKey.right(workspaceKey)
        let sessionsById = Dictionary(uniqueKeysWithValues: sessions.map { ($0.id, $0) })

        // Right-pane: filter by session existence only, no new sessions added
        let existingRightTabs = tabsByWorkspace[rightKey] ?? []
        let rightTabs = syncedPaneTabs(existingRightTabs, sessionsById: sessionsById)

        // Base-pane: filter + add new sessions if not already placed
        let existingTabs = tabsByWorkspace[workspaceKey] ?? []
        var updatedTabs = syncedPaneTabs(existingTabs, sessionsById: sessionsById)

        if !pendingSessionCreates.contains(WorkspaceKey.master) {
            for session in sessions {
                let inBase = updatedTabs.contains { $0.sessionId == session.id }
                let inRight = rightTabs.contains { $0.sessionId == session.id }
                if !inBase && !inRight {
                    updatedTabs.append(Self.createSessionTab(session))
                }
            }
        }

        // Rebuild from scratch, removing stale keys
        var nextTabs = tabsByWorkspace
        var nextActive = activeTabByWorkspace
        nextTabs.removeValue(forKey: workspaceKey)
        nextTabs.removeValue(forKey: rightKey)
        nextActive.removeValue(forKey: workspaceKey)
        nextActive.removeValue(forKey: rightKey)

        if !rightTabs.isEmpty {
            nextTabs[rightKey] = rightTabs
            let currentRightActiveId = activeTabByWorkspace[rightKey]
            nextActive[rightKey] = rightTabs.contains(where: { $0.id == currentRightActiveId })
                ? currentRightActiveId!
                : rightTabs[0].id
        }

        if !updatedTabs.isEmpty {
            nextTabs[workspaceKey] = updatedTabs
            let currentActiveId = activeTabByWorkspace[workspaceKey]
            nextActive[workspaceKey] = updatedTabs.contains(where: { $0.id == currentActiveId })
                ? currentActiveId!
                : updatedTabs[0].id
        }

        if nextTabs != tabsByWorkspace { tabsByWorkspace = nextTabs }
        if nextActive != activeTabByWorkspace { activeTabByWorkspace = nextActive }
    }

    // MARK: - Pure Reducers (static, TDD'd)

    /// Port of `@dnd-kit/sortable` `arrayMove`: removes element at `from`, inserts at `to`
    /// in the resulting (shorter) array. Matches TS: `arrayMove(arr, from, to)`.
    static func arrayMove<T>(_ a: [T], _ from: Int, _ to: Int) -> [T] {
        guard from != to, a.indices.contains(from) else { return a }
        var result = a
        let element = result.remove(at: from)
        let dest = to < 0 ? max(0, result.count + to) : min(to, result.count)
        result.insert(element, at: dest)
        return result
    }

    /// Port of `reorderTabs` reducer (`session-store.ts:296-309`): finds `activeId` and `overId`
    /// in `tabs` by id and delegates to `arrayMove`. No-op if either id is missing.
    static func reorder(_ tabs: [Tab], activeId: String, overId: String) -> [Tab] {
        guard let oldIndex = tabs.firstIndex(where: { $0.id == activeId }),
              let newIndex = tabs.firstIndex(where: { $0.id == overId }) else { return tabs }
        return arrayMove(tabs, oldIndex, newIndex)
    }

    struct MoveResult: Equatable {
        var source: [Tab]
        var target: [Tab]
        /// Active tab id for the source pane after the move.
        /// `nil` when the source pane becomes empty (TS uses `""` as sentinel; Swift uses `nil`).
        var sourceActive: String?
        /// Active tab id for the target pane after the move (always the moved tab).
        var targetActive: String
    }

    /// Port of `moveTabToPane` reducer logic (`session-store.ts:360-392`).
    ///
    /// Source-active reselection rule (TS lines 373-377):
    ///   When the moved tab WAS the source's active tab, pick the last survivor
    ///   (`newSourceTabs[newSourceTabs.length - 1]?.id ?? ""`).
    ///   Swift maps the `""` empty-pane sentinel to `nil` in `sourceActive`.
    ///   When the moved tab was NOT active, the source active is unchanged.
    ///
    /// Returns `nil` if `tabId` is not found in `source`.
    static func move(
        source: [Tab],
        target: [Tab],
        tabId: String,
        insertIndex: Int?,
        sourceActive: String?
    ) -> MoveResult? {
        guard let tab = source.first(where: { $0.id == tabId }) else { return nil }

        let newSource = source.filter { $0.id != tabId }

        let newTarget: [Tab]
        if let idx = insertIndex {
            let safeIdx = min(max(idx, 0), target.count)
            newTarget = Array(target[..<safeIdx]) + [tab] + Array(target[safeIdx...])
        } else {
            newTarget = target + [tab]
        }

        // Replicate TS lines 373-377 exactly:
        //   currentSourceActive === tabId
        //       ? (newSourceTabs[newSourceTabs.length - 1]?.id ?? "")
        //       : currentSourceActive
        // Swift maps the "" empty sentinel to nil via Optional chaining.
        let newSourceActive: String?
        if sourceActive == tabId {
            newSourceActive = newSource.last?.id  // nil when source is now empty
        } else {
            newSourceActive = sourceActive
        }

        return MoveResult(
            source: newSource,
            target: newTarget,
            sourceActive: newSourceActive,
            targetActive: tab.id
        )
    }

    // MARK: - Private helpers

    private struct SyncOwner {
        let id: String
        let sessions: [SessionRef]
    }

    /// Port of `syncPaneTabs` from `session-sync.ts`.
    /// Filters dead sessions and refreshes type/label from live session data.
    /// Returns `existing` unchanged when no tab was added, removed, or modified.
    private func syncedPaneTabs(_ existing: [Tab], sessionsById: [String: SessionRef]) -> [Tab] {
        var changed = false
        var next: [Tab] = []
        for tab in existing {
            guard let sessionId = tab.sessionId else {
                next.append(tab); continue
            }
            guard let session = sessionsById[sessionId] else {
                changed = true; continue  // dead session — remove
            }
            let tabType = TabType(rawValue: session.type) ?? .shell
            let label = tab.autoTitle != true
                ? Self.normalizeSessionLabel(type: tabType, label: session.label)
                : tab.label
            if tab.type == tabType && tab.label == label {
                next.append(tab)
            } else {
                changed = true
                var updated = tab
                updated.type = tabType
                if tab.autoTitle != true { updated.label = label }
                next.append(updated)
            }
        }
        return changed ? next : existing
    }

    /// Port of `syncOwnerTabs` from `session-sync.ts`.
    /// Rebuilds workspace tab maps for all owners under `keyPrefix`.
    /// Returns the original dictionaries (by value equality) when unchanged.
    private func computeSyncOwnerTabs(
        owners: [SyncOwner],
        keyPrefix: String,
        getWorkspaceKey: (String) -> String
    ) -> ([String: [Tab]], [String: String]) {
        // Start by copying all non-prefix entries
        var nextTabs: [String: [Tab]] = [:]
        for (key, value) in tabsByWorkspace where !key.hasPrefix(keyPrefix) {
            nextTabs[key] = value
        }
        var nextActive: [String: String] = [:]
        for (key, value) in activeTabByWorkspace where !key.hasPrefix(keyPrefix) {
            nextActive[key] = value
        }

        for owner in owners {
            let workspaceKey = getWorkspaceKey(owner.id)
            let rightKey = WorkspaceKey.right(workspaceKey)
            let sessionsById = Dictionary(uniqueKeysWithValues: owner.sessions.map { ($0.id, $0) })

            // Right-pane: filter only, no new sessions added
            let rightTabs = syncedPaneTabs(tabsByWorkspace[rightKey] ?? [], sessionsById: sessionsById)
            if !rightTabs.isEmpty {
                nextTabs[rightKey] = rightTabs
                if let currentId = activeTabByWorkspace[rightKey],
                   rightTabs.contains(where: { $0.id == currentId }) {
                    nextActive[rightKey] = currentId
                } else {
                    nextActive[rightKey] = rightTabs[0].id
                }
            }

            // Base-pane: filter + add new sessions if not already placed
            var baseTabs = syncedPaneTabs(tabsByWorkspace[workspaceKey] ?? [], sessionsById: sessionsById)
            if !pendingSessionCreates.contains(owner.id) {
                var additions: [Tab] = []
                for session in owner.sessions {
                    let inBase = baseTabs.contains { $0.sessionId == session.id }
                    let inRight = rightTabs.contains { $0.sessionId == session.id }
                    let added = additions.contains { $0.sessionId == session.id }
                    if !inBase && !inRight && !added {
                        additions.append(Self.createSessionTab(session))
                    }
                }
                if !additions.isEmpty { baseTabs = baseTabs + additions }
            }

            guard !baseTabs.isEmpty else { continue }

            nextTabs[workspaceKey] = baseTabs
            if let currentId = activeTabByWorkspace[workspaceKey],
               baseTabs.contains(where: { $0.id == currentId }) {
                nextActive[workspaceKey] = currentId
            } else {
                nextActive[workspaceKey] = baseTabs[0].id
            }
        }

        return (nextTabs, nextActive)
    }

    // MARK: - Static helpers (ported from session-helpers.ts)

    static func defaultSessionLabel(type: TabType) -> String {
        switch type {
        case .claude: return "Claude"
        case .codex: return "Codex"
        case .opencode: return "OpenCode"
        case .gemini: return "Gemini"
        case .cursor: return "Cursor"
        case .pi: return "Pi"
        case .editor: return "Editor"
        case .shell, .changes, .browser, .markdown: return "\(type.rawValue) session"
        }
    }

    /// Port of `normalizeSessionLabel` from `session-helpers.ts`.
    static func normalizeSessionLabel(type: TabType, label: String?) -> String {
        let def = defaultSessionLabel(type: type)
        guard let label, !label.isEmpty else { return def }
        if label == "\(type.rawValue) session" { return def }
        if type == .editor && label == "Editor" { return def }
        return label
    }

    /// Port of `createSessionTab` from `session-helpers.ts`.
    static func createSessionTab(_ session: SessionRef) -> Tab {
        let type = TabType(rawValue: session.type) ?? .shell
        let label = normalizeSessionLabel(type: type, label: session.label)
        var tab = Tab(id: session.id, type: type, label: label, sessionId: session.id)
        if type == .shell { tab.autoTitle = true }
        if session.trayExclude == true { tab.trayExclude = true }
        return tab
    }
}
