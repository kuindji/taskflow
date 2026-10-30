import { beforeEach, afterEach, describe, expect, it, mock } from "bun:test";
import {
    MSG,
    type AppSettings,
    type SessionOwnerRef,
    type WsEvent,
    type SessionSnapshotResponse,
} from "@taskflow/shared";
import type { BrowserTabService } from "../../src/services/browser-tab-service";
import { ApiRouter } from "../../src/api/router";
import { registerApiRoutes } from "../../src/api/routes";
import { SettingsStore } from "../../src/services/settings-store";
import { mkdtemp, mkdir, realpath, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { TaskStore } from "../../src/services/task-store";

class FakePtyManager {
    constructor(private readonly activeSessionIds = new Set<string>()) {}

    has(sessionId: string): boolean {
        return this.activeSessionIds.has(sessionId);
    }

    snapshot: SessionSnapshotResponse = {
        snapshot: "screen",
        lastSequence: 4,
        cursorHidden: false,
        kittyStack: [],
        mouseEncoding: "x10",
    };

    async getSnapshot(): Promise<SessionSnapshotResponse> {
        return this.snapshot;
    }

    close(): void {}
}

class FakeTrayStateTracker {
    status: "working" | "attention" | null = null;
    updates: Array<{ sessionId: string; status: "working" | "attention" | "initializing" }> = [];

    setSessionStatus(sessionId: string, status: "working" | "attention" | "initializing"): void {
        this.updates.push({ sessionId, status });
        this.status = status === "initializing" ? this.status : status;
    }

    getAggregateState(): "working" | "attention" | null {
        return this.status;
    }
}

const moveCalls: Array<{ sessionId: string; target: SessionOwnerRef }> = [];

const closeForOwner = mock(async (_owner: { taskId: string } | { projectId: string }) => {});

const sharedTestDeps = {
    cdpKeyFor: (id: string) => `key-${id}`,
    cdpGateway: {
        open: () => {},
        message: () => {},
        close: () => {},
        versionJson: async () => ({}),
        listJson: async () => [],
    },
    browserTabService: { closeForOwner } as unknown as BrowserTabService,
    sessionLifecycle: {
        createSession: async () => "",
        resumeSession: async (sessionId: string) => sessionId,
        removeSessionFromOwner: async () => {},
        moveSession: async (sessionId: string, target: SessionOwnerRef) => {
            if (target.taskId === "archived") throw new Error("Task not found");
            moveCalls.push({ sessionId, target });
        },
        getSessionOwner: async (sessionId: string): Promise<SessionOwnerRef | null> =>
            sessionId === "session-1" ? { taskId: "t1", projectId: "p1" } : null,
    },
    schedulerService: {} as never,
    scheduleStore: {} as never,
    shells: [],
    systemShellPath: null,
    runtimes: [],
    editors: [],
    generateScheduleName: async (prompt: string) => prompt.slice(0, 50),
    devServerService: {
        list: async () => [],
        add: async () => {
            throw new Error("not used in these tests");
        },
        remove: async () => false,
        removeByPid: async () => false,
        stop: async () => ({ ok: true as const }),
    },
    remoteAgentService: {
        getAppName: async () => "Test",
        getStatus: () => ({ running: false }),
        start: async () => ({ running: true }),
        stop: async () => ({ running: false }),
    } as never,
};

describe("api routes", () => {
    let apiRouter: ApiRouter;
    let events: WsEvent[];
    let tempDir: string;
    let trayStateTracker: FakeTrayStateTracker;
    let ptyManager: FakePtyManager;

    beforeEach(async () => {
        moveCalls.length = 0;
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-api-routes-"));
        apiRouter = new ApiRouter();
        events = [];
        trayStateTracker = new FakeTrayStateTracker();
        ptyManager = new FakePtyManager(new Set(["session-1"]));
        registerApiRoutes({
            apiRouter,
            taskStore: {} as never,
            ptyManager: ptyManager as never,
            broadcast: (event) => {
                events.push(event);
            },
            settingsStore: new SettingsStore(join(tempDir, "settings.json")),
            flowStore: {} as never,
            flowRunner: {} as never,
            gitService: {} as never,
            agents: [],
            ...sharedTestDeps,
            trayStateTracker: trayStateTracker as never,
            notificationStore: {} as never,
        });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("the snapshot route returns the awaited snapshot", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/sessions/session-1/snapshot"),
        );
        expect(response?.status).toBe(200);
        expect(await response?.json()).toEqual(ptyManager.snapshot);
    });

    it("the snapshot route returns snapshot null when the parser times out", async () => {
        ptyManager.snapshot = {
            snapshot: null,
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [],
            mouseEncoding: "x10",
        };
        const response = await apiRouter.handle(
            new Request("http://localhost/api/sessions/session-1/snapshot"),
        );
        expect(response?.status).toBe(200);
        expect(await response?.json()).toEqual(ptyManager.snapshot);
    });

    it("moves a session to the requested owner", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/sessions/session-1/move", {
                method: "POST",
                body: JSON.stringify({ taskId: "t2" }),
                headers: { "Content-Type": "application/json" },
            }),
        );

        expect(response?.status).toBe(200);
        expect(moveCalls).toEqual([{ sessionId: "session-1", target: { taskId: "t2" } }]);
    });

    it("returns the move refusal as a 400 with its message", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/sessions/session-1/move", {
                method: "POST",
                body: JSON.stringify({ taskId: "archived" }),
                headers: { "Content-Type": "application/json" },
            }),
        );

        expect(response?.status).toBe(400);
        expect(await response?.json()).toEqual({ error: "Task not found" });
    });

    it("reports a session's current owner, or 404", async () => {
        const found = await apiRouter.handle(
            new Request("http://localhost/api/sessions/session-1/owner", { method: "GET" }),
        );
        const missing = await apiRouter.handle(
            new Request("http://localhost/api/sessions/other/owner", { method: "GET" }),
        );

        expect(await found?.json()).toEqual({ taskId: "t1", projectId: "p1" });
        expect(missing?.status).toBe(404);
    });

    it("registers the dev server routes", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/dev-servers?all=1", { method: "GET" }),
        );

        expect(response?.status).toBe(200);
        expect(await response?.json()).toEqual({ devServers: [] });
    });

    it("broadcasts explicit session status updates", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/sessions/session-1/status", {
                method: "POST",
                body: JSON.stringify({ status: "working" }),
                headers: { "Content-Type": "application/json" },
            }),
        );

        expect(response?.status).toBe(200);
        expect(events).toEqual([
            {
                type: MSG.SESSION_STATUS,
                payload: { sessionId: "session-1", status: "working" },
            },
        ]);
        expect(trayStateTracker.updates).toEqual([{ sessionId: "session-1", status: "working" }]);
    });

    it("rejects invalid session statuses", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/sessions/session-1/status", {
                method: "POST",
                body: JSON.stringify({ status: "busy" }),
                headers: { "Content-Type": "application/json" },
            }),
        );

        expect(response?.status).toBe(400);
        expect(events).toHaveLength(0);
    });

    it("returns the current tray aggregate state", async () => {
        trayStateTracker.status = "attention";

        const response = await apiRouter.handle(
            new Request("http://localhost/api/tray-state", { method: "GET" }),
        );

        expect(response?.status).toBe(200);
        expect(await response?.json()).toEqual({ status: "attention" });
    });
});

