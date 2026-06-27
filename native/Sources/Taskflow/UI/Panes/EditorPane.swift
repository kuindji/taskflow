import SwiftUI
import CodeEditSourceEditor
import CodeEditLanguages

/// Native code-editor pane backed by `CodeEditSourceEditor`.
///
/// File content is loaded **asynchronously over the WS file API** (`env.files.readFile`);
/// the editor is gated on a `loaded` flag so `CodeEditSourceEditor` never receives an empty
/// binding at construction time. Saving is wired to ⌘S via a hidden background `Button`.
///
/// **Key design choices:**
/// - `.task(id: filePath)` reloads when the path changes and cancels the previous load task.
/// - `.id(filePath)` forces SwiftUI to replace the editor view (resetting all state) whenever
///   the file path changes — the in-place file-swap fix.
/// - File access is WS-only; `FileManager` / `String(contentsOfFile:)` are never called here.
///
/// Consumed by `PaneHost` (Task 11) via `EditorPane(filePath:)`.
/// Task 6 adds the Cmd+click import gesture by modifying this file directly.
struct EditorPane: View {
    let filePath: String

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    @State private var text = ""
    @State private var cursors: [CursorPosition] = [CursorPosition(line: 1, column: 1)]
    @State private var loaded = false
    @State private var saveError: String?

    var body: some View {
        Group {
            if loaded {
                CodeEditSourceEditor(
                    $text,
                    language: LanguageDetection.language(forPath: filePath),
                    theme: EditorTheme.from(theme),
                    font: .monospacedSystemFont(ofSize: 13, weight: .regular),
                    tabWidth: 4,
                    lineHeight: 1.2,
                    wrapLines: false,
                    cursorPositions: $cursors,
                    showMinimap: false
                )
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: filePath) {
            // Reset before each load so a stale file is never shown during the fetch.
            loaded = false
            do {
                text = try await env.files?.readFile(path: filePath) ?? ""
                loaded = true
            } catch {
                text = "// could not read \(filePath)"
                loaded = true
            }
        }
        .background(
            // ⌘S save — hidden button captures the keyboard shortcut without appearing in the UI.
            Button("") {
                Task {
                    try? await env.files?.writeFile(path: filePath, content: text)
                }
            }
            .keyboardShortcut("s", modifiers: .command)
            .hidden()
        )
        // Replace (not update) the editor when the file path changes so each file
        // gets a fresh editor instance with its own undo stack and cursor state.
        .id(filePath)
    }

    // MARK: - Navigation

    /// Moves the cursor to the given 1-indexed line (column 1).
    /// Called by Task 6's Cmd+click import gesture and any future line-navigation callers.
    func goToLine(_ n: Int) {
        cursors = [CursorPosition(line: n, column: 1)]
    }
}
