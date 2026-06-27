import SwiftUI

/// Plain word-wrapped text pane for displaying markdown files.
///
/// File content is loaded **asynchronously over the WS file API** (`env.files.readFile`);
/// the view shows a placeholder until content is available.
///
/// **Key design choices:**
/// - `.task(id: LoadKey(...))` reloads when the path changes OR when the WS file API becomes
///   available (sidecar connect), and cancels the previous load task. Keying only on `filePath`
///   would leave the pane permanently blank if it mounted before the sidecar connected.
/// - File access is WS-only; `FileManager` / `String(contentsOfFile:)` are never called here.
///
/// Consumed by `PaneHost` (Task 11) via `MarkdownPane(filePath:)`.
struct MarkdownPane: View {
    let filePath: String

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    @State private var content = ""
    @State private var loaded = false

    /// Re-keys the load `.task` on both the file path AND whether the WS file API is
    /// available, so the pane loads the moment the sidecar connects — not only on a
    /// path change. Without the `connected` component a pane mounted pre-connect would
    /// stay blank for the whole session.
    private struct LoadKey: Equatable {
        let path: String
        let connected: Bool
    }

    var body: some View {
        Group {
            if loaded {
                ScrollView {
                    Text(content)
                        .font(.system(.body, design: .default))
                        .foregroundStyle(theme.foreground)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                }
            } else if env.files == nil {
                // Sidecar not connected yet — the load .task re-fires once `files` arrives.
                placeholder("Waiting for connection…")
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.background)
        .task(id: LoadKey(path: filePath, connected: env.files != nil)) {
            // Reset before each load so a stale file is never shown during the fetch.
            loaded = false
            // No WS file API yet: stay in the "waiting" state. This .task re-fires when
            // `connected` flips true, at which point the real load runs.
            guard let files = env.files else { return }
            do {
                content = try await files.readFile(path: filePath)
                loaded = true
            } catch {
                content = "Could not read \(filePath)"
                loaded = true
            }
        }
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
}
