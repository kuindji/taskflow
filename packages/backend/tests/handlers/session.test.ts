import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { registerSessionHandlers } from "../../src/handlers/session";
import { registerTaskHandlers } from "../../src/handlers/task";
import { registerProjectHandlers } from "../../src/handlers/project";
import { Router } from "../../src/ws/router";
import { TaskStore } from "../../src/services/task-store";
import { mkdtemp, mkdir, rm, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import { GitService } from "../../src/services/git-service";

class FakePtyManager {
    private nextId = 0;
    private sessions = new Map<string, { onExit: (exitCode: number) => void }>();
    closed: string[] = [];

    spawn(options: { onExit: (exitCode: number) => void }): string {
        const id = `session-${(this.nextId += 1)}`;
        this.sessions.set(id, options);
        return id;
    }

    write(): void {}

    resize(): void {}

    close(id: string): void {
        this.closed.push(id);
        const session = this.sessions.get(id);
        this.sessions.delete(id);
        session?.onExit(0);
    }
}

describe("session handlers", () => {
    let router: Router;
    let store: TaskStore;
    let tempDir: string;
    let projectId: string;
    let ptyManager: FakePtyManager;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-session-test-"));
        tempDir = await realpath(tempDir);
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
        });
        await store.init();
        router = new Router();
        ptyManager = new FakePtyManager();

        registerProjectHandlers(router, store, new GitService());
        registerTaskHandlers({
            router,
            store,
            closeSession: (sessionId) => {
                ptyManager.close(sessionId);
            },
        });
        registerSessionHandlers({
            router,
            ptyManager: ptyManager as never,
            taskStore: store,
            broadcast: () => {},
            getPort: () => 0,
        });

        const projectDir = join(tempDir, "project");
        await mkdir(projectDir, { recursive: true });
        const project = await store.addProject({ name: "project", path: projectDir });
        projectId = project.id;
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("preserves both session refs when sessions are created concurrently", async () => {
        const task = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "Task",
        })) as { id: string };

        await Promise.all([
            router.handle(MSG.SESSION_CREATE, { taskId: task.id, type: "codex" }),
            router.handle(MSG.SESSION_CREATE, { taskId: task.id, type: "claude" }),
        ]);

        const updated = await store.getTask(task.id);
        expect(updated?.sessions).toHaveLength(2);
        expect(updated?.sessions.map((session) => session.type).sort()).toEqual([
            "claude",
            "codex",
        ]);
    });

    it("closes live sessions and clears archived session refs before archiving", async () => {
        const task = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "Task",
        })) as { id: string };
        const created = (await router.handle(MSG.SESSION_CREATE, {
            taskId: task.id,
            type: "codex",
        })) as { sessionId: string };

        await router.handle(MSG.TASK_ARCHIVE, { id: task.id });

        expect(ptyManager.closed).toContain(created.sessionId);
        const archived = (await store.listArchived()).find((entry) => entry.id === task.id);
        expect(archived?.sessions).toHaveLength(0);
    });
});
