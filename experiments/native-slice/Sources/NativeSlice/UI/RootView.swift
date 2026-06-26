import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    let client: WSClient
    let taskStore: TaskStore
    @Published var selectedTaskId: String?

    init() {
        let client = WSClient(url: SliceEnv.backendURL())
        self.client = client
        self.taskStore = TaskStore(client: client)
    }

    private var started = false

    func start() {
        guard !started else { return }
        started = true
        client.connect()
        taskStore.bindEvents()
        Task { await taskStore.load() }
    }
}

struct RootView: View {
    @StateObject private var model = AppModel()

    var body: some View {
        HSplitView {
            SidebarView(taskStore: model.taskStore, selectedTaskId: $model.selectedTaskId)
            WorkspaceView(selectedTaskId: model.selectedTaskId)   // defined in Task 6
                .frame(minWidth: 600)
        }
        .frame(minWidth: 1100, minHeight: 720)
        .onAppear { model.start() }
    }
}
