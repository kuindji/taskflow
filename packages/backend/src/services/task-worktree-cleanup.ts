import type { Task } from "@taskflow/shared";
import type { TaskStore } from "./task-store";
import type { GitService } from "./git-service";

async function cleanupTaskWorktree(
    task: Task,
    deleteWorktree: boolean,
    deps: {
        store: Pick<TaskStore, "getProject">;
        git: Pick<GitService, "removeWorktree" | "deleteBranch">;
    },
): Promise<string | undefined> {
    if (
        task.parentId ||
        !deleteWorktree ||
        !task.worktree.enabled ||
        !task.worktree.path ||
        !task.worktree.branch
    )
        return;
    const prefix = "Task deleted, but worktree cleanup failed: ";
    const errors: string[] = [];
    const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
    let project;
    try {
        project = await deps.store.getProject(task.projectId);
    } catch (error) {
        return `${prefix}${message(error)}`;
    }
    if (!project) return `${prefix}project not found`;
    try {
        await deps.git.removeWorktree(project.path, task.worktree.path);
    } catch (error) {
        errors.push(`remove worktree: ${message(error)}`);
    }
    try {
        await deps.git.deleteBranch(project.path, task.worktree.branch);
    } catch (error) {
        errors.push(`delete branch: ${message(error)}`);
    }
    return errors.length ? `${prefix}${errors.join("; ")}` : undefined;
}

export { cleanupTaskWorktree };
