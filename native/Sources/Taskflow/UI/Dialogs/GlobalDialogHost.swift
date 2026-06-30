import SwiftUI

/// Single mount point for all app-level singleton dialogs (command palette, shortcuts, task/project
/// creation, missing-location, fork, flow-input, run-with-options). Mounted once in `AppShell`.
/// Mirrors the centralized dialog mounting in `packages/ui/src/App.tsx`.
struct GlobalDialogHost: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        // Zero-size anchor that only carries sheet modifiers.
        Color.clear.frame(width: 0, height: 0)
            .sheet(isPresented: Binding(
                get: { env.ui.commandPaletteOpen },
                set: { if !$0 { env.ui.setCommandPaletteOpen(false) } }
            )) { CommandPaletteDialog() }
            .sheet(isPresented: Binding(
                get: { env.ui.shortcutsDialogOpen },
                set: { if !$0 { env.ui.setShortcutsDialogOpen(false) } }
            )) { KeyboardShortcutsDialog() }
    }
}
