import SwiftUI
import GhosttyTerminal

/// SwiftUI wrapper vending the cached `AppTerminalView` for a given session.
/// The surface is kept alive in `AppEnvironment.terminalSurfaces` so switching
/// tabs does not reset the terminal state.
/// Consumed by `PaneHost` (Task 11).
struct TerminalPane: NSViewRepresentable {
    let sessionId: String
    let workspaceKey: String
    @Environment(AppEnvironment.self) private var env

    func makeNSView(context: Context) -> AppTerminalView {
        // client is nil only before the sidecar connects; TerminalPane is only
        // placed in the view hierarchy after env.status == .connected, so the
        // guard-else branch is a resilience fallback, not a normal code path.
        guard let client = env.client else {
            // updateNSView is a no-op, so this stub never recovers — flag the misuse in DEBUG.
            assertionFailure("TerminalPane placed before client connected — check call site guard")
            return AppTerminalView(frame: .zero)
        }
        return env.terminalSurfaces.surface(
            for: sessionId,
            client: client,
            workspaceKey: workspaceKey,
            theme: env.themeStore.currentFile,
            session: env.session
        )
    }

    func updateNSView(_ nsView: AppTerminalView, context: Context) {}
}
