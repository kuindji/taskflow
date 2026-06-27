import SwiftUI

@main
struct TaskflowApp: App {
    var body: some Scene {
        WindowGroup("Taskflow") {
            ContentView()
                .frame(minWidth: 900, minHeight: 600)
        }
        .windowStyle(.titleBar)
    }
}

struct ContentView: View {
    var body: some View {
        Text("Taskflow (native) — foundations")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
