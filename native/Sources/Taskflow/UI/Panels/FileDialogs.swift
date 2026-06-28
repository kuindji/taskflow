import SwiftUI

/// Confirms a pending drag-move and performs it via `renameFile`. Port of MoveFileDialog.tsx.
/// Presented from `FileExplorerPane` bound to `FileViewModel.pendingMove`.
struct MoveFileDialog: View {
    @Environment(AppEnvironment.self) private var env
    let move: PendingMove

    private var files: FileViewModel? { env.files }
    private var fileName: String {
        move.sourcePath.contains("/")
            ? String(move.sourcePath[move.sourcePath.index(after: move.sourcePath.lastIndex(of: "/")!)...])
            : move.sourcePath
    }
    private var newPath: String { "\(move.destinationDir)/\(fileName)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Move file").font(.headline)
            Text("Move \u{201C}\(fileName)\u{201D} to \u{201C}\(move.destinationDir)\u{201D}?")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Cancel") { files?.clearPendingMove() }
                Button("Move") {
                    let old = move.sourcePath, new = newPath
                    Task { try? await files?.renameFile(oldPath: old, newPath: new) }
                    files?.clearPendingMove()
                }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(16).frame(width: 360)
    }
}
