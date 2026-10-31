import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { TaskStore } from "../../src/services/task-store";
import { createWorktreeSetup } from "../../src/services/worktree-setup";
import type { GitService } from "../../src/services/git-service";

class FakeGitService {
    fail = false;

    async createWorktree(): Promise<void> {
        if (this.fail) throw new Error("git worktree add failed");
    }
}

describe("worktree setup", () => {
    let store: TaskStore;
    let tempDir: string;
    let projectPath: string;
    let gitService: FakeGitService;

    beforeEach(async () => {
        tempDir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-worktree-setup-")));
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
        projectPath = join(tempDir, "project");
        await mkdir(projectPath, { recursive: true });
        gitService = new FakeGitService();
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    async function parentWithPendingSubtask() {
        const project = await store.addProject({ name: "project", path: projectPath });
        const parent = await store.createTask({
            projectId: project.id,
            title: "Parent",
            description: "",
            worktree: { enabled: true, path: null, branch: null, pr: null },
        });
        // A subtask added before the worktree exists copies the pending state.
        const subtask = await store.createTask({
            projectId: project.id,
            parentId: parent.id,
            title: "Child",
            description: "",
            worktree: { ...parent.worktree },
        });
        const setup = createWorktreeSetup({
            taskStore: store,
            gitService: gitService as unknown as GitService,
            broadcast: () => {},
        });
        return { parent, subtask, setup };
    }

    it("gives subtasks created while the worktree was pending the finished worktree", async () => {
        const { parent, subtask, setup } = await parentWithPendingSubtask();

        await setup.createWorktreeForTask(parent.id, "Parent");

        const updatedParent = await store.getTask(parent.id);
        const updatedSubtask = await store.getTask(subtask.id);
        expect(updatedParent?.worktree.path).toBe(join(projectPath, ".worktrees", "parent"));
        expect(updatedSubtask?.worktree).toEqual(updatedParent?.worktree);
    });

    it("turns the subtasks' worktree off when the parent's setup fails", async () => {
        const { parent, subtask, setup } = await parentWithPendingSubtask();
        gitService.fail = true;

        await setup.createWorktreeForTask(parent.id, "Parent");

        const updatedSubtask = await store.getTask(subtask.id);
        expect(updatedSubtask?.worktree.enabled).toBe(false);
    });
});
