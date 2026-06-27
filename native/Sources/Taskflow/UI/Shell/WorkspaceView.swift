import SwiftUI

/// Single workspace host — Phase 3 structural shell (Tasks 10–11).
///
/// Resolves the active workspace key and delegates all layout to `SplitContainer`,
/// which handles the single/split pane decision, ResizeHandle, and cross-pane drop routing.
///
/// Workspace key resolution (mirrors `useActiveWorkspace.ts`):
///   task active    → `task:<id>`
///   project active → `project:<id>`
///   master active  → `master`
///   otherwise      → `master`
struct WorkspaceView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    var body: some View {
        SplitContainer(workspaceKey: activeWorkspaceKey)
        #if DEBUG
        // DEV-ONLY: Seed demo tabs + open split so the workspace is non-empty right after boot.
        // `initial: true` fires immediately if already connected before this view appears.
        .onChange(of: isConnected, initial: true) { _, connected in
            if connected {
                seedDemoWorkspaceIfNeeded()
            }
        }
        #endif
    }

    // MARK: - Active workspace key

    private var activeWorkspaceKey: String {
        if let taskId = env.tasks?.activeTaskId {
            return WorkspaceKey.task(taskId)
        }
        if let projectId = env.ui.activeProjectId {
            return WorkspaceKey.project(projectId)
        }
        return WorkspaceKey.master
    }

    // MARK: - DEV-ONLY demo seeding

    #if DEBUG
    /// `true` once boot completes — the moment `env.session` is guaranteed non-nil.
    private var isConnected: Bool {
        if case .connected = env.status { return true }
        return false
    }

    /// Seeds demo tabs into the master workspace and opens the split.
    /// All operations target local ViewModel state only — no backend round-trip needed,
    /// so no sleep is required.  Idempotent via `isEmpty` guards.
    private func seedDemoWorkspaceIfNeeded() {
        guard let session = env.session else { return }
        let key = WorkspaceKey.master

        // Left pane: claude / shell / editor
        if session.tabs(key).isEmpty {
            session.addTab(key, Tab(id: "demo-claude-1", type: .claude, label: "Claude"))
            session.addTab(key, Tab(id: "demo-shell-1",  type: .shell,  label: "Shell"),  activate: false)
            session.addTab(key, Tab(id: "demo-editor-1", type: .editor, label: "Editor"), activate: false)
        }

        // Open split (idempotent: only toggle if currently closed)
        if env.ui.getSplit(key)?.open != true {
            env.ui.toggleSplit(key)
        }

        // Right pane: codex
        let rightKey = WorkspaceKey.right(key)
        if session.tabs(rightKey).isEmpty {
            session.addTab(rightKey, Tab(id: "demo-codex-right-1", type: .codex, label: "Codex"))
        }

        // Ensure master workspace is visible
        if env.ui.activeProjectId == nil && !env.ui.masterWorkspaceActive {
            env.ui.setMasterWorkspaceActive(true)
        }
    }
    #endif
}
