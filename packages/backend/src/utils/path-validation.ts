import type { TaskStore } from "../services/task-store";
import { realpath } from "fs/promises";
import { basename, dirname, resolve, sep } from "path";

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
    return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${sep}`);
}

async function listWorkspaceRoots(taskStore: TaskStore): Promise<string[]> {
    const [projects, tasks] = await Promise.all([taskStore.listProjects(), taskStore.listTasks()]);
    const roots = new Set<string>();

    for (const project of projects) {
        roots.add(await realpath(project.path).catch(() => resolve(project.path)));
    }
    for (const task of tasks) {
        if (task.worktree.enabled && task.worktree.path) {
            const worktreePath = task.worktree.path;
            roots.add(await realpath(worktreePath).catch(() => resolve(worktreePath)));
        }
    }

    return Array.from(roots);
}

async function resolveWorkspacePath(path: string): Promise<string> {
    return realpath(path).catch(async () => {
        const parentPath = await realpath(dirname(path)).catch(() => resolve(dirname(path)));
        return resolve(parentPath, basename(path));
    });
}

export async function assertMutableWorkspacePath(taskStore: TaskStore, path: string): Promise<string> {
    const [roots, resolvedPath] = await Promise.all([
        listWorkspaceRoots(taskStore),
        resolveWorkspacePath(path),
    ]);
    if (!roots.some((root) => isWithinRoot(resolvedPath, root))) {
        throw new Error(`Path is outside known workspaces: ${path}`);
    }
    if (roots.includes(resolvedPath)) {
        throw new Error("Cannot modify workspace root");
    }
    return resolvedPath;
}

export async function assertWorkspacePath(taskStore: TaskStore, path: string): Promise<string> {
    const [roots, resolvedPath] = await Promise.all([
        listWorkspaceRoots(taskStore),
        resolveWorkspacePath(path),
    ]);
    if (!roots.some((root) => isWithinRoot(resolvedPath, root))) {
        throw new Error(`Path is outside known workspaces: ${path}`);
    }
    return resolvedPath;
}

export async function assertWorkspaceRepo(taskStore: TaskStore, repoPath: string): Promise<string> {
    const [roots, resolvedRepoPath] = await Promise.all([
        listWorkspaceRoots(taskStore),
        realpath(repoPath).catch(() => resolve(repoPath)),
    ]);
    if (!roots.some((root) => isWithinRoot(resolvedRepoPath, root))) {
        throw new Error(`Repository is outside known workspaces: ${repoPath}`);
    }
    return resolvedRepoPath;
}

export function assertRepoFilePath(repoPath: string, filePath: string): void {
    const resolvedFilePath = resolve(repoPath, filePath);
    if (!isWithinRoot(resolvedFilePath, repoPath)) {
        throw new Error(`File path is outside repository: ${filePath}`);
    }
}

export function assertWorktreePath(repoPath: string, worktreePath: string): string {
    const worktreesRoot = resolve(repoPath, ".worktrees");
    const resolvedWorktreePath = resolve(worktreePath);
    if (!isWithinRoot(resolvedWorktreePath, worktreesRoot)) {
        throw new Error(`Worktree path must be inside ${worktreesRoot}`);
    }
    return resolvedWorktreePath;
}
