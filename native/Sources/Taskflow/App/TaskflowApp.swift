import SwiftUI

@main
struct TaskflowApp: App {
    @State private var sidecarManager: SidecarManager = {
        let repoRoot = ProcessInfo.processInfo.environment["TASKFLOW_REPO_ROOT"]
            .flatMap { URL(fileURLWithPath: $0) }
        return SidecarManager(
            resourcesURL: Bundle.main.resourceURL,
            devRepoRoot: repoRoot
        )
    }()

    var body: some Scene {
        WindowGroup("Taskflow") {
            ContentView()
                .frame(minWidth: 900, minHeight: 600)
                .task {
                    do {
                        let client = try await sidecarManager.start()
                        print("[TaskflowApp] sidecar connected, client=\(client)")
                    } catch {
                        print("[TaskflowApp] sidecar start failed: \(error)")
                    }
                }
                .onDisappear {
                    sidecarManager.stop()
                }
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
