import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { TaskStore } from "../../src/services/task-store";
import { mkdtemp, mkdir, rm, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("TaskStore.reorderProjects", () => {
    let store: TaskStore;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-test-")));
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

    async function addProject(name: string): Promise<string> {
        const dir = join(tempDir, name);
        await mkdir(dir, { recursive: true });
        const project = await store.addProject({ name, path: dir });
        return project.id;
    }

    it("persists the requested order", async () => {
        const a = await addProject("a");
        const b = await addProject("b");
        const c = await addProject("c");

        await store.reorderProjects([c, a, b]);

        const ids = (await store.listProjects()).map((p) => p.id);
        expect(ids).toEqual([c, a, b]);
    });

    it("appends projects missing from orderedIds", async () => {
        const a = await addProject("a");
        const b = await addProject("b");
        const c = await addProject("c");

        await store.reorderProjects([c]);

        const ids = (await store.listProjects()).map((p) => p.id);
        expect(ids).toEqual([c, a, b]);
    });
});
