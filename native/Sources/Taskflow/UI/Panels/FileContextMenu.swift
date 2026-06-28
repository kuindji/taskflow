import SwiftUI
import AppKit

/// Context-menu items for a file/dir row. Port of `panels/FileContextMenu.tsx`.
/// Dialog-requiring items set the bound `action`; the rest act directly.
struct FileContextMenu: View {
    @Environment(AppEnvironment.self) private var env
    let node: FileNode
    let rootPath: String
    @Binding var action: FileRowAction?

    private var files: FileViewModel? { env.files }
    private var isDir: Bool { node.type == "directory" }

    var body: some View {
        Group {
            if isDir {
                Button("New File") { action = .createFile(parentDir: node.path) }
                Button("New Folder") { action = .createFolder(parentDir: node.path) }
                Divider()
            }
            Button("Rename") { action = .rename(path: node.path) }
            Button("Delete", role: .destructive) { action = .delete(path: node.path, isDir: isDir) }
            Divider()
            Button("Copy Path") { copy(node.path) }
            Button("Copy Relative Path") { copy(relativePath) }
            if !isDir {
                Button("Open in External Editor") {
                    Task { try? await files?.openExternal(path: node.path) }
                }
            }
            Button("Reveal in Finder") { Task { try? await files?.revealInFinder(path: node.path) } }
            Button("Open in Terminal") { openInTerminal() }
        }
    }

    private var relativePath: String {
        let prefix = rootPath + "/"
        return node.path.hasPrefix(prefix) ? String(node.path.dropFirst(prefix.count)) : node.path
    }

    private func copy(_ s: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
    }

    /// Opens a shell session whose cwd is the target dir (the file's parent, or the dir itself).
    /// Mirrors FileContextMenu.tsx "Open in Terminal" → createSession(..., "shell", ..., targetDir).
    private func openInTerminal() {
        let targetDir = isDir ? node.path
            : (node.path.contains("/") ? String(node.path[..<node.path.lastIndex(of: "/")!]) : rootPath)
        let taskId = env.tasks?.activeTaskId
        let projectId = taskId == nil ? env.ui.activeProjectId : nil
        let master = taskId == nil && projectId == nil && env.ui.masterWorkspaceActive
        guard taskId != nil || projectId != nil || master else { return }
        Task {
            try? await env.session?.createSession(
                taskId: taskId, projectId: projectId, master: master,
                type: .shell, label: nil, cwd: targetDir, targetWorkspaceKey: nil)
        }
    }
}
