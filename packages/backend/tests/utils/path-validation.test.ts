import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { findProjectForPath } from "../../src/utils/path-validation";
import { TaskStore } from "../../src/services/task-store";

describe("findProjectForPath", () => {
    let tempDir: string;
    let store: TaskStore;

    beforeEach(async () => {
        tempDir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-path-validation-")));
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("resolves to the task's project when an enabled worktree lives under another project's root", async () => {
        const projectADir = join(tempDir, "project-a");
        const projectBDir = join(tempDir, "project-b");
        await mkdir(projectADir, { recursive: true });
        await mkdir(projectBDir, { recursive: true });
        const projectA = await store.addProject({ name: "a", path: projectADir });
        await store.addProject({ name: "b", path: projectBDir });

        const worktreePath = join(projectBDir, "worktrees", "task-a");
        await mkdir(worktreePath, { recursive: true });
        await store.createTask({
            projectId: projectA.id,
            title: "task in b's tree",
            description: "",
            worktree: { enabled: true, path: worktreePath, branch: "task/a", pr: null },
        });

        const result = await findProjectForPath(store, join(worktreePath, "nested", "file.ts"));

        expect(result?.id).toBe(projectA.id);
    });

    it("resolves to the deepest (innermost) project root when project roots are nested", async () => {
        const outerDir = join(tempDir, "outer");
        const innerDir = join(outerDir, "inner");
        await mkdir(innerDir, { recursive: true });
        const outerProject = await store.addProject({ name: "outer", path: outerDir });
        const innerProject = await store.addProject({ name: "inner", path: innerDir });

        const result = await findProjectForPath(store, join(innerDir, "file.ts"));

        expect(result?.id).toBe(innerProject.id);
        expect(result?.id).not.toBe(outerProject.id);
    });

    it("does not let a disabled worktree capture paths under its recorded worktree path", async () => {
        const projectADir = join(tempDir, "project-a");
        const projectBDir = join(tempDir, "project-b");
        await mkdir(projectADir, { recursive: true });
        await mkdir(projectBDir, { recursive: true });
        const projectA = await store.addProject({ name: "a", path: projectADir });
        const projectB = await store.addProject({ name: "b", path: projectBDir });

        const worktreePath = join(projectBDir, "worktrees", "task-a");
        await mkdir(worktreePath, { recursive: true });
        await store.createTask({
            projectId: projectA.id,
            title: "disabled worktree in b's tree",
            description: "",
            worktree: { enabled: false, path: worktreePath, branch: "task/a", pr: null },
        });

        const result = await findProjectForPath(store, join(worktreePath, "file.ts"));

        expect(result?.id).toBe(projectB.id);
    });

    it("returns null and throws nothing for a path inside no project", async () => {
        const outsideDir = join(tempDir, "outside");
        await mkdir(outsideDir, { recursive: true });

        const result = await findProjectForPath(store, join(outsideDir, "file.ts"));

        expect(result).toBeNull();
    });
});
