import AppKit
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
/// - `.task(id: LoadKey(...))` reloads when the path changes OR when the WS file API becomes
///   available (sidecar connect), and cancels the previous load task. Keying only on `filePath`
///   would leave the editor permanently blank if it mounted before the sidecar connected.
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

    /// Re-keys the load `.task` on both the file path AND whether the WS file API is
    /// available, so the editor loads the moment the sidecar connects — not only on a
    /// path change. Without the `connected` component a pane mounted pre-connect would
    /// stay blank for the whole session.
    private struct LoadKey: Equatable {
        let path: String
        let connected: Bool
    }

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
            } else if env.files == nil {
                // Sidecar not connected yet — the load .task re-fires once `files` arrives.
                placeholder("Waiting for connection…")
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: LoadKey(path: filePath, connected: env.files != nil)) {
            // Reset before each load so a stale file is never shown during the fetch.
            loaded = false
            // No WS file API yet: stay in the "waiting" state. This .task re-fires when
            // `connected` flips true, at which point the real load runs.
            guard let files = env.files else { return }
            do {
                text = try await files.readFile(path: filePath)
                loaded = true
            } catch {
                text = "// could not read \(filePath)"
                loaded = true
            }
        }
        .overlay(alignment: .bottom) {
            if let saveError {
                Text("Save failed: \(saveError)")
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(theme.color(.destructive))
                    .foregroundStyle(theme.color(.destructiveForeground))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .padding(8)
            }
        }
        .background(
            // ⌘S save — hidden button captures the keyboard shortcut without appearing in the UI.
            Button("") {
                Task {
                    guard let files = env.files else {
                        saveError = "Not connected"
                        return
                    }
                    do {
                        try await files.writeFile(path: filePath, content: text)
                        saveError = nil
                    } catch {
                        // Surface save failures instead of silently swallowing them.
                        saveError = error.localizedDescription
                        NSLog("[EditorPane] save failed for \(filePath): \(error)")
                    }
                }
            }
            .keyboardShortcut("s", modifiers: .command)
            .hidden()
        )
        // MARK: Cmd+click import navigation (Task 6)
        //
        // Phase 4 mechanism: CodeEditSourceEditor moves `cursors` on every click
        // (including ⌘+click). We sample NSEvent.modifierFlags at the moment the
        // cursor binding updates; if the command key is held, we attempt to resolve
        // the import specifier under the new cursor position.
        //
        // Known limitation: also fires on ⌘+Arrow keyboard navigation — acceptable
        // in Phase 4 because import lines are rarely the cursor destination for
        // keyboard commands and the resolve call silently no-ops when the cursor
        // isn't inside a quoted specifier.
        .onChange(of: cursors) { _, newCursors in
            guard NSEvent.modifierFlags.contains(.command),
                  let client = env.client,
                  let cursor = newCursors.first,
                  loaded else { return }
            let lines = text.components(separatedBy: "\n")
            let lineIndex = cursor.line - 1   // cursor.line is 1-based
            guard lineIndex >= 0, lineIndex < lines.count else { return }
            let spec = ImportNavigation.specifier(inLine: lines[lineIndex], column: cursor.column)
            guard let spec else { return }
            let fp = filePath
            Task { @MainActor in
                guard let resolved = await ImportNavigation.resolve(
                    specifier: spec, fromFile: fp, client: client
                ) else { return }
                env.files?.onOpenFile?(resolved)
            }
        }
        // Replace (not update) the editor when the file path changes so each file
        // gets a fresh editor instance with its own undo stack and cursor state.
        .id(filePath)
    }

    private func placeholder(_ message: String) -> some View {
        VStack(spacing: 8) {
            ProgressView()
            Text(message)
                .font(.callout)
                .foregroundStyle(theme.color(.mutedForeground))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Navigation

    /// Moves the cursor to the given 1-indexed line (column 1).
    /// Called by Task 6's Cmd+click import gesture and any future line-navigation callers.
    func goToLine(_ n: Int) {
        cursors = [CursorPosition(line: n, column: 1)]
    }
}
