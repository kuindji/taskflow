import AppKit
import SwiftUI

@main
struct SliceApp: App {
    init() {
        NSApplication.shared.setActivationPolicy(.regular)
    }

    var body: some Scene {
        WindowGroup("Taskflow Native Slice") {
            RootView()
        }
    }
}
