import SwiftUI

struct SidebarView: View {
    @ObservedObject var taskStore: TaskStore
    @Binding var selectedTaskId: String?

    var body: some View {
        List(selection: $selectedTaskId) {
            Section("Tasks (\(taskStore.tasks.count))") {
                ForEach(taskStore.tasks) { task in
                    HStack {
                        Circle()
                            .fill(task.status == "active" ? Color.green : Color.secondary)
                            .frame(width: 7, height: 7)
                        Text(task.title).lineLimit(1)
                    }
                    .tag(task.id)
                }
            }
        }
        .listStyle(.sidebar)
        .frame(minWidth: 240)
    }
}
