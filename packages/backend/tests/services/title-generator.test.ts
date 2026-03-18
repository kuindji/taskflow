import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import { TaskStore } from "../../src/services/task-store";
import { createTitleGenerator } from "../../src/services/title-generator";
import type { GitService } from "../../src/services/git-service";

class FakeGitService {
    createdWorktrees: Array<{ repoPath: string; branch: string; worktreePath: string }> = [];

    async createWorktree(repoPath: string, branch: string, worktreePath: string): Promise<void> {
        this.createdWorktrees.push({ repoPath, branch, worktreePath });
    }
}

function makeSpawnResult(output: string, exitCode = 0) {
    const encoder = new TextEncoder();
    const stdout = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(output));
            controller.close();
        },
    });

    return {
        stdin: {
            write() {},
            end() {},
        },
        stdout,
        stderr: new ReadableStream(),
        exited: Promise.resolve(exitCode),
    };
}

describe("title generator", () => {
    let store: TaskStore;
    let tempDir: string;
    let projectPath: string;
    let gitService: FakeGitService;
    let events: Array<{ type: string; payload: unknown }>;
    let originalSpawn: typeof Bun.spawn;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-title-test-"));
        tempDir = await realpath(tempDir);
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
        events = [];
        originalSpawn = Bun.spawn;
    });

    afterEach(async () => {
        Bun.spawn = originalSpawn;
        await rm(tempDir, { recursive: true, force: true });
    });

    it("updates the title and provisions a pending worktree task", async () => {
        Bun.spawn = (() =>
            makeSpawnResult("Fix flaky worktree detection\n")) as unknown as typeof Bun.spawn;

        const project = await store.addProject({ name: "project", path: projectPath });
        const task = await store.createTask({
            projectId: project.id,
            title: "",
            description: "Investigate task worktree setup",
            worktree: { enabled: true, path: null, branch: null, pr: null },
        });

        const generator = createTitleGenerator({
            taskStore: store,
            gitService: gitService as unknown as GitService,
            broadcast: (event) => {
                events.push(event);
            },
        });

        await generator.generate(task.id, task.description);

        const updated = await store.getTask(task.id);
        expect(updated?.title).toBe("Fix flaky worktree detection");
        expect(updated?.worktree).toEqual({
            enabled: true,
            path: join(projectPath, ".worktrees", "fix-flaky-worktree-detection"),
            branch: "task/fix-flaky-worktree-detection",
            pr: null,
        });
        expect(gitService.createdWorktrees).toEqual([
            {
                repoPath: projectPath,
                branch: "task/fix-flaky-worktree-detection",
                worktreePath: join(projectPath, ".worktrees", "fix-flaky-worktree-detection"),
            },
        ]);
        expect(events.map((event) => event.type)).toEqual([MSG.TASK_UPDATED, MSG.TASK_UPDATED]);
    });

    it("updates the title without creating a worktree for non-worktree tasks", async () => {
        Bun.spawn = (() => makeSpawnResult("Refine task copy\n")) as unknown as typeof Bun.spawn;

        const project = await store.addProject({ name: "project", path: projectPath });
        const task = await store.createTask({
            projectId: project.id,
            title: "",
            description: "Polish task presentation",
        });

        const generator = createTitleGenerator({
            taskStore: store,
            gitService: gitService as unknown as GitService,
            broadcast: (event) => {
                events.push(event);
            },
        });

        await generator.generate(task.id, task.description);

        const updated = await store.getTask(task.id);
        expect(updated?.title).toBe("Refine task copy");
        expect(updated?.worktree).toEqual({ enabled: false, path: null, branch: null, pr: null });
        expect(gitService.createdWorktrees).toEqual([]);
        expect(events.map((event) => event.type)).toEqual([MSG.TASK_UPDATED]);
    });
});
