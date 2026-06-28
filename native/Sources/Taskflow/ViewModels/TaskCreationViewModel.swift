import Foundation

/// Request seam for task/project creation. The toolbar + context menus call these; the modal
/// creation FORMS (NewTaskDialog/NewProjectDialog) are mounted by the 5F dialog host, which
/// observes these requests and clears them. Ports the request half of stores/task-creation-store.ts.
@MainActor @Observable final class TaskCreationViewModel {
    struct NewTaskRequest: Equatable {
        let projectId: String?
        let parentId: String?
    }
    var newTaskRequest: NewTaskRequest?
    var newProjectRequested: Bool = false

    func requestNewTask(projectId: String?) { newTaskRequest = NewTaskRequest(projectId: projectId, parentId: nil) }
    func requestNewSubtask(parentId: String, projectId: String) {
        newTaskRequest = NewTaskRequest(projectId: projectId, parentId: parentId)
    }
    func requestNewProject() { newProjectRequested = true }
    func clear() { newTaskRequest = nil; newProjectRequested = false }
}
