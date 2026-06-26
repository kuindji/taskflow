import SwiftUI

struct WorkspaceView: View {
    let selectedTaskId: String?

    @State private var order: [PaneKind] = PaneKind.allCases
    @State private var active: PaneKind = .terminal

    var body: some View {
        if let taskId = selectedTaskId {
            VStack(spacing: 0) {
                TabStrip(order: $order, active: $active)
                Divider()
                HSplitView {
                    paneContent(for: active, taskId: taskId)
                        .frame(minWidth: 320)
                    InfoPane(taskId: taskId)
                        .frame(minWidth: 200)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Text("Select a task").foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private func paneContent(for kind: PaneKind, taskId: String) -> some View {
        switch kind {
        case .terminal:
            TerminalPane(workingDirectory: FileManager.default.currentDirectoryPath)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .editor:   Text("Editor pane — Task 8").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct InfoPane: View {
    let taskId: String
    var body: some View {
        VStack(alignment: .leading) { Text("Task").font(.headline); Text(taskId).font(.caption) }
            .padding().frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
