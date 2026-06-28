import SwiftUI

/// One file/dir row in the explorer tree. Recursive — renders its children when expanded.
/// Port of `packages/ui/src/components/panels/FileTree.tsx` (view parts; context menu & drag
/// are layered on in Tasks 5–6).
struct FileTreeRow: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env

    let node: FileNode
    let depth: Int
    let gitFiles: [String: String]
    let rootPath: String

    private var files: FileViewModel? { env.files }
    private var isDir: Bool { node.type == "directory" }
    private var isExpanded: Bool { files?.expandedDirs.contains(node.path) ?? false }
    private var isFocused: Bool { files?.focusedPath == node.path }
    private var statusToken: ThemeToken {
        // isIgnored deferred — see FileExplorerPane (gitignore matcher is a Phase-5C+ seam).
        GitStatusColor.token(forStatus: gitFiles[node.path], isIgnored: false)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            row
            if isDir && isExpanded {
                ForEach(node.children ?? [], id: \.path) { child in
                    FileTreeRow(node: child, depth: depth + 1, gitFiles: gitFiles, rootPath: rootPath)
                }
            }
        }
    }

    private var row: some View {
        HStack(spacing: 4) {
            if isDir {
                AppIcon(isExpanded ? "ChevronDown" : "ChevronRight").font(.system(size: 9))
                    .foregroundStyle(theme.color(.mutedForeground))
            } else {
                Spacer().frame(width: 11)  // align with chevron column
            }
            AppIcon(isDir ? (isExpanded ? "FolderOpen" : "Folder") : "File").font(.system(size: 11))
                .foregroundStyle(theme.color(.mutedForeground))
            Text(node.name)
                .font(.system(size: 12))
                .foregroundStyle(theme.color(statusToken))
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .padding(.leading, CGFloat(depth) * 12 + 6)
        .padding(.trailing, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isFocused ? theme.color(.accent).opacity(0.20) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .contentShape(Rectangle())
        .onTapGesture {
            files?.setFocusedPath(node.path)
            if isDir { files?.toggleDir(node.path) } else { files?.onOpenFile?(node.path) }
        }
    }
}
