import Foundation

/// Resolves the active workspace's working directory. Ports the `workingDir` branch of
/// `useActiveWorkspace.ts`: master → homedir; task → worktree path (if enabled & present)
/// else project path; project → project path; otherwise nil.
enum ActiveWorkspace {
    /// Pure resolver (TDD'd). All inputs explicit so it is testable off the main actor.
    nonisolated static func workingDir(
        task: TaskItem?, project: Project?, masterActive: Bool, homedir: String?
    ) -> String? {
        if masterActive { return homedir }
        if let task, let project {
            if task.worktree.enabled, let wt = task.worktree.path, !wt.isEmpty { return wt }
            return project.path
        }
        if let project { return project.path }
        return nil
    }

    /// Convenience overload that resolves the active task/project from the environment and
    /// calls the pure resolver. Single source of truth for both `FileExplorerPane` and
    /// `SearchPane` (avoids duplicating the env-lookup logic).
    @MainActor static func workingDir(in env: AppEnvironment) -> String? {
        let activeTaskId = env.tasks?.activeTaskId
        let task = activeTaskId.flatMap { id in env.tasks?.tasks.first { $0.id == id } }
        let project: Project? = {
            if let task { return env.projects?.projects.first { $0.id == task.projectId } }
            if let pid = env.ui.activeProjectId { return env.projects?.projects.first { $0.id == pid } }
            return nil
        }()
        return workingDir(task: task, project: project,
                          masterActive: env.ui.masterWorkspaceActive, homedir: env.homedir)
    }
}
