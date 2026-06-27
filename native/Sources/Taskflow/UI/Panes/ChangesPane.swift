import SwiftUI

/// Pane that lists git-changed files and renders the selected file's unified diff.
///
/// Data source: `git:diff` (`MessageType.gitDiff`) — returns all staged and unstaged
/// files that carry a tracked diff. The backend payload is `{ diff: GitDiffResult }`;
/// codegen only emitted `GitStatusResponse`, so decoding uses the local `GitDiffEnvelope`
/// wrapper that reuses the generated `GitDiffResult` domain type.
///
/// KNOWN LIMITATION: `git:diff` omits untracked / newly-added files that have no prior
/// tracked version and therefore produce no diff output. Such files are absent from this
/// list. A fuller status + untracked integration is planned for Phase 5.
///
/// Staged-vs-unstaged duplicates: if a file has both staged and unstaged changes
/// `git:diff` returns it twice (once with `staged: true`, once with `staged: false`).
/// Both entries are shown in the list with their respective S/U badge so the user can
/// inspect each diff independently.
struct ChangesPane: View {
    let repoPath: String

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    @State private var diffFiles: [GitDiffFile] = []
    @State private var selectedIdx: Int? = nil
    @State private var isLoading = false

    /// Thin transport-only envelope for the `git:diff` response.
    /// Codegen only produced `GitStatusResponse`; no wrapper was generated for `git:diff`.
    /// Using this local struct avoids authoring a new domain type — the payload is
    /// `GitDiffResult`, which is already generated in `GitTypes.swift`.
    private struct GitDiffEnvelope: Decodable, Sendable {
        let diff: GitDiffResult
    }

    var body: some View {
        HStack(spacing: 0) {
            fileList
            Divider().background(theme.border)
            diffPanel
        }
        .task(id: repoPath) { await loadDiff() }
    }

    // MARK: - Subviews

    @ViewBuilder
    private var fileList: some View {
        List(selection: $selectedIdx) {
            ForEach(Array(diffFiles.enumerated()), id: \.offset) { idx, file in
                FileRow(file: file)
                    .tag(idx)
            }
        }
        .frame(width: 240)
    }

    @ViewBuilder
    private var diffPanel: some View {
        if env.client == nil {
            placeholder("Not connected")
        } else if isLoading {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let idx = selectedIdx, diffFiles.indices.contains(idx) {
            DiffView(unifiedDiff: diffFiles[idx].diff)
        } else if diffFiles.isEmpty {
            placeholder("No changes")
        } else {
            placeholder("Select a file to view diff")
        }
    }

    private func placeholder(_ message: String) -> some View {
        Text(message)
            .foregroundStyle(theme.color(.mutedForeground))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Data loading

    private func loadDiff() async {
        guard let client = env.client else { return }
        isLoading = true
        selectedIdx = nil
        defer { isLoading = false }
        do {
            let envelope: GitDiffEnvelope = try await client.request(
                .gitDiff, payload: ["path": repoPath])
            diffFiles = envelope.diff.files
        } catch {
            diffFiles = []
        }
    }
}

// MARK: - FileRow

/// Single-file row: shows the basename, a staged (S) or unstaged (U) badge, and ± line counts.
private struct FileRow: View {
    let file: GitDiffFile
    @Environment(\.appTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text(URL(fileURLWithPath: file.path).lastPathComponent)
                    .font(.system(.body, design: .monospaced))
                    .lineLimit(1)
                AppBadge(text: file.staged ? "S" : "U")
            }
            HStack(spacing: 6) {
                Text("+\(Int(file.additions))")
                    .foregroundStyle(theme.success)
                Text("-\(Int(file.deletions))")
                    .foregroundStyle(theme.destructive)
            }
            .font(.caption)
        }
        .padding(.vertical, 2)
    }
}