describe("settings routes", () => {
    let apiRouter: ApiRouter;
    let tempDir: string;
    let settingsStore: SettingsStore;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-api-settings-"));
        settingsStore = new SettingsStore(join(tempDir, "settings.json"));
        apiRouter = new ApiRouter();
        registerApiRoutes({
            apiRouter,
            taskStore: {} as never,
            ptyManager: new FakePtyManager() as never,
            broadcast: () => {},
            settingsStore,
            flowStore: {} as never,
            flowRunner: {} as never,
            gitService: {} as never,
            agents: [],
            ...sharedTestDeps,
            trayStateTracker: new FakeTrayStateTracker() as never,
            notificationStore: {} as never,
        });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("GET /api/settings returns defaults", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/settings", { method: "GET" }),
        );
        expect(response).not.toBeNull();
        expect(response?.status).toBe(200);
        const body = (await response?.json()) as AppSettings;
        expect(body.layout.window.width).toBe(1400);
        expect(body.layout.panels.sidebarWidth).toBe(220);
    });

    it("PATCH /api/settings updates and returns full settings", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/settings", {
                method: "PATCH",
                body: JSON.stringify({
                    layout: { window: { width: 1600, height: 1000 } },
                }),
                headers: { "Content-Type": "application/json" },
            }),
        );
        expect(response).not.toBeNull();
        expect(response?.status).toBe(200);
        const body = (await response?.json()) as AppSettings;
        expect(body.layout.window.width).toBe(1600);
        expect(body.layout.window.height).toBe(1000);
        expect(body.layout.window.isMaximized).toBe(false);
    });

    it("PATCH /api/settings rejects invalid JSON", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/settings", {
                method: "PATCH",
                body: "not json",
                headers: { "Content-Type": "application/json" },
            }),
        );
        expect(response?.status).toBe(400);
    });
});

