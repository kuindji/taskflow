import SwiftUI

// NOTE (Task 9): root temporarily points at PrimitivesGallery.
// Task 10 will compose the final root (AppEnvironment + sidecar lifecycle).
// SidecarManager/WSClient are preserved but not wired in this view.
@main
struct TaskflowApp: App {
    @StateObject private var themeStore = ThemeStore()

    var body: some Scene {
        WindowGroup("Taskflow") {
            PrimitivesGallery(themeStore: themeStore)
                .frame(minWidth: 900, minHeight: 600)
        }
        .windowStyle(.titleBar)
    }
}
