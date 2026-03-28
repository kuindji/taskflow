import { MSG } from "@taskflow/shared";
import type { BrowserOpenPayload } from "@taskflow/shared";
import { ensureDirectories, config } from "./config";
import { Router } from "./ws/router";
import { createServer } from "./ws/server";
import { TaskStore } from "./services/task-store";
import { PtyManager } from "./services/pty-manager";
import { GitService } from "./services/git-service";
import { FileWatcher } from "./services/file-watcher";
import { detectEditors } from "./services/editor-detector";
import { detectShells, resolveSystemShellPath } from "./services/shell-detector";
import {
    detectRuntimes,
    detectAgents,
    fetchCursorModels,
    fetchOpenCodeModels,
} from "./services/runtime-detector";
import { registerProjectHandlers } from "./handlers/project";
import { registerTaskHandlers } from "./handlers/task";
import { registerSessionHandlers } from "./handlers/session";
import { registerFileHandlers } from "./handlers/file";
import { registerGitHandlers } from "./handlers/git";
import { registerSettingsHandlers } from "./handlers/settings";
import { registerScriptsHandlers } from "./handlers/scripts";
import { registerAgentCommandsHandlers } from "./handlers/agent-commands";
import { registerThemeHandlers } from "./handlers/theme";
import { SettingsStore } from "./services/settings-store";
import { ThemeService } from "./services/theme-service";
import { ApiRouter } from "./api/router";
import { registerApiRoutes } from "./api/routes";
import { createTitleGenerator } from "./services/title-generator";
import { createWorktreeSetup } from "./services/worktree-setup";
import { ChangeTracker } from "./services/change-tracker";
import { ensureCliScript } from "./services/internal-agent-skill";
import { FlowStore } from "./services/flow-store";
import { FlowRunner } from "./services/flow-runner";
import { createSessionLifecycle } from "./services/session-lifecycle";
import { registerFlowHandlers } from "./handlers/flow";
import { ScheduleStore } from "./services/schedule-store";
import { SchedulerService, SYSTEM_PROMPT_ADDON } from "./services/scheduler-service";
import { registerScheduleHandlers } from "./handlers/schedule";
import { buildShellPath } from "./services/shell-path";
import { TrayStateTracker } from "./services/tray-state-tracker";
import { NotificationStore } from "./services/notification-store";
import { registerNotificationHandlers } from "./handlers/notification";
import { RemoteAgentService } from "./services/remote-agent-service";
import { registerRemoteAgentHandlers } from "./handlers/remote-agent";
import { registerTypeScriptHandlers } from "./handlers/typescript";
import { writeFile } from "fs/promises";
import { homedir } from "os";

