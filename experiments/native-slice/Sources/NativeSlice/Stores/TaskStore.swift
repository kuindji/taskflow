import Foundation

@MainActor
final class TaskStore: ObservableObject {
    @Published private(set) var tasks: [TaskItem] = []

    private let client: WSClient
    private var unsubscribers: [() -> Void] = []

    init(client: WSClient) { self.client = client }

    private struct TaskListResponse: Codable { let tasks: [TaskItem] }
    private struct TaskEvent: Codable { let task: TaskItem }

    func load() async {
        do {
            let payload = try await client.request(type: "task:list", payload: [:])
            let resp = try JSONDecoder().decode(TaskListResponse.self, from: payload)
            tasks = TaskReducer.sortedByCreatedDesc(resp.tasks)
        } catch {
            NSLog("TaskStore.load failed: \(error)")
        }
    }

    func bindEvents() {
        let apply: (Data) -> Void = { [weak self] data in
            guard let self,
                  let event = try? JSONDecoder().decode(TaskEvent.self, from: data) else { return }
            self.tasks = TaskReducer.sortedByCreatedDesc(TaskReducer.upsert(self.tasks, event.task))
        }
        unsubscribers.append(client.on(event: "task:updated", apply))
        unsubscribers.append(client.on(event: "task:created", apply))
    }

    deinit { unsubscribers.forEach { $0() } }
}
