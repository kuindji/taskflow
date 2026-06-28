import SwiftUI

// MARK: - FileNameValidation

/// Pure validation helper for user-supplied file/folder names.
/// Mirrors the `validate(name.trim())` guard in CreateFileDialog.tsx / RenameFileDialog.tsx:
/// rejects empty, names containing `/`, and names containing a null character `\0`.
enum FileNameValidation {
    nonisolated static func isValidFileName(_ name: String) -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        return !trimmed.isEmpty && !trimmed.contains("/") && !trimmed.contains("\0")
    }
}

// MARK: - MoveFileDialog

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

// MARK: - CreateFileDialog

/// Create a new file or folder under `parentDir`. Port of CreateFileDialog.tsx.
struct CreateFileDialog: View {
    @Environment(AppEnvironment.self) private var env
    let parentDir: String
    let isFolder: Bool
    let onClose: () -> Void
    @State private var name = ""

    private var files: FileViewModel? { env.files }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(isFolder ? "New Folder" : "New File").font(.headline)
            AppTextField(text: $name, placeholder: isFolder ? "folder name" : "file name")
            HStack {
                Spacer()
                Button("Cancel", action: onClose)
                Button("Create") {
                    let trimmed = name.trimmingCharacters(in: .whitespaces)
                    let path = "\(parentDir)/\(trimmed)"
                    let folder = isFolder
                    Task {
                        if folder { try? await files?.createDirectory(path: path) }
                        else { try? await files?.createFile(path: path) }
                    }
                    onClose()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!FileNameValidation.isValidFileName(name))
            }
        }.padding(16).frame(width: 360)
    }
}

// MARK: - RenameFileDialog

/// Rename a file/dir. Port of RenameFileDialog.tsx.
struct RenameFileDialog: View {
    @Environment(AppEnvironment.self) private var env
    let path: String
    let onClose: () -> Void
    @State private var newName: String

    init(path: String, onClose: @escaping () -> Void) {
        self.path = path
        self.onClose = onClose
        let base = path.contains("/")
            ? String(path[path.index(after: path.lastIndex(of: "/")!)...]) : path
        _newName = State(initialValue: base)
    }

    private var files: FileViewModel? { env.files }
    private var parent: String {
        path.contains("/") ? String(path[..<path.lastIndex(of: "/")!]) : ""
    }
    private var currentBasename: String {
        path.contains("/") ? String(path[path.index(after: path.lastIndex(of: "/")!)...]) : path
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Rename").font(.headline)
            AppTextField(text: $newName, placeholder: "new name")
            HStack {
                Spacer()
                Button("Cancel", action: onClose)
                Button("Rename") {
                    let trimmed = newName.trimmingCharacters(in: .whitespaces)
                    let old = path
                    let new = parent.isEmpty ? trimmed : "\(parent)/\(trimmed)"
                    Task { try? await files?.renameFile(oldPath: old, newPath: new) }
                    onClose()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(
                    !FileNameValidation.isValidFileName(newName)
                    || newName.trimmingCharacters(in: .whitespaces) == currentBasename
                )
            }
        }.padding(16).frame(width: 360)
    }
}

// MARK: - DeleteFileDialog

/// Confirm + delete a file/dir. Port of DeleteFileDialog.tsx.
struct DeleteFileDialog: View {
    @Environment(AppEnvironment.self) private var env
    let path: String
    let isDir: Bool
    let onClose: () -> Void

    private var files: FileViewModel? { env.files }
    private var name: String {
        path.contains("/") ? String(path[path.index(after: path.lastIndex(of: "/")!)...]) : path
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Delete \(isDir ? "folder" : "file")").font(.headline)
            Text("Delete \u{201C}\(name)\u{201D}? This cannot be undone.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Cancel", action: onClose)
                Button("Delete", role: .destructive) {
                    let p = path
                    Task { try? await files?.deleteFile(path: p) }
                    onClose()
                }.keyboardShortcut(.defaultAction)
            }
        }.padding(16).frame(width: 360)
    }
}