describe("flow artifact routes", () => {
    let apiRouter: ApiRouter;
    const flowRunner = {
        saveArtifact: mock(async () => {}),
    };

    beforeEach(() => {
        apiRouter = new ApiRouter();
        flowRunner.saveArtifact.mockClear();
        registerApiRoutes({
            apiRouter,
            taskStore: {} as never,
            ptyManager: new FakePtyManager() as never,
            broadcast: () => {},
            settingsStore: {} as never,
            flowStore: {} as never,
            flowRunner: flowRunner as never,
            gitService: {} as never,
            agents: [],
            ...sharedTestDeps,
            trayStateTracker: new FakeTrayStateTracker() as never,
            notificationStore: {} as never,
        });
    });

    it("requires a sessionId when saving an artifact", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/flow/artifact", {
                method: "POST",
                body: JSON.stringify({
                    taskId: "task-1",
                    flowId: "flow-1",
                    actionEntryId: "entry-1",
                    type: "summary",
                    text: "hello",
                }),
                headers: { "Content-Type": "application/json" },
            }),
        );

        expect(response?.status).toBe(400);
        expect(flowRunner.saveArtifact).not.toHaveBeenCalled();
    });

    it("passes the active session through to artifact saves", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/flow/artifact", {
                method: "POST",
                body: JSON.stringify({
                    taskId: "task-1",
                    flowId: "flow-1",
                    actionEntryId: "entry-1",
                    sessionId: "session-1",
                    type: "summary",
                    text: 'line "one"\nline two',
                }),
                headers: { "Content-Type": "application/json" },
            }),
        );

        expect(response?.status).toBe(200);
        expect(flowRunner.saveArtifact).toHaveBeenCalledWith(
            "task-1",
            "flow-1",
            "entry-1",
            "session-1",
            {
                type: "summary",
                path: undefined,
                text: 'line "one"\nline two',
            },
        );
    });
});

describe("flow complete route", () => {
    let apiRouter: ApiRouter;
    const flowRunner = {
        completeFlow: mock(async () => {}),
    };

    beforeEach(() => {
        apiRouter = new ApiRouter();
        flowRunner.completeFlow.mockClear();
        registerApiRoutes({
            apiRouter,
            taskStore: {} as never,
            ptyManager: new FakePtyManager() as never,
            broadcast: () => {},
            settingsStore: {} as never,
            flowStore: {} as never,
            flowRunner: flowRunner as never,
            gitService: {} as never,
            agents: [],
            ...sharedTestDeps,
            trayStateTracker: new FakeTrayStateTracker() as never,
            notificationStore: {} as never,
        });
    });

    it("delegates a valid request to the runner", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/flow/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    taskId: "task-1",
                    flowId: "flow-1",
                    sessionId: "session-1",
                }),
            }),
        );

        expect(response?.status).toBe(200);
        expect(flowRunner.completeFlow).toHaveBeenCalledWith("task-1", "flow-1", "session-1");
    });

    it("accepts a project owner", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/flow/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    projectId: "project-1",
                    flowId: "flow-1",
                    sessionId: "session-1",
                }),
            }),
        );

        expect(response?.status).toBe(200);
        expect(flowRunner.completeFlow).toHaveBeenCalledWith("project-1", "flow-1", "session-1");
    });

    it("rejects a request with no owner", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/flow/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ flowId: "flow-1", sessionId: "session-1" }),
            }),
        );

        expect(response?.status).toBe(400);
        expect(flowRunner.completeFlow).not.toHaveBeenCalled();
    });

    it("rejects a request with no sessionId", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/flow/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ taskId: "task-1", flowId: "flow-1" }),
            }),
        );

        expect(response?.status).toBe(400);
        expect(flowRunner.completeFlow).not.toHaveBeenCalled();
    });

    it("rejects an invalid JSON body", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/flow/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "not json",
            }),
        );
        expect(response?.status).toBe(400);
        expect(flowRunner.completeFlow).not.toHaveBeenCalled();
    });
});

