import SwiftUI

/// Run submenu content shared by the task + project context menus.
/// Port of components/shared/RunMenuItems.tsx (section order from lib/run-menu.ts).
struct RunMenuItems: View {
    let data: RunMenuData
    let callbacks: RunMenuCallbacks

    var body: some View {
        if !data.scripts.isEmpty {
            Menu("package.json") {
                ForEach(data.scripts.keys.sorted(), id: \.self) { name in
                    Button("\(name) (\(data.defaultRuntime))") { callbacks.onRunScript(name) }
                }
            }
        }
        if !data.agentCommands.isEmpty {
            Menu(".claude") {
                ForEach(data.agentCommands, id: \.name) { cmd in
                    Button("\(cmd.name) (\(cmd.source))") { callbacks.onRunAgentCommand(cmd) }
                        .disabled(!data.online)
                }
            }
            .disabled(!data.online)
        }
        if !data.flows.isEmpty && !data.hasActiveFlowRun {
            Menu("Flows") {
                ForEach(data.flows, id: \.id) { flow in
                    Button(flow.name) { callbacks.onStartFlow(flow.id) }
                        .disabled(!data.online)
                }
            }
            .disabled(!data.online)
        }
        if !data.standaloneActions.isEmpty {
            Menu("Actions") {
                ForEach(data.standaloneActions, id: \.id) { action in
                    Button("\(action.name) (\(action.sessionType.rawValue))") {
                        callbacks.onRunAction(action)
                    }
                    .disabled(!data.online)
                }
            }
            .disabled(!data.online)
        }
        if data.showAgentOptions {
            Divider()
            Section("Run agent with task description") {
                ForEach(RunMenuViewModel.allAgentTypes, id: \.rawValue) { agent in
                    Menu(RunMenuViewModel.displayName(agent)) {
                        Button("Run") { callbacks.onRunTab(agent) }
                        Button("Run with options…") { callbacks.onRunTabWithOptions(agent) }
                    }
                    .disabled(!data.online)
                }
            }
        }
    }
}
