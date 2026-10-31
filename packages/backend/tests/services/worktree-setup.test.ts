import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { TaskStore } from "../../src/services/task-store";
import { createWorktreeSetup } from "../../src/services/worktree-setup";
import type { GitService } from "../../src/services/git-service";
import type { PtyManager } from "../../src/services/pty-manager";
import type { CreateSessionOpts } from "../../src/services/session-lifecycle";

class FakeGitService {
    fail = false;
    created: string[] = [];

    async createWorktree(_repoPath: string, _branch: string, path: string): Promise<void> {
        if (this.fail) throw new Error("git worktree add failed");
        this.created.push(path);
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

    it("does not give a subtask a worktree of its own", async () => {
        const { subtask, setup } = await parentWithPendingSubtask();

        await setup.createWorktreeForTask(subtask.id, "Child title");

        expect(gitService.created).toEqual([]);
        expect((await store.getTask(subtask.id))?.worktree.path).toBeNull();
    });

    it("names the worktree after the task id when the title has no ASCII letters", async () => {
        const project = await store.addProject({ name: "project", path: projectPath });
        const task = await store.createTask({
            projectId: project.id,
            title: "Исправить ошибку",
            description: "",
            worktree: { enabled: true, path: null, branch: null, pr: null },
        });
        const setup = createWorktreeSetup({
            taskStore: store,
            gitService: gitService as unknown as GitService,
            broadcast: () => {},
        });

        await setup.createWorktreeForTask(task.id, task.title);

        const slug = `task-${task.id.slice(0, 8)}`;
        expect((await store.getTask(task.id))?.worktree).toMatchObject({
            enabled: true,
            path: join(projectPath, ".worktrees", slug),
            branch: `task/${slug}`,
        });
    });

    for (const [shell, line] of [
        ["/bin/zsh", "bun install; exit $?\r"],
        ["C:\\Windows\\System32\\cmd.exe", "bun install && exit 0 || exit 1\r"],
        [
            "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
            "bun install; if ($?) { exit 0 } else { exit 1 }\r",
        ],
    ] as const) {
        it(`writes the init command in ${shell} syntax`, async () => {
            const project = await store.addProject({ name: "project", path: projectPath });
            const task = await store.createTask({
                projectId: project.id,
                title: "Init",
                description: "",
                worktree: { enabled: true, path: null, branch: null, pr: null },
            });
            const written: string[] = [];
            let exited: CreateSessionOpts["onSessionExited"];
            const ptyManager = {
                write: (_id: string, data: string) => {
                    written.push(data);
                    exited?.("init", 0);
                },
            };
            const setup = createWorktreeSetup({
                taskStore: store,
                gitService: gitService as unknown as GitService,
                broadcast: () => {},
                systemShellPath: shell,
                ptyManager: ptyManager as unknown as PtyManager,
                createSession: async (opts) => {
                    exited = opts.onSessionExited;
                    return "init";
                },
            });

            await setup.createWorktreeForTask(task.id, task.title, "bun install");

            expect(written).toEqual([line]);
        });
    }
});
