import Foundation

struct TaskItem: Codable, Identifiable, Equatable {
    let id: String
    let projectId: String
    let title: String
    let status: String
    let createdAt: String
}

enum TaskReducer {
    static func upsert(_ tasks: [TaskItem], _ task: TaskItem) -> [TaskItem] {
        if let idx = tasks.firstIndex(where: { $0.id == task.id }) {
            var copy = tasks
            copy[idx] = task
            return copy
        }
        return tasks + [task]
    }

    static func sortedByCreatedDesc(_ tasks: [TaskItem]) -> [TaskItem] {
        tasks.sorted { $0.createdAt > $1.createdAt }
    }
}