describe("task creation and cleanup routes", () => {
    let apiRouter: ApiRouter;
    let tempDir: string;
    let taskStore: TaskStore;
    let projectId: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-api-task-create-"));
        closeForOwner.mockClear();
        apiRouter = new ApiRouter();
        taskStore = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await taskStore.init();

        const projectPath = await realpath(
            await mkdir(join(tempDir, "project"), { recursive: true }).then(() =>
                join(tempDir, "project"),
            ),
        );
        const project = await taskStore.addProject({
            name: "project",
            path: projectPath,
            defaultInitCommand: "bun install",
        });
        projectId = project.id;

        registerApiRoutes({
            apiRouter,
            taskStore,
            ptyManager: new FakePtyManager() as never,
            broadcast: () => {},
            settingsStore: new SettingsStore(join(tempDir, "settings.json")),
            flowStore: { getFlowRunsForOwner: async () => [] } as never,
            flowRunner: {} as never,
            gitService: {} as never,
            agents: [],
            ...sharedTestDeps,
            trayStateTracker: new FakeTrayStateTracker() as never,
            notificationStore: {} as never,
        });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    for (const action of ["archive", "delete"] as const) {
        it(`closes browser tabs for a task and its subtasks on ${action}`, async () => {
            const parent = await taskStore.createTask({
                projectId,
                title: "Parent",
                description: "",
            });
            const child = await taskStore.createTask({
                projectId,
                parentId: parent.id,
                title: "Child",
                description: "",
            });
            const archivedChild = await taskStore.createTask({
                projectId,
                parentId: parent.id,
                title: "Archived",
                description: "",
            });
            await taskStore.archiveTask(archivedChild.id);
            const response = await apiRouter.handle(
                new Request(
                    `http://localhost/api/tasks/${parent.id}${action === "archive" ? "/archive" : ""}`,
                    { method: action === "archive" ? "POST" : "DELETE" },
                ),
            );
            expect(response?.status).toBe(200);
            const expected = [
                { taskId: child.id },
                ...(action === "delete" ? [{ taskId: archivedChild.id }] : []),
                { taskId: parent.id },
            ];
            expect(closeForOwner.mock.calls.map(([owner]) => owner)).toEqual(expected);
            if (action === "archive") {
                closeForOwner.mockClear();
                const deleted = await apiRouter.handle(
                    new Request(`http://localhost/api/tasks/${parent.id}`, { method: "DELETE" }),
                );
                expect(deleted?.status).toBe(200);
                expect(closeForOwner).toHaveBeenCalledWith({ taskId: parent.id });
                expect(closeForOwner).toHaveBeenCalledWith({ taskId: child.id });
                expect(closeForOwner).toHaveBeenCalledWith({ taskId: archivedChild.id });
            }
        });
    }

    it("closes project and task browser tabs on project removal", async () => {
        const first = await taskStore.createTask({ projectId, title: "First", description: "" });
        const second = await taskStore.createTask({ projectId, title: "Second", description: "" });
        const response = await apiRouter.handle(
            new Request(`http://localhost/api/projects/${projectId}`, { method: "DELETE" }),
        );
        expect(response?.status).toBe(200);
        expect(closeForOwner).toHaveBeenCalledTimes(3);
        expect(closeForOwner.mock.calls[0]).toEqual([{ projectId }]);
        expect(closeForOwner).toHaveBeenCalledWith({ taskId: first.id });
        expect(closeForOwner).toHaveBeenCalledWith({ taskId: second.id });
    });

    it("uses the project default init command for worktree task creation when none is provided", async () => {
        const response = await apiRouter.handle(
            new Request(`http://localhost/api/projects/${projectId}/tasks`, {
                method: "POST",
                body: JSON.stringify({
                    title: "Feature work",
                    description: "Investigate build issue",
                    worktree: true,
                }),
                headers: { "Content-Type": "application/json" },
            }),
        );

        expect(response?.status).toBe(201);
        const body = (await response?.json()) as { initCommand?: string };
        expect(body.initCommand).toBe("bun install");

        const emptyResponse = await apiRouter.handle(
            new Request(`http://localhost/api/projects/${projectId}/tasks`, {
                method: "POST",
                body: JSON.stringify({
                    title: "Feature work 2",
                    description: "Investigate another build issue",
                    worktree: true,
                    initCommand: "",
                }),
                headers: { "Content-Type": "application/json" },
            }),
        );

        expect(emptyResponse?.status).toBe(201);
        const emptyBody = (await emptyResponse?.json()) as { initCommand?: string };
        expect(emptyBody.initCommand).toBe("bun install");
    });
});