async function main() {
    await ensureDirectories();
    await ensureCliScript(config.binDir);
    let stop: (() => void) | undefined;

    try {
        const store = new TaskStore({
            projectsFile: config.projectsFile,
            tasksDir: config.tasksDir,
            archiveDir: config.archiveDir,
            sessionLogsDir: config.sessionLogsDir,
            taskLogsDir: config.taskLogsDir,
        });
        await store.init();
        await store.clearAllSessions(config.instanceId);
        await store.cleanupAllSessionLogs();
        await store.cleanExpiredArchives();

        const flowStore = new FlowStore(config.flowsDir, config.flowRunsDir);
        await flowStore.init();

        const notificationStore = new NotificationStore(config.notificationsFile);

        const ptyManager = new PtyManager();
        const gitService = new GitService();
        const fileWatcher = new FileWatcher();
        const settingsStore = new SettingsStore(config.settingsFile);
        const trayStateTracker = new TrayStateTracker();

        const shells = await detectShells();
        const systemShellPath = resolveSystemShellPath(shells);
        const editors = await detectEditors();

        const router = new Router();
        const apiRouter = new ApiRouter();
        const server = createServer(router, config.port, apiRouter);
        const changeTracker = new ChangeTracker(gitService, server.broadcast);
        server.onConnect(() => changeTracker.sendCurrentStats());
        let serverPort = config.port;

        const sessionLifecycle = createSessionLifecycle({
            ptyManager,
            taskStore: store,
            broadcast: server.broadcast,
            getPort: () => serverPort,
            detectedEditors: editors,
            trayStateTracker,
        });

        const scheduleStore = new ScheduleStore(config.schedulesFile);
        const schedulerService = new SchedulerService({
            scheduleStore,
            spawnSession: async (schedule) => {
                let prompt = schedule.prompt;
                let agentType: string = schedule.agentType ?? "claude";
                let agentOptions = schedule.agentOptions;

                if (schedule.actionId) {
                    const actions = await flowStore.getActions();
                    const action = actions.find((a) => a.id === schedule.actionId);
                    if (action) {
                        prompt = action.prompt;
                        agentType = action.sessionType;
                        agentOptions = action.agentOptions;
                    }
                }

                return sessionLifecycle.createSession({
                    owner: { projectId: schedule.projectId },
                    type: agentType as
                        | "claude"
                        | "codex"
                        | "opencode"
                        | "gemini"
                        | "cursor"
                        | "shell",
                    label: `[Scheduled] ${schedule.name}`,
                    prompt,
                    systemPrompt: SYSTEM_PROMPT_ADDON,
                    agentOptions,
                    internal: true,
                    onSessionExited: (sessionId, exitCode) => {
                        void schedulerService.handleSessionExit(sessionId, exitCode);
                    },
                });
            },
            closeSession: (sessionId) => {
                ptyManager.close(sessionId);
            },
            broadcast: server.broadcast,
        });

        async function logToTask(
            taskId: string,
            type: "info" | "warning",
            message: string,
        ): Promise<void> {
            try {
                await store.appendTaskLog(taskId, "system", type, message);
            } catch {
                // Best-effort logging
            }
        }

        const worktreeSetup = createWorktreeSetup({
            taskStore: store,
            gitService,
            broadcast: server.broadcast,
            changeTracker,
            createSession: (opts) => sessionLifecycle.createSession(opts),
            ptyManager,
            systemShellPath,
            logToTask,
        });

        const titleGenerator = createTitleGenerator({
            taskStore: store,
            broadcast: server.broadcast,
            createWorktree: worktreeSetup.createWorktreeForTask,
        });

        // FlowRunner is referenced inside its own spawnSession callback (for
        // handleSessionExit) — the closure captures the variable, not the value,
        // so `const` is safe here since the callback is only invoked later.
        const flowRunner = new FlowRunner({
            flowStore,
            spawnSession: async (opts) => {
                const owner = opts.owner.taskId
                    ? { taskId: opts.owner.taskId }
                    : opts.owner.master
                      ? { master: true as const }
                      : { projectId: opts.owner.projectId };
                return sessionLifecycle.createSession({
                    owner,
                    type: opts.sessionType,
                    label: opts.label,
                    prompt: opts.prompt,
                    systemPrompt: opts.systemPrompt,
                    shell:
                        opts.sessionType === "shell" ? (systemShellPath ?? undefined) : undefined,
                    agentOptions: opts.agentOptions,
                    flow: {
                        flowId: opts.flowId,
                        actionEntryId: opts.actionEntryId,
                    },
                    onSessionExited: (sessionId, exitCode) => {
                        void flowRunner.handleSessionExit(sessionId, exitCode);
                    },
                });
            },
            closeSession: (sessionId) => {
                ptyManager.close(sessionId);
            },
            broadcast: server.broadcast,
            getOwnerDescription: async (owner) => {
                if (owner.taskId) {
                    const task = await store.getTask(owner.taskId);
                    return task?.description ?? "";
                }
                if (owner.master) return "Master workspace";
                const projectId = owner.projectId;
                if (!projectId) return "";
                const project = await store.getProject(projectId);
                return project?.name ?? "";
            },
        });

        // Recover flow runs stuck in "running" from a previous process crash
        const activeRuns = await flowStore.getAllActiveRuns();
        for (const run of activeRuns) {
            if (run.status === "running") {
                run.status = "paused";
                const currentAction = run.actions[run.currentActionIndex];
                if (currentAction?.status === "running") {
                    currentAction.status = "failed";
                    currentAction.completedAt = new Date().toISOString();
                    currentAction.sessionId = undefined;
                }
                await flowStore.saveFlowRun(run);
            }
        }

        registerProjectHandlers(
            router,
            store,
            gitService,
            (sessionId) => {
                ptyManager.close(sessionId);
            },
            changeTracker,
        );
        registerTaskHandlers({
            router,
            store,
            gitService,
            closeSession: (sessionId) => {
                ptyManager.close(sessionId);
            },
            generateTitle: (taskId, description, initCommand) => {
                void titleGenerator.generate(taskId, description, initCommand);
            },
            createWorktree: (taskId, nameSource, initCommand) => {
                void worktreeSetup.createWorktreeForTask(taskId, nameSource, initCommand);
            },
            flowStore,
            flowRunner,
            changeTracker,
        });
        const agents = await detectAgents();
        registerSessionHandlers({
            router,
            ptyManager,
            taskStore: store,
            sessionLifecycle,
        });
        registerFileHandlers({
            router,
            fileWatcher,
            taskStore: store,
            broadcast: server.broadcast,
            changeTracker,
        });
        registerGitHandlers({
            router,
            git: gitService,
            taskStore: store,
            broadcast: server.broadcast,
            changeTracker,
        });
        registerTypeScriptHandlers({
            router,
            taskStore: store,
        });

        const themeService = new ThemeService(config.themesDir);
        registerSettingsHandlers({ router, settingsStore, taskStore: store });
        registerThemeHandlers(router, themeService);
        registerScriptsHandlers(router);
        registerAgentCommandsHandlers(router);
        registerFlowHandlers({ router, flowStore, flowRunner });
        registerNotificationHandlers({
            router,
            notificationStore,
            broadcast: server.broadcast,
        });
        const generateScheduleName = async (prompt: string): Promise<string> => {
            try {
                const { CLAUDECODE: _a, CLAUDE_CODE_ENTRYPOINT: _b, ...cleanEnv } = process.env;
                const aiPrompt = `Generate a concise schedule name (3-7 words) for this scheduled task prompt. Output ONLY the name, nothing else. No quotes, no punctuation at the end.\n\nPrompt: ${prompt}`;
                const proc = Bun.spawn(["claude", "-p", "--model", "haiku"], {
                    stdin: "pipe",
                    stdout: "pipe",
                    stderr: "pipe",
                    env: { ...cleanEnv, PATH: buildShellPath() },
                });
                void proc.stdin.write(aiPrompt);
                void proc.stdin.end();
                const output = await new Response(proc.stdout).text();
                const exitCode = await proc.exited;
                if (exitCode === 0 && output.trim()) {
                    return output.trim().replace(/^["']|["']$/g, "");
                }
            } catch {
                // Fall through to fallback
            }
            return prompt.slice(0, 50).trim() || "Unnamed schedule";
        };

        registerScheduleHandlers({
            router,
            scheduleStore,
            schedulerService,
            flowStore,
            generateName: generateScheduleName,
        });

        const remoteAgentService = new RemoteAgentService({
            settingsStore,
            ptyManager,
            sessionLifecycle,
            broadcast: server.broadcast,
            agents,
        });
        registerRemoteAgentHandlers({ router, remoteAgentService });

        const runtimes = await detectRuntimes();

        registerApiRoutes({
            apiRouter,
            taskStore: store,
            ptyManager,
            broadcast: server.broadcast,
            settingsStore,
            flowStore,
            flowRunner,
            gitService,
            generateTitle: (taskId, description, initCommand) => {
                void titleGenerator.generate(taskId, description, initCommand);
            },
            createWorktree: worktreeSetup.createWorktreeForTask,
            changeTracker,
            agents,
            sessionLifecycle,
            schedulerService,
            trayStateTracker,
            notificationStore,
            scheduleStore,
            shells,
            systemShellPath,
            runtimes,
            editors,
            generateScheduleName,
            remoteAgentService,
        });

        router.register(MSG.BROWSER_OPEN, async (payload) => {
            const typed = payload as BrowserOpenPayload;
            server.broadcast({ type: MSG.BROWSER_OPEN, payload: typed });
            return { success: true };
        });

        router.register(MSG.SYSTEM_INFO, async () => ({ editors, homedir: homedir() }));
        router.register(MSG.SHELLS_LIST, async () => ({
            shells,
            systemShellPath,
        }));
        router.register(MSG.RUNTIMES_LIST, async () => ({ runtimes }));
        router.register(MSG.AGENTS_LIST, async () => ({ agents }));
        router.register(MSG.CURSOR_MODELS, async () => ({ models: await fetchCursorModels() }));
        router.register(MSG.OPENCODE_MODELS, async () => ({
            models: await fetchOpenCodeModels(),
        }));

        console.log(`Detected shells: ${shells.map((s) => s.name).join(", ") || "none"}`);
        console.log(
            `Detected runtimes: ${runtimes.map((r) => r.name + " " + r.version).join(", ") || "none"}`,
        );
        console.log(
            `Detected agents: ${
                agents
                    .filter((a) => a.available)
                    .map((a) => a.type + " " + a.version)
                    .join(", ") || "none"
            }`,
        );

        const startedServer = await server.start();
        serverPort = startedServer.port;
        stop = startedServer.stop;

        await writeFile(config.portFile, String(startedServer.port));
        console.log(`Taskflow backend running on port ${startedServer.port}`);
        console.log(`Detected editors: ${editors.map((e) => e.name).join(", ") || "none"}`);

        // Initialize scheduler after server is running
        await schedulerService.init();

        // Auto-start remote agent if enabled
        void remoteAgentService.autoStartIfEnabled();

        // Register projects for change tracking
        const initialProjects = await store.listProjects();
        for (const project of initialProjects) {
            if (project.locationValid !== false) {
                changeTracker.track(project.id, project.path);
            }
        }

        // Register worktree tasks for change tracking
        const allTasks = await store.listTasks();
        for (const task of allTasks) {
            if (task.worktree.enabled && task.worktree.path && !task.parentId) {
                changeTracker.track(task.id, task.worktree.path);
            }
        }

        const shutdown = () => {
            schedulerService.shutdown();
            changeTracker.dispose();
            ptyManager.closeAll();
            void fileWatcher.stopAll();
            stop?.();
            process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
    } catch (error) {
        stop?.();
        throw error;
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
