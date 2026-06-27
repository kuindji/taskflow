import SwiftUI

@main
struct TaskflowApp: App {
    @State private var env = AppEnvironment()

    var body: some Scene {
        WindowGroup("Taskflow") {
            RootView()
                .environment(env)
                .environment(\.appTheme, env.themeStore.current) // fresh: re-reads tracked `current`
                .frame(minWidth: 900, minHeight: 600)
                .task { await env.boot() }
                .onDisappear { env.shutdown() }
        }
        .windowStyle(.titleBar)
    }
}

struct RootView: View {
    @Environment(AppEnvironment.self) private var env
    var body: some View {
        VStack(spacing: 0) {
            statusBar
            PrimitivesGallery(themeStore: env.themeStore)
        }
    }
    private var statusBar: some View {
        HStack {
            switch env.status {
            case .connecting:
                Text("Connecting to backend…")
            case let .connected(port):
                // Phase 3 smoke: show real port + live VM counts to verify composition.
                let taskCount    = env.tasks?.tasks.count ?? 0
                let projectCount = env.projects?.projects.count ?? 0
                Text("Backend connected (port \(port)) · tasks: \(taskCount) · projects: \(projectCount)")
            case let .failed(msg):
                Text("Backend failed: \(msg)").foregroundStyle(.red)
            }
            Spacer()
        }
        .padding(8)
    }
}
