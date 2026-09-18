import { describe, it, expect, beforeEach, afterEach } from "bun:test";

const isWindows = process.platform === "win32";
const testShell = isWindows ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh";
import { registerSessionHandlers } from "../../src/handlers/session";
import { registerTaskHandlers } from "../../src/handlers/task";
import { registerProjectHandlers } from "../../src/handlers/project";
import { TestRouter } from "../test-router";
import { TaskStore } from "../../src/services/task-store";
import { createSessionLifecycle } from "../../src/services/session-lifecycle";
import { mkdtemp, mkdir, rm, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import { GitService } from "../../src/services/git-service";
import { TrayStateTracker } from "../../src/services/tray-state-tracker";
import { SettingsStore } from "../../src/services/settings-store";
import { config } from "../../src/config";
import { inheritedAgentHome } from "../../src/services/agent-accounts";

class FakePtyManager {
    private nextId = 0;
    private sessions = new Map<
        string,
        { onData: (data: string, sequence: number) => void; onExit: (exitCode: number) => void }
    >();
    private sequenceBySession = new Map<string, number>();
    closed: string[] = [];
    spawns: Array<{
        id: string;
        cwd?: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        initialOutput?: string;
        startSequence?: number;
        cols?: number;
        rows?: number;
    }> = [];

    spawn(options: {
        id?: string;
        cwd?: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        initialOutput?: string;
        startSequence?: number;
        cols?: number;
        rows?: number;
        onData: (data: string, sequence: number) => void;
        onExit: (exitCode: number) => void;
    }): string {
        const id = options.id ?? `session-${(this.nextId += 1)}`;
        this.sessions.set(id, options);
        this.sequenceBySession.set(id, 0);
        this.spawns.push({
            id,
            cwd: options.cwd,
            command: options.command,
            args: options.args,
            env: options.env,
            initialOutput: options.initialOutput,
            startSequence: options.startSequence,
            cols: options.cols,
            rows: options.rows,
        });
        return id;
    }

    write(): void {}

    resize(): void {}

    has(id: string): boolean {
        return this.sessions.has(id);
    }

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

    getSnapshot(id: string): { snapshot: string | null; lastSequence: number } {
        const session = this.sessions.get(id);
        if (!session) return { snapshot: null, lastSequence: 0 };
        return {
            snapshot: `[snapshot:${id}]`,
            lastSequence: this.sequenceBySession.get(id) ?? 0,
        };
    }
}

describe("session handlers", () => {
    let router: TestRouter;
    let store: TaskStore;
    let tempDir: string;
    let projectId: string;
    let ptyManager: FakePtyManager;
    let events: { type: string; payload: unknown }[];
    let discoveryHomes: Array<string | undefined>;
    let settingsStore: SettingsStore;
    let sessionLifecycle: ReturnType<typeof createSessionLifecycle>;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-session-test-"));
        tempDir = await realpath(tempDir);
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
        router = new TestRouter();
        ptyManager = new FakePtyManager();
        events = [];
        discoveryHomes = [];

        registerProjectHandlers(router, store, new GitService());
        registerTaskHandlers({
            router,
            store,
            gitService: new GitService(),
            closeSession: (sessionId) => {
                ptyManager.close(sessionId);
            },
        });
        settingsStore = new SettingsStore(join(tempDir, "settings.json"));
        sessionLifecycle = createSessionLifecycle({
            ptyManager: ptyManager as never,
            taskStore: store,
            settingsStore,
            broadcast: (event) => {
                events.push(event);
            },
            getPort: () => 0,
            detectedEditors: [],
            trayStateTracker: new TrayStateTracker(),
            nativeSessionDiscovery: {
                acquire: async (_type, homeDir) => {
                    discoveryHomes.push(homeDir);
                    return async () => {};
                },
                capture: async () => new Set<string>(),
                discover: async () => null,
            },
        });
        registerSessionHandlers({
            router,
            ptyManager: ptyManager as never,
            taskStore: store,
            sessionLifecycle,
        });

        const projectDir = join(tempDir, "project");
        await mkdir(projectDir, { recursive: true });
        const project = await store.addProject({ name: "project", path: projectDir });
        projectId = project.id;
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    /**
     * Spawn records without `env`, which every session now carries. Everything
     * else stays pinned, so a stray `initialOutput`/`startSequence`/`cols`/`rows`
     * on a fresh (non-resume) launch still fails these assertions.
     */
    function spawnIdentities(): Array<Omit<FakePtyManager["spawns"][number], "env">> {
        return ptyManager.spawns.map(({ env: _env, ...rest }) => rest);
    }

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
            payload: { sessionId: created.sessionId, status: "initializing" },
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

    it("uses the task worktree path as the session cwd when available", async () => {
        const task = await store.createTask({
            projectId,
            title: "Task",
            description: "test",
            worktree: {
                enabled: true,
                path: join(tempDir, "project", ".worktrees", "task"),
                branch: "task/task",
                pr: null,
            },
        });

        const created = (await router.handle(MSG.SESSION_CREATE, {
            taskId: task.id,
            type: "shell",
            shell: testShell,
        })) as { sessionId: string };

        expect(spawnIdentities()).toContainEqual({
            id: created.sessionId,
            cwd: join(tempDir, "project", ".worktrees", "task"),
            command: testShell,
            args: [],
        });
    });

    it("defaults agent session labels to the agent name", async () => {
        await router.handle(MSG.SESSION_CREATE, {
            projectId,
            type: "codex",
        });
        await router.handle(MSG.SESSION_CREATE, {
            projectId,
            type: "claude",
        });

        const project = await store.getProject(projectId);
        expect(project?.sessions.map((session) => session.label)).toEqual(["Codex", "Claude"]);
    });

    it("lets an explicit Claude manual mode override a bypass default", async () => {
        await settingsStore.update({ claude: { permissionMode: "bypassPermissions" } });

        await router.handle(MSG.SESSION_CREATE, {
            projectId,
            type: "claude",
            agentOptions: { type: "claude", permissionMode: "manual" },
        });

        const args = ptyManager.spawns.at(-1)?.args ?? [];
        expect(args).toContain("--permission-mode");
        expect(args).toContain("default");
        expect(args).not.toContain("bypassPermissions");
        expect(args).not.toContain("--dangerously-skip-permissions");
    });

    it("passes Claude's native Remote Control launch flag", async () => {
        await sessionLifecycle.createSession({
            owner: { master: true },
            type: "claude",
            cwd: tempDir,
            remoteControl: true,
            sessionName: "Taskflow Test",
            internal: true,
        });

        const args = ptyManager.spawns.at(-1)?.args ?? [];
        expect(args).toContain("--remote-control");
        expect(args).toContain("--name");
        expect(args).toContain("Taskflow Test");
    });

    it("uses the configured root as the default master-session cwd", async () => {
        const created = (await router.handle(MSG.SESSION_CREATE, {
            master: true,
            type: "shell",
            shell: testShell,
        })) as { sessionId: string };

        expect(spawnIdentities()).toContainEqual({
            id: created.sessionId,
            cwd: config.baseDir,
            command: testShell,
            args: [],
        });
    });

    it("rejects invalid Claude launch options before spawning a session", async () => {
        let error: unknown;
        try {
            await router.handle(MSG.SESSION_CREATE, {
                projectId,
                type: "claude",
                agentOptions: { type: "claude", permissionMode: "reckless" },
            });
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("permissionMode");
        expect(ptyManager.spawns).toHaveLength(0);
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

    it("returns session history while session is active and cleans up after exit", async () => {
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

        expect(
            await router.handle(MSG.SESSION_HISTORY, {
                taskId: task.id,
                sessionId: created.sessionId,
            }),
        ).toEqual({
            data: "step 1\nstep 2\n",
            lastSequence: 2,
        });

        await router.handle(MSG.SESSION_CLOSE, { sessionId: created.sessionId });

        expect(
            await router.handle(MSG.SESSION_HISTORY, {
                taskId: task.id,
                sessionId: created.sessionId,
            }),
        ).toEqual({
            data: "",
            lastSequence: 0,
        });
    });

    it("returns snapshot for active session", async () => {
        const task = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "Task",
        })) as { id: string };
        const created = (await router.handle(MSG.SESSION_CREATE, {
            taskId: task.id,
            type: "codex",
        })) as { sessionId: string };

        const result = await router.handle(MSG.SESSION_SNAPSHOT, {
            sessionId: created.sessionId,
        });
        expect(result).toEqual({
            snapshot: `[snapshot:${created.sessionId}]`,
            lastSequence: 0,
        });
    });

    it("returns session history for project-level sessions and cleans up after exit", async () => {
        const created = (await router.handle(MSG.SESSION_CREATE, {
            projectId,
            type: "codex",
        })) as { sessionId: string };

        ptyManager.emit(created.sessionId, "project step\n");

        expect(
            await router.handle(MSG.SESSION_HISTORY, {
                projectId,
                sessionId: created.sessionId,
            }),
        ).toEqual({
            data: "project step\n",
            lastSequence: 1,
        });

        await router.handle(MSG.SESSION_CLOSE, { sessionId: created.sessionId });

        expect(
            await router.handle(MSG.SESSION_HISTORY, {
                projectId,
                sessionId: created.sessionId,
            }),
        ).toEqual({
            data: "",
            lastSequence: 0,
        });
    });

    it("resumes an interrupted agent with its native ID and retained transcript", async () => {
        const task = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "Task",
        })) as { id: string };
        const project = await store.getProject(projectId);
        await store.appendSessionOutput(task.id, "taskflow-session", 7, "retained output\n");
        await store.updateTask(task.id, {
            sessions: [
                {
                    id: "taskflow-session",
                    type: "codex",
                    label: "Codex",
                    createdAt: new Date().toISOString(),
                    instance: config.instanceId,
                    bootId: "previous-boot",
                    state: "interrupted",
                    nativeSessionId: "native-session",
                    cwd: project!.path,
                    agentOptions: { type: "codex" },
                },
            ],
        });

        const response = (await router.handle(MSG.SESSION_RESUME, {
            sessionId: "taskflow-session",
            cols: 142,
            rows: 38,
        })) as { sessionId: string };

        expect(response.sessionId).toBe("taskflow-session");
        const spawn = ptyManager.spawns.at(-1)!;
        expect(spawn.args?.slice(0, 2)).toEqual(["resume", "native-session"]);
        expect(spawn.initialOutput).toBe("retained output\n");
        expect(spawn.startSequence).toBe(7);
        expect(spawn.cols).toBe(142);
        expect(spawn.rows).toBe(38);
        const updated = await store.getTask(task.id);
        expect(updated?.sessions[0].state).toBe("live");
        expect(updated?.sessions[0].nativeSessionId).toBe("native-session");
        expect(updated?.sessions[0].bootId).toBe(config.bootId);
    });

    async function addAccounts(): Promise<void> {
        await settingsStore.update({
            claude: { accounts: [{ id: "c-work", name: "work", homeDir: "/homes/claude-work" }] },
            codex: { accounts: [{ id: "x-work", name: "work", homeDir: "/homes/codex-work" }] },
        });
    }

    it("launches Claude with the chosen account's config dir and records it", async () => {
        await addAccounts();
        await router.handle(MSG.SESSION_CREATE, {
            projectId,
            type: "claude",
            agentOptions: { type: "claude", account: "c-work" },
        });

        const spawn = ptyManager.spawns.at(-1)!;
        expect(spawn.env?.CLAUDE_CONFIG_DIR).toBe("/homes/claude-work");
        const project = await store.getProject(projectId);
        expect(project?.sessions.at(-1)?.agentHomeDir).toBe("/homes/claude-work");
        expect(project?.sessions.at(-1)?.agentOptions).toMatchObject({ account: "c-work" });
        expect(project?.sessions.at(-1)?.label).toBe("Claude · work");
    });

    it("uses the project account and lets an explicit default override it", async () => {
        await addAccounts();
        await store.updateProject(projectId, { agentAccounts: { codex: "x-work" } });

        await router.handle(MSG.SESSION_CREATE, { projectId, type: "codex" });
        expect(ptyManager.spawns.at(-1)?.env?.CODEX_HOME).toBe("/homes/codex-work");
        expect(discoveryHomes.at(-1)).toBe("/homes/codex-work");

        await router.handle(MSG.SESSION_CREATE, {
            projectId,
            type: "codex",
            agentOptions: { type: "codex", account: "default" },
        });
        expect(ptyManager.spawns.at(-1)?.env?.CODEX_HOME).toBeUndefined();
        const project = await store.getProject(projectId);
        expect(project?.sessions.at(-1)?.agentHomeDir).toBe(inheritedAgentHome("codex"));
        expect(project?.sessions.at(-1)?.label).toBe("Codex");
    });

    it("fails the launch for an unknown account without spawning", async () => {
        const before = ptyManager.spawns.length;
        let error: unknown;
        try {
            await router.handle(MSG.SESSION_CREATE, {
                projectId,
                type: "claude",
                agentOptions: { type: "claude", account: "missing" },
            });
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Unknown Claude account "missing"');
        expect(ptyManager.spawns.length).toBe(before);
    });

    it("resumes with the saved home dir even after the account is deleted", async () => {
        const task = (await router.handle(MSG.TASK_CREATE, {
            projectId,
            title: "Task",
        })) as { id: string };
        const project = await store.getProject(projectId);
        await store.updateTask(task.id, {
            sessions: [
                {
                    id: "resumable",
                    type: "codex",
                    label: "Codex · work",
                    createdAt: new Date().toISOString(),
                    instance: config.instanceId,
                    bootId: "previous-boot",
                    state: "interrupted",
                    nativeSessionId: "native",
                    cwd: project!.path,
                    agentOptions: { type: "codex", account: "x-deleted" },
                    agentHomeDir: "/homes/codex-old",
                },
            ],
        });

        await router.handle(MSG.SESSION_RESUME, { sessionId: "resumable" });

        const spawn = ptyManager.spawns.at(-1)!;
        expect(spawn.env?.CODEX_HOME).toBe("/homes/codex-old");
        const updated = await store.getTask(task.id);
        expect(updated?.sessions[0].agentHomeDir).toBe("/homes/codex-old");
        expect(updated?.sessions[0].label).toBe("Codex · work");
    });
});
