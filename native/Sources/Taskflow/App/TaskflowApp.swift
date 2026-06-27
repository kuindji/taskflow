import SwiftUI

@main
struct TaskflowApp: App {
    @StateObject private var env = AppEnvironment()

    var body: some Scene {
        WindowGroup("Taskflow") {
            RootView()
                .environmentObject(env)
                .environment(\.appTheme, env.themeStore.current)
                .frame(minWidth: 900, minHeight: 600)
                .task { await env.boot() }
                .onDisappear { env.shutdown() }
        }
        .windowStyle(.titleBar)
    }
}

struct RootView: View {
    @EnvironmentObject var env: AppEnvironment
    var body: some View {
        VStack(spacing: 0) {
            statusBar
            PrimitivesGallery(themeStore: env.themeStore)
        }
    }
    private var statusBar: some View {
        HStack {
            switch env.status {
            case .connecting: Text("Connecting to backend…")
            case let .connected(port): Text("Backend connected (port \(port))")
            case let .failed(msg): Text("Backend failed: \(msg)").foregroundStyle(.red)
            }
            Spacer()
        }
        .padding(8)
    }
}
