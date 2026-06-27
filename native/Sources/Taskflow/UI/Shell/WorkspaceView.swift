import SwiftUI

/// Single-pane workspace container — Phase 3 structural shell (Tasks 10–11).
///
/// Layout: `VStack { TabBar; Divider; PanePlaceholder }`.
/// Real split/tab content (SplitContainer, terminal panes) is implemented in Tasks 11 and Phase 4.
///
/// Workspace key resolution (mirrors `useActiveWorkspace.ts`):
///   task active   → `task:<id>`
///   project active → `project:<id>`
///   master active  → `master`
///   otherwise      → `master` (production would show an empty shell; here we always resolve to
///                               a key so the tab bar stays non-empty in dev.)
struct WorkspaceView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    var body: some View {
        let activeKey = activeWorkspaceKey
        VStack(spacing: 0) {
            TabBar(workspaceKey: activeKey)
            Divider()
                .background(theme.border)
            PanePlaceholder(for: env.session?.activeTab(activeKey))
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
        #if DEBUG
        // DEV-ONLY: Seed a small set of demo tabs so the tab bar is non-empty for
        // visual verification immediately after launch, without needing a live backend session.
        // The guard inside is idempotent; real sessions from syncWithTasks/Projects overwrite
        // only their own "task:" / "project:" prefixed keys, leaving master alone.
        //
        // `initial: true` (macOS 14+, matches our deployment floor) fires the closure with
        // the current value on first render — so if boot already completed before this view
        // appeared, seeding still happens immediately.
        .onChange(of: isConnected, initial: true) { _, connected in
            if connected {
                seedDemoTabsIfNeeded(key: activeWorkspaceKey)
            }
        }
        // Re-seed when workspace key changes (e.g. user activates a project in sidebar)
        // after boot has already completed.
        .onChange(of: activeKey) { _, key in
            if isConnected {
                seedDemoTabsIfNeeded(key: key)
            }
        }
        #endif
    }

    // MARK: - Active workspace key

    /// `true` once boot completes — the only moment `env.session` is guaranteed non-nil.
    private var isConnected: Bool {
        if case .connected = env.status { return true }
        return false
    }

    private var activeWorkspaceKey: String {
        if let taskId = env.tasks?.activeTaskId {
            return WorkspaceKey.task(taskId)
        }
        if let projectId = env.ui.activeProjectId {
            return WorkspaceKey.project(projectId)
        }
        // Master is always a valid workspace — fall through to it when nothing else is active.
        return WorkspaceKey.master
    }

    // MARK: - DEV-ONLY demo seeding

    #if DEBUG
    /// Seeds three representative demo tabs (claude / shell / editor) into `key` when the
    /// workspace has no tabs yet. Activates the master workspace if nothing is currently active.
    ///
    /// **Production safety:** compiled out entirely in release builds via `#if DEBUG`.
    private func seedDemoTabsIfNeeded(key: String) {
        guard let session = env.session,
              session.tabs(key).isEmpty else { return }

        session.addTab(key, Tab(id: "demo-claude-1", type: .claude, label: "Claude"))
        session.addTab(key, Tab(id: "demo-shell-1",  type: .shell,  label: "Shell"),  activate: false)
        session.addTab(key, Tab(id: "demo-editor-1", type: .editor, label: "Editor"), activate: false)

        // Ensure the master workspace is visible when nothing else is focused.
        if key == WorkspaceKey.master,
           env.tasks?.activeTaskId == nil,
           env.ui.activeProjectId == nil,
           !env.ui.masterWorkspaceActive {
            env.ui.setMasterWorkspaceActive(true)
        }
    }
    #endif
}
