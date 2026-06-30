import SwiftUI

private enum ModalKind { case palette }

@MainActor
private func anyModalOpen(except kind: ModalKind, env: AppEnvironment) -> Bool {
    let ui = env.ui
    return ui.settingsOpen || ui.appearanceOpen || ui.flowManagementOpen
        || ui.scheduleManagementOpen || ui.shortcutsDialogOpen
        || (env.taskCreation.newTaskRequest != nil) || env.taskCreation.newProjectRequested
        || (env.runMenu?.flowInputRequest != nil) || (env.runMenu?.runOptionsRequest != nil)
}

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
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Task") {
                    env.taskCreation.requestNewTask(projectId: env.ui.activeProjectId)
                }
                .keyboardShortcut("n", modifiers: .command)
            }
            CommandMenu("View") {
                Button("Command Palette") {
                    if anyModalOpen(except: .palette, env: env) { return }
                    env.ui.toggleCommandPalette()
                }
                .keyboardShortcut("p", modifiers: [.command, .shift])

                Button("Keyboard Shortcuts") {
                    env.ui.toggleShortcutsDialog()
                }
                .keyboardShortcut("/", modifiers: .command)

                Button("Appearance…") {
                    env.ui.toggleAppearance()
                }
            }
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") {
                    env.ui.openSettings()
                }
                .keyboardShortcut(",", modifiers: .command)
            }
        }
    }
}

struct RootView: View {
    @Environment(AppEnvironment.self) private var env
    /// Debug toggle: flip to true to inspect themed primitives without navigating into the shell.
    @State private var showGallery = false

    var body: some View {
        VStack(spacing: 0) {
            statusBar
            if showGallery {
                PrimitivesGallery(themeStore: env.themeStore)
            } else {
                AppShell()
            }
        }
    }

    private var statusBar: some View {
        HStack {
            switch env.status {
            case .connecting:
                Text("Connecting to backend…")
            case let .connected(port):
                let taskCount    = env.tasks?.tasks.count ?? 0
                let projectCount = env.projects?.projects.count ?? 0
                Text("Backend connected (port \(port)) · tasks: \(taskCount) · projects: \(projectCount)")
            case let .failed(msg):
                Text("Backend failed: \(msg)").foregroundStyle(.red)
            }
            Spacer()
            Button(showGallery ? "Shell" : "Gallery") { showGallery.toggle() }
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(8)
    }
}