describe("session creation route", () => {
    let apiRouter: ApiRouter;
    let tempDir: string;
    let projectA: string;
    let projectB: string;
    let taskInB: string;
    let createdOwners: SessionOwnerRef[];

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-api-session-create-"));
        apiRouter = new ApiRouter();
        const taskStore = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await taskStore.init();
        await mkdir(join(tempDir, "a"));
        await mkdir(join(tempDir, "b"));
        projectA = (await taskStore.addProject({ name: "a", path: join(tempDir, "a") })).id;
        projectB = (await taskStore.addProject({ name: "b", path: join(tempDir, "b") })).id;
        taskInB = (
            await taskStore.createTask({ projectId: projectB, title: "t", description: "do it" })
        ).id;

        createdOwners = [];
        registerApiRoutes({
            apiRouter,
            taskStore,
            ptyManager: new FakePtyManager() as never,
            broadcast: () => {},
            settingsStore: new SettingsStore(join(tempDir, "settings.json")),
            flowStore: {} as never,
            flowRunner: {} as never,
            gitService: {} as never,
            agents: [{ type: "claude", available: true, path: "claude", version: "1" }],
            ...sharedTestDeps,
            sessionLifecycle: {
                ...sharedTestDeps.sessionLifecycle,
                createSession: async ({ owner }) => {
                    createdOwners.push(owner);
                    return "new-session";
                },
            },
            trayStateTracker: new FakeTrayStateTracker() as never,
            notificationStore: {} as never,
        });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    function post(body: Record<string, unknown>) {
        return apiRouter.handle(
            new Request("http://localhost/api/sessions", {
                method: "POST",
                body: JSON.stringify({ type: "claude", ...body }),
                headers: { "Content-Type": "application/json" },
            }),
        );
    }

    it("resolves the project from a task in another project", async () => {
        const response = await post({ taskId: taskInB });

        expect(response?.status).toBe(201);
        expect(createdOwners).toEqual([{ taskId: taskInB }]);
    });

    it("starts a project-level session in any existing project", async () => {
        const response = await post({ projectId: projectB });

        expect(response?.status).toBe(201);
        expect(createdOwners).toEqual([{ projectId: projectB }]);
    });

    it("rejects a task paired with a different project", async () => {
        const response = await post({ taskId: taskInB, projectId: projectA });

        expect(response?.status).toBe(400);
        expect(createdOwners).toEqual([]);
    });

    it("rejects an unknown project and a request with no owner", async () => {
        expect((await post({ projectId: "missing" }))?.status).toBe(404);
        expect((await post({}))?.status).toBe(400);
        expect(createdOwners).toEqual([]);
    });
});

describe("project reorder routes", () => {
    let apiRouter: ApiRouter;
    let tempDir: string;
    let taskStore: TaskStore;
    let events: WsEvent[];

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-api-project-reorder-"));
        apiRouter = new ApiRouter();
        events = [];
        taskStore = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await taskStore.init();

        registerApiRoutes({
            apiRouter,
            taskStore,
            ptyManager: new FakePtyManager() as never,
            broadcast: (event) => {
                events.push(event);
            },
            settingsStore: new SettingsStore(join(tempDir, "settings.json")),
            flowStore: {} as never,
            flowRunner: {} as never,
            gitService: {} as never,
            agents: [],
            ...sharedTestDeps,
            trayStateTracker: new FakeTrayStateTracker() as never,
            notificationStore: {} as never,
        });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("PATCH /api/projects/reorder reorders projects", async () => {
        const pathA = await realpath(
            await mkdir(join(tempDir, "proj-a"), { recursive: true }).then(() =>
                join(tempDir, "proj-a"),
            ),
        );
        const pathB = await realpath(
            await mkdir(join(tempDir, "proj-b"), { recursive: true }).then(() =>
                join(tempDir, "proj-b"),
            ),
        );
        const projectA = await taskStore.addProject({ name: "a", path: pathA });
        const projectB = await taskStore.addProject({ name: "b", path: pathB });

        const res = await apiRouter.handle(
            new Request("http://localhost/api/projects/reorder", {
                method: "PATCH",
                body: JSON.stringify({ orderedIds: [projectB.id, projectA.id] }),
                headers: { "Content-Type": "application/json" },
            }),
        );
        expect(res?.status).toBe(200);
        const body = (await res?.json()) as { projects: Array<{ id: string }> };
        expect(body.projects.map((p) => p.id)).toEqual([projectB.id, projectA.id]);
        expect(events).toEqual([
            {
                type: MSG.PROJECT_REORDERED,
                payload: { orderedIds: [projectB.id, projectA.id] },
            },
        ]);
    });

    it("PATCH /api/projects/reorder returns 400 for invalid body", async () => {
        const res = await apiRouter.handle(
            new Request("http://localhost/api/projects/reorder", {
                method: "PATCH",
                body: JSON.stringify({ orderedIds: "not-an-array" }),
                headers: { "Content-Type": "application/json" },
            }),
        );
        expect(res?.status).toBe(400);
    });
});

