import SwiftUI

/// File explorer panel root. Drives the `FileViewModel` lifecycle from the active working dir and
/// renders the tree. Port of `packages/ui/src/components/panels/FileExplorer.tsx`.
struct FileExplorerPane: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env

    private var files: FileViewModel? { env.files }

    private var workingDir: String? { ActiveWorkspace.workingDir(in: env) }

    /// Mirrors the FileExplorer.tsx `gitFiles` memo (only valid when gitStatusPath == workingDir).
    private var gitFiles: [String: String] {
        guard let wd = workingDir, files?.gitStatusPath == wd else { return [:] }
        return GitStatusColor.gitFilesMap(files?.gitStatus, workingDir: wd)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let wd = workingDir, let files {
                if let tree = files.tree {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(tree.children ?? [], id: \.path) { child in
                                FileTreeRow(node: child, depth: 0, gitFiles: gitFiles, rootPath: wd)
                            }
                        }
                        .padding(4)
                    }
                } else if files.loading {
                    centered("Loading…")
                } else {
                    centered("Empty")
                }
            } else {
                centered("Select a task or project")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.color(.card))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .task(id: workingDir) { await loadWorkingDir() }
        .sheet(isPresented: Binding(
            get: { files?.pendingMove != nil },
            set: { if !$0 { files?.clearPendingMove() } }
        )) {
            if let move = files?.pendingMove { MoveFileDialog(move: move) }
        }
    }

    private func centered(_ text: String) -> some View {
        Text(text).foregroundStyle(theme.foreground.opacity(0.35)).font(.caption)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Mirrors FileExplorer.tsx's effect: on workingDir change, clear + fetch tree + git + watch.
    private func loadWorkingDir() async {
        guard let files else { return }
        guard let wd = workingDir else { files.clearExplorerState(); return }
        files.clearExplorerState()
        await files.fetchTree(path: wd)
        await files.fetchGitStatus(path: wd)
        await files.watchPath(path: wd)
    }
}
