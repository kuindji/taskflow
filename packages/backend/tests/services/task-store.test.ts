import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { TaskStore } from "../../src/services/task-store";
import { access, mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("TaskStore", () => {
    let store: TaskStore;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-test-"));
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

    async function createProjectDir(name: string): Promise<string> {
        const dir = join(tempDir, name);
        await mkdir(dir, { recursive: true });
        // realpath resolves symlinks (e.g. /var -> /private/var on macOS)
        const { realpath } = await import("fs/promises");
        return realpath(dir);
    }

    describe("projects", () => {
        it("starts with empty project list", async () => {
            const projects = await store.listProjects();
            expect(projects).toEqual([]);
        });

        it("adds and lists projects", async () => {
            const projectDir = await createProjectDir("test");
            const project = await store.addProject({ name: "test", path: projectDir });
            expect(project.name).toBe("test");
            expect(project.path).toBe(projectDir);
            expect(project.id).toBeTruthy();

            const projects = await store.listProjects();
            expect(projects).toHaveLength(1);
            expect(projects[0].name).toBe("test");
        });

        it("removes projects", async () => {
            const projectDir = await createProjectDir("test");
            const project = await store.addProject({ name: "test", path: projectDir });
            await store.removeProject(project.id);
            const projects = await store.listProjects();
            expect(projects).toEqual([]);
        });

        it("removes projects with their active and archived tasks", async () => {
            const projectDir = await createProjectDir("test");
            const project = await store.addProject({ name: "test", path: projectDir });
            const activeTask = await store.createTask({
                projectId: project.id,
                title: "Active task",
                description: "test",
            });
            const archivedTask = await store.createTask({
                projectId: project.id,
                title: "Archived task",
                description: "test",
            });
            await store.appendSessionOutput(activeTask.id, "session-1", 1, "active");
            await store.appendSessionOutput(archivedTask.id, "session-2", 1, "archived");
            await store.archiveTask(archivedTask.id);

            await store.removeProject(project.id);

            expect(await store.listProjects()).toEqual([]);
            expect(await store.listTasks(project.id)).toEqual([]);
            expect(
                (await store.listArchived()).filter((task) => task.projectId === project.id),
            ).toEqual([]);
            expect(await store.getSessionHistory(activeTask.id, "session-1")).toEqual({
                data: "",
                lastSequence: 0,
            });
            expect(await store.getSessionHistory(archivedTask.id, "session-2")).toEqual({
                data: "",
                lastSequence: 0,
            });
        });

        it("recovers from corrupt projects.json but still rewrites on the next save", async () => {
            await writeFile(join(tempDir, "projects.json"), "{bad json");

            expect(await store.listProjects()).toEqual([]);

            const projectDir = await createProjectDir("rewritten");
            const project = await store.addProject({ name: "rewritten", path: projectDir });
            const projects = await store.listProjects();

            expect(projects).toHaveLength(1);
            expect(projects[0].id).toBe(project.id);
        });

        it("surfaces non-recoverable project store read errors", async () => {
            const unreadableStore = new TaskStore({
                projectsFile: tempDir,
                tasksDir: join(tempDir, "tasks"),
                archiveDir: join(tempDir, "archive"),
                sessionLogsDir: join(tempDir, "session-logs"),
                taskLogsDir: join(tempDir, "task-logs"),
            });

            expect(unreadableStore.listProjects()).rejects.toThrow();
        });
    });

    describe("tasks", () => {
        it("creates and lists tasks", async () => {
            const projectDir = await createProjectDir("test");
            const project = await store.addProject({ name: "test", path: projectDir });
            const task = await store.createTask({
                projectId: project.id,
                title: "My task",
                description: "test",
            });
            expect(task.title).toBe("My task");
            expect(task.status).toBe("active");
            expect(task.worktree.enabled).toBe(false);

            const tasks = await store.listTasks();
            expect(tasks).toHaveLength(1);
        });

        it("lists tasks filtered by project", async () => {
            const p1Dir = await createProjectDir("p1");
            const p2Dir = await createProjectDir("p2");
            const p1 = await store.addProject({ name: "p1", path: p1Dir });
            const p2 = await store.addProject({ name: "p2", path: p2Dir });
            await store.createTask({ projectId: p1.id, title: "Task 1", description: "test" });
            await store.createTask({ projectId: p2.id, title: "Task 2", description: "test" });

            const p1Tasks = await store.listTasks(p1.id);
            expect(p1Tasks).toHaveLength(1);
            expect(p1Tasks[0].title).toBe("Task 1");
        });

        it("updates tasks", async () => {
            const projectDir = await createProjectDir("test");
            const project = await store.addProject({ name: "test", path: projectDir });
            const task = await store.createTask({
                projectId: project.id,
                title: "Original",
                description: "test",
            });
            const updated = await store.updateTask(task.id, {
                title: "Updated",
                notes: "some notes",
            });
            expect(updated.title).toBe("Updated");
            expect(updated.notes).toBe("some notes");
        });

        it("persists explicit worktree metadata on create and update", async () => {
            const projectDir = await createProjectDir("test");
            const project = await store.addProject({ name: "test", path: projectDir });
            const task = await store.createTask({
                projectId: project.id,
                title: "Worktree task",
                description: "test",
                worktree: {
                    enabled: true,
                    path: join(projectDir, ".worktrees", "worktree-task"),
                    branch: "task/worktree-task",
                },
            });

            expect(task.worktree).toEqual({
                enabled: true,
                path: join(projectDir, ".worktrees", "worktree-task"),
                branch: "task/worktree-task",
            });

            const updated = await store.updateTask(task.id, {
                worktree: {
                    enabled: true,
                    path: join(projectDir, ".worktrees", "renamed"),
                    branch: "task/renamed",
                },
            });

            expect(updated.worktree).toEqual({
                enabled: true,
                path: join(projectDir, ".worktrees", "renamed"),
                branch: "task/renamed",
            });
            expect((await store.getTask(task.id))?.worktree).toEqual(updated.worktree);
        });

        it("persists session history independently from the live PTY", async () => {
            const projectDir = await createProjectDir("test");
            const project = await store.addProject({ name: "test", path: projectDir });
            const task = await store.createTask({
                projectId: project.id,
                title: "Task",
                description: "test",
            });

            await store.appendSessionOutput(task.id, "session-1", 1, "hello");
            await store.appendSessionOutput(task.id, "session-1", 2, " world");

            expect(await store.getSessionHistory(task.id, "session-1")).toEqual({
                data: "hello world",
                lastSequence: 2,
            });
        });

        it("archives tasks", async () => {
            const projectDir = await createProjectDir("test");
            const project = await store.addProject({ name: "test", path: projectDir });
            const task = await store.createTask({
                projectId: project.id,
                title: "Task",
                description: "test",
            });
            await store.archiveTask(task.id);

            const active = await store.listTasks();
            expect(active).toHaveLength(0);

            const archived = await store.listArchived();
            expect(archived).toHaveLength(1);
            expect(archived[0].status).toBe("archived");
            expect(archived[0].archivedAt).toBeTruthy();
        });

        it("deletes tasks", async () => {
            const projectDir = await createProjectDir("test");
            const project = await store.addProject({ name: "test", path: projectDir });
            const task = await store.createTask({
                projectId: project.id,
                title: "Task",
                description: "test",
            });
            await store.appendSessionOutput(task.id, "session-1", 1, "history");
            await store.deleteTask(task.id);

            const tasks = await store.listTasks();
            expect(tasks).toEqual([]);
            expect(await store.getSessionHistory(task.id, "session-1")).toEqual({
                data: "",
                lastSequence: 0,
            });
        });

        it("drops corrupt task files during project removal", async () => {
            const projectDir = await createProjectDir("test");
            const project = await store.addProject({ name: "test", path: projectDir });
            const task = await store.createTask({
                projectId: project.id,
                title: "Corrupt me",
                description: "test",
            });
            const taskFile = join(tempDir, "tasks", `${task.id}.json`);

            await writeFile(taskFile, "{bad json");
            await store.removeProject(project.id);

            expect(await store.listProjects()).toEqual([]);
            expect(access(taskFile)).rejects.toThrow();
        });

        it("cleans expired archives", async () => {
            const projectDir = await createProjectDir("test");
            const project = await store.addProject({ name: "test", path: projectDir });
            const task = await store.createTask({
                projectId: project.id,
                title: "Old",
                description: "test",
            });

            const archived = await store.archiveTask(task.id);
            const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
            await store.updateArchived(archived.id, { archivedAt: oldDate });

            await store.cleanExpiredArchives();
            const remaining = await store.listArchived();
            expect(remaining).toHaveLength(0);
        });
    });
});