describe("project update routes", () => {
    let apiRouter: ApiRouter;
    let tempDir: string;
    let taskStore: TaskStore;
    let events: WsEvent[];
    let projectId: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-api-project-update-"));
        apiRouter = new ApiRouter();
        events = [];
        taskStore = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await taskStore.init();

        const projectPath = await realpath(
            await mkdir(join(tempDir, "project"), { recursive: true }).then(() =>
                join(tempDir, "project"),
            ),
        );
        const project = await taskStore.addProject({ name: "project", path: projectPath });
        projectId = project.id;

        registerApiRoutes({
            apiRouter,
            taskStore,
            ptyManager: new FakePtyManager() as never,
            broadcast: (event) => {
                events.push(event);
            },
            settingsStore: new SettingsStore(join(tempDir, "settings.json")),
            flowStore: {} as never,
            flowRunner: {} as never,
            gitService: {} as never,
            agents: [],
            ...sharedTestDeps,
            trayStateTracker: new FakeTrayStateTracker() as never,
            notificationStore: {} as never,
        });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("PATCH /api/projects/:id sets agentAccounts", async () => {
        const res = await apiRouter.handle(
            new Request(`http://localhost/api/projects/${projectId}`, {
                method: "PATCH",
                body: JSON.stringify({ agentAccounts: { codex: "x-work" } }),
                headers: { "Content-Type": "application/json" },
            }),
        );
        expect(res?.status).toBe(200);
        const body = (await res?.json()) as { agentAccounts?: Record<string, string> };
        expect(body.agentAccounts).toEqual({ codex: "x-work" });
    });

    it("PATCH /api/projects/:id returns 400 for an invalid agentAccounts shape", async () => {
        const res = await apiRouter.handle(
            new Request(`http://localhost/api/projects/${projectId}`, {
                method: "PATCH",
                body: JSON.stringify({ agentAccounts: "bad" }),
                headers: { "Content-Type": "application/json" },
            }),
        );
        expect(res?.status).toBe(400);
    });

    it("PATCH /api/projects/:id returns 400 for the inherit sentinel", async () => {
        const res = await apiRouter.handle(
            new Request(`http://localhost/api/projects/${projectId}`, {
                method: "PATCH",
                body: JSON.stringify({ agentAccounts: { claude: "inherit" } }),
                headers: { "Content-Type": "application/json" },
            }),
        );
        expect(res?.status).toBe(400);
    });

    it("PATCH /api/projects/:id keeps both overrides when two patches overlap", async () => {
        const patch = (agentAccounts: Record<string, string>) =>
            apiRouter.handle(
                new Request(`http://localhost/api/projects/${projectId}`, {
                    method: "PATCH",
                    body: JSON.stringify({ agentAccounts }),
                    headers: { "Content-Type": "application/json" },
                }),
            );
        const first = patch({ claude: "c-work" });
        const second = patch({ codex: "x-work" });
        const [resA, resB] = await Promise.all([first, second]);
        expect(resA?.status).toBe(200);
        expect(resB?.status).toBe(200);

        const res = await apiRouter.handle(new Request("http://localhost/api/projects"));
        const body = (await res?.json()) as {
            projects: Array<{ id: string; agentAccounts?: Record<string, string> }>;
        };
        const stored = body.projects.find((p) => p.id === projectId);
        expect(stored?.agentAccounts).toEqual({ claude: "c-work", codex: "x-work" });
    });
});
