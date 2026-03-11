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
    private sessions = new Map<
        string,
        { onData: (data: string, sequence: number) => void; onExit: (exitCode: number) => void }
    >();
    private sequenceBySession = new Map<string, number>();
    closed: string[] = [];

    spawn(options: {
        id?: string;
        onData: (data: string, sequence: number) => void;
        onExit: (exitCode: number) => void;
    }): string {
        const id = options.id ?? `session-${(this.nextId += 1)}`;
        this.sessions.set(id, options);
        this.sequenceBySession.set(id, 0);
        return id;
    }

    write(): void {}

    resize(): void {}

    emit(id: string, data: string): void {
        const session = this.sessions.get(id);
        if (!session) return;
        const sequence = (this.sequenceBySession.get(id) ?? 0) + 1;
        this.sequenceBySession.set(id, sequence);
        session.onData(data, sequence);
    }

    close(id: string): void {
        this.closed.push(id);
        const session = this.sessions.get(id);
        this.sessions.delete(id);
        this.sequenceBySession.delete(id);
        session?.onExit(0);
    }
}

describe("session handlers", () => {
    let router: Router;
    let store: TaskStore;
    let tempDir: string;
    let projectId: string;
    let ptyManager: FakePtyManager;
    let events: { type: string; payload: unknown }[];

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-session-test-"));
        tempDir = await realpath(tempDir);
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
        });
        await store.init();
        router = new Router();
        ptyManager = new FakePtyManager();
        events = [];

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
            broadcast: (event) => {
                events.push(event);
            },
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

    it("marks agent sessions as working when they start", async () => {
        const task = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "Task",
        })) as { id: string };
        const created = (await router.handle(MSG.SESSION_CREATE, {
            taskId: task.id,
            type: "codex",
        })) as { sessionId: string };

        expect(events).toContainEqual({
            type: MSG.SESSION_STATUS,
            payload: { sessionId: created.sessionId, status: "working" },
        });
    });

    it("persists project-level sessions on the project", async () => {
        const created = (await router.handle(MSG.SESSION_CREATE, {
            projectId,
            type: "codex",
        })) as { sessionId: string };

        const project = await store.getProject(projectId);
        expect(project?.sessions).toHaveLength(1);
        expect(project?.sessions[0]?.id).toBe(created.sessionId);
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

    it("returns persisted session history after a session is no longer active", async () => {
        const task = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "Task",
        })) as { id: string };
        const created = (await router.handle(MSG.SESSION_CREATE, {
            taskId: task.id,
            type: "codex",
        })) as { sessionId: string };

        ptyManager.emit(created.sessionId, "step 1\n");
        ptyManager.emit(created.sessionId, "step 2\n");
        ptyManager.close(created.sessionId);

        expect(
            await router.handle(MSG.SESSION_HISTORY, {
                taskId: task.id,
                sessionId: created.sessionId,
            }),
        ).toEqual({
            data: "step 1\nstep 2\n",
            lastSequence: 2,
        });
    });

    it("returns persisted session history for project-level sessions", async () => {
        const created = (await router.handle(MSG.SESSION_CREATE, {
            projectId,
            type: "codex",
        })) as { sessionId: string };

        ptyManager.emit(created.sessionId, "project step\n");
        ptyManager.close(created.sessionId);

        expect(
            await router.handle(MSG.SESSION_HISTORY, {
                projectId,
                sessionId: created.sessionId,
            }),
        ).toEqual({
            data: "project step\n",
            lastSequence: 1,
        });
    });
});
