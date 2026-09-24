import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import { TaskStore } from "../../src/services/task-store";
import { createTitleGenerator } from "../../src/services/title-generator";
import { createWorktreeSetup } from "../../src/services/worktree-setup";
import type { BuiltinActionRunner } from "../../src/services/builtin-action-runner";
import type { GitService } from "../../src/services/git-service";

class FakeGitService {
    createdWorktrees: Array<{ repoPath: string; branch: string; worktreePath: string }> = [];

    async createWorktree(repoPath: string, branch: string, worktreePath: string): Promise<void> {
        this.createdWorktrees.push({ repoPath, branch, worktreePath });
    }
}

function runnerReturning(result: string | Error, seen: unknown[] = []): BuiltinActionRunner {
    return {
        runHeadless: async (id, vars, context) => {
            seen.push({ id, vars, context });
            if (result instanceof Error) throw result;
            return result;
        },
    };
}

describe("title generator", () => {
    let store: TaskStore;
    let tempDir: string;
    let projectPath: string;
    let gitService: FakeGitService;
    let events: Array<{ type: string; payload: unknown }>;

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
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("updates the title and provisions a pending worktree task", async () => {
        const project = await store.addProject({ name: "project", path: projectPath });
        const task = await store.createTask({
            projectId: project.id,
            title: "",
            description: "Investigate task worktree setup",
            worktree: { enabled: true, path: null, branch: null, pr: null },
        });

        const broadcast = (event: { type: string; payload: unknown }) => {
            events.push(event);
        };

        const worktreeSetup = createWorktreeSetup({
            taskStore: store,
            gitService: gitService as unknown as GitService,
            broadcast,
        });

        const generator = createTitleGenerator({
            taskStore: store,
            broadcast,
            createWorktree: worktreeSetup.createWorktreeForTask,
            builtinActionRunner: runnerReturning("Fix flaky worktree detection"),
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
        const project = await store.addProject({ name: "project", path: projectPath });
        const task = await store.createTask({
            projectId: project.id,
            title: "",
            description: "Polish task presentation",
        });

        const generator = createTitleGenerator({
            taskStore: store,
            broadcast: (event) => {
                events.push(event);
            },
            builtinActionRunner: runnerReturning("Refine task copy"),
        });

        await generator.generate(task.id, task.description);

        const updated = await store.getTask(task.id);
        expect(updated?.title).toBe("Refine task copy");
        expect(updated?.worktree).toEqual({ enabled: false, path: null, branch: null, pr: null });
        expect(gitService.createdWorktrees).toEqual([]);
        expect(events.map((event) => event.type)).toEqual([MSG.TASK_UPDATED]);
    });

    it("creates worktree using description fallback when title generation fails", async () => {
        const project = await store.addProject({ name: "project", path: projectPath });
        const task = await store.createTask({
            projectId: project.id,
            title: "",
            description: "Fix authentication flow",
            worktree: { enabled: true, path: null, branch: null, pr: null },
        });

        const broadcast = (event: { type: string; payload: unknown }) => {
            events.push(event);
        };

        const worktreeSetup = createWorktreeSetup({
            taskStore: store,
            gitService: gitService as unknown as GitService,
            broadcast,
        });

        const generator = createTitleGenerator({
            taskStore: store,
            broadcast,
            createWorktree: worktreeSetup.createWorktreeForTask,
            builtinActionRunner: runnerReturning(new Error("exit 1")),
        });

        await generator.generate(task.id, task.description);

        const updated = await store.getTask(task.id);
        // Title should not be updated (generation failed)
        expect(updated?.title).toBe("");
        // But worktree should still be created using description
        expect(updated?.worktree).toEqual({
            enabled: true,
            path: join(projectPath, ".worktrees", "fix-authentication-flow"),
            branch: "task/fix-authentication-flow",
            pr: null,
        });
        expect(gitService.createdWorktrees.length).toBe(1);
    });

    it("asks the title built-in with the description and the task's project", async () => {
        const project = await store.addProject({ name: "project", path: projectPath });
        const task = await store.createTask({
            projectId: project.id,
            title: "",
            description: "d",
            worktree: { enabled: false, path: null, branch: null, pr: null },
        });
        const seen: unknown[] = [];

        const generator = createTitleGenerator({
            taskStore: store,
            broadcast: () => {},
            builtinActionRunner: runnerReturning("Title", seen),
        });
        await generator.generate(task.id, "d");

        expect(seen).toEqual([
            {
                id: "builtin:task-title",
                vars: { description: "d" },
                context: { project: await store.getProject(project.id) },
            },
        ]);
    });

    it("strips surrounding quotes from the generated title", async () => {
        const project = await store.addProject({ name: "project", path: projectPath });
        const task = await store.createTask({ projectId: project.id, title: "", description: "d" });
        const generator = createTitleGenerator({
            taskStore: store,
            broadcast: () => {},
            builtinActionRunner: runnerReturning('"Quoted title"'),
        });
        await generator.generate(task.id, "d");
        expect((await store.getTask(task.id))?.title).toBe("Quoted title");
    });
});
