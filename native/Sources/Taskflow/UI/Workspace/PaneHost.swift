import SwiftUI

/// Routes the active tab to the appropriate pane view — Phase 4 integration gate.
///
/// Replaces `PanePlaceholder` as the pane body in `SplitContainer`.
/// Terminal-family tabs need `sessionId`; editor/markdown need `filePath`;
/// browser needs `url`; changes needs the workspace repo path (derived from `workspaceKey`).
struct PaneHost: View {
    let activeTab: Tab?
    let workspaceKey: String

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    var body: some View {
        Group {
            switch activeTab?.type {
            case .claude, .codex, .opencode, .gemini, .cursor, .pi, .shell:
                if let sid = activeTab?.sessionId {
                    TerminalPane(sessionId: sid, workspaceKey: workspaceKey)
                        .id("\(sid):\(env.themeStore.current.id)")
                } else { empty }
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
        Text("No content")
            .font(.caption2)
            .foregroundStyle(theme.foreground.opacity(0.2))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(theme.color(.card))
    }

    /// Resolves the repo/worktree path for the workspace used by `.changes` tabs.
    ///
    /// - Strips any `:right` suffix via `WorkspaceKey.base`.
    /// - `task:<id>` → task's worktree path, falling back to the owning project's path.
    /// - `project:<id>` → project's path.
    /// - `master` → nil (no repo).
    private var repoPath: String? {
        let base = WorkspaceKey.base(workspaceKey)

        if base.hasPrefix("task:") {
            let taskId = String(base.dropFirst("task:".count))
            guard let task = env.tasks?.tasks.first(where: { $0.id == taskId }) else { return nil }
            if let p = task.worktree.path { return p }
            return env.projects?.projects.first(where: { $0.id == task.projectId })?.path
        }

        if base.hasPrefix("project:") {
            let projectId = String(base.dropFirst("project:".count))
            return env.projects?.projects.first(where: { $0.id == projectId })?.path
        }

        return nil // master
    }
}
