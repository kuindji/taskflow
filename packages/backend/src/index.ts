import { DISCOVERY_MAX_DISPLAY_NAME, MSG, PROTOCOL_VERSION, isAgentType } from "@taskflow/shared";
import type { BrowserOpenPayload, NetworkSettings, SystemClientsEvent } from "@taskflow/shared";
import { createAdvertiser } from "@taskflow/shared/discovery";
import appPackage from "../../../electron/package.json";
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
    fetchCodexModels,
    fetchOpenCodeModels,
    fetchPiModels,
    fetchKimiModels,
} from "./services/runtime-detector";
import { registerProjectHandlers } from "./handlers/project";
import { registerTaskHandlers } from "./handlers/task";
import { registerAttributeHandlers } from "./handlers/attribute";
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
import { headlessClaudeEnv } from "./services/agent-accounts";
import { TrayStateTracker } from "./services/tray-state-tracker";
import { NotificationStore } from "./services/notification-store";
import { registerNotificationHandlers } from "./handlers/notification";
import { RemoteAgentService } from "./services/remote-agent-service";
import { ConnectivityService } from "./services/connectivity-service";
import { registerRemoteAgentHandlers } from "./handlers/remote-agent";
import { registerTypeScriptHandlers } from "./handlers/typescript";
import { registerSearchHandlers } from "./handlers/search";
import { WikiIndexService } from "./services/wiki-index";
import { registerWikiHandlers } from "./handlers/wiki";
import { registerSystemHandlers } from "./handlers/system";
import { writeFile } from "fs/promises";
import { releaseInstancePort, writeInstancePortFile } from "./services/instance-port-file";
import { homedir, hostname } from "os";

/** Informational only; compatibility is decided by PROTOCOL_VERSION. Read from
 *  the file electron-builder ships, because that is the only version bumped per
 *  release — a literal here silently drifts. `bun build --compile` inlines a
 *  JSON import, so this survives into the packaged binary. */
const APP_VERSION: string = appPackage.version;

async function main() {
    await ensureDirectories();
    await ensureCliScript(config.binDir);
    let stop: (() => void) | undefined;
    // Set once the stable port file names this backend, so a startup failure
    // after that point does not leave it pointing at a dead port.
    let advertisedPort: number | undefined;

    try {
        const store = new TaskStore({
            projectsFile: config.projectsFile,
            tasksDir: config.tasksDir,
            archiveDir: config.archiveDir,
            sessionLogsDir: config.sessionLogsDir,
            taskLogsDir: config.taskLogsDir,
            masterSessionsFile: config.masterSessionsFile,
        });
        await store.init();
        await store.reconcileInterruptedSessions(config.instanceId, config.bootId);
        await store.cleanExpiredArchives();
        const sweptLogs = await store.sweepOrphanSessionLogs();
        if (sweptLogs > 0) console.log(`Removed ${sweptLogs} orphaned session log(s)`);

        const flowStore = new FlowStore(config.flowsDir, config.flowRunsDir, config.instanceId);
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
        const wikiIndex = new WikiIndexService({
            onChange: (data) => server.broadcast({ type: MSG.WIKI_INDEX_CHANGED, payload: data }),
        });
        server.onConnect(() => changeTracker.sendCurrentStats());
        server.onDisconnect((clientId) => {
            void fileWatcher.releaseClient(clientId);
        });
        let serverPort = config.port;

        const sessionLifecycle = createSessionLifecycle({
            ptyManager,
            taskStore: store,
            settingsStore,
            broadcast: server.broadcast,
            getPort: () => serverPort,
            detectedEditors: editors,
            trayStateTracker,
        });

        const connectivityService = new ConnectivityService();
        await connectivityService.init();

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

                let sessionType: "shell" | import("@taskflow/shared").AgentType;
                if (agentType === "shell") {
                    sessionType = "shell";
                } else if (isAgentType(agentType)) {
                    sessionType = agentType;
                } else {
                    // Persisted schedules may reference removed agent types;
                    // the scheduler records this as the run's lastError.
                    throw new Error(`Unsupported agent type: ${agentType}`);
                }
                const isShell = sessionType === "shell";

                const sessionId = await sessionLifecycle.createSession({
                    owner: { projectId: schedule.projectId },
                    type: sessionType,
                    label: `[Scheduled] ${schedule.name}`,
                    prompt,
                    systemPrompt: isShell ? undefined : SYSTEM_PROMPT_ADDON,
                    agentOptions,
                    internal: true,
                    onSessionExited: (sessionId, exitCode) => {
                        void schedulerService.handleSessionExit(sessionId, exitCode);
                    },
                });

                return { sessionId, isShell };
            },
            closeSession: (sessionId) => {
                ptyManager.close(sessionId);
            },
            broadcast: server.broadcast,
            isOnline: () => connectivityService.isOnline,
            enabled: config.instanceId === "main",
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
            settingsStore,
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

        const [recoveryTasks, recoveryProjects] = await Promise.all([
            store.listTasks(),
            store.listProjects(),
        ]);
        const recoverableFlowSessionIds = new Set(
            [
                ...recoveryTasks.flatMap((task) => task.sessions),
                ...recoveryProjects.flatMap((project) => project.sessions),
                ...store.getMasterSessions(),
            ]
                .filter(
                    (session) =>
                        session.instance === config.instanceId &&
                        session.state === "interrupted" &&
                        Boolean(session.nativeSessionId),
                )
                .map((session) => session.id),
        );
        await flowRunner.recoverInterruptedRuns(recoverableFlowSessionIds);
        sessionLifecycle.setRecoveredSessionResumeHandler((session) =>
            flowRunner.prepareInterruptedSessionResume(session),
        );
        sessionLifecycle.setRecoveredSessionExitHandler((_session, _owner, exitCode) => {
            void flowRunner.handleSessionExit(_session.id, exitCode);
        });

        registerProjectHandlers(
            router,
            store,
            gitService,
            (sessionId) => {
                ptyManager.close(sessionId);
            },
            changeTracker,
            server.broadcast,
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
        registerAttributeHandlers({ router, store, broadcast: server.broadcast });
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
        registerWikiHandlers({ router, taskStore: store, wikiIndex });
        registerGitHandlers({
            router,
            git: gitService,
            taskStore: store,
            broadcast: server.broadcast,
            settingsStore,
            changeTracker,
        });
        registerTypeScriptHandlers({
            router,
            taskStore: store,
        });
        registerSearchHandlers({
            router,
            taskStore: store,
        });

        const themeService = new ThemeService(config.themesDir);
        registerSettingsHandlers({ router, settingsStore, taskStore: store });
        registerThemeHandlers(router, themeService);
        registerScriptsHandlers(router);
        registerAgentCommandsHandlers({ router, taskStore: store, settingsStore });
        registerFlowHandlers({ router, flowStore, flowRunner });
        registerNotificationHandlers({
            router,
            notificationStore,
            broadcast: server.broadcast,
        });
        const generateScheduleName = async (prompt: string): Promise<string> => {
            try {
                const aiPrompt = `Generate a concise schedule name (3-7 words) for this scheduled task prompt. Output ONLY the name, nothing else. No quotes, no punctuation at the end.\n\nPrompt: ${prompt}`;
                const proc = Bun.spawn(["claude", "-p", "--model", "haiku"], {
                    stdin: "pipe",
                    stdout: "pipe",
                    stderr: "pipe",
                    env: headlessClaudeEnv(await settingsStore.get(), null),
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
            isOnline: () => connectivityService.isOnline,
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

        registerSystemHandlers({
            router,
            editors,
            homedir: homedir(),
            schedulerEnabled: config.instanceId === "main",
            hostname: hostname(),
            protocolVersion: PROTOCOL_VERSION,
            backendUid: config.backendUid,
        });
        // Broadcast on every connect and disconnect as well, but a client
        // cannot hear the broadcast announcing its own arrival, so it asks
        // once on startup and follows the broadcasts after that.
        router.register(MSG.SYSTEM_CLIENTS, async (): Promise<SystemClientsEvent> => ({
            count: server.clientCount(),
        }));
        router.register(MSG.SHELLS_LIST, async () => ({
            shells,
            systemShellPath,
        }));
        router.register(MSG.RUNTIMES_LIST, async () => ({ runtimes }));
        router.register(MSG.AGENTS_LIST, async () => ({ agents }));
        router.register(MSG.CODEX_MODELS, async () => ({ models: await fetchCodexModels() }));
        router.register(MSG.OPENCODE_MODELS, async () => ({
            models: await fetchOpenCodeModels(),
        }));
        router.register(MSG.PI_MODELS, async () => ({
            models: await fetchPiModels(),
        }));
        router.register(MSG.KIMI_MODELS, async () => ({
            models: await fetchKimiModels(),
        }));
        router.register(MSG.CONNECTIVITY_STATUS, async () => ({
            online: connectivityService.isOnline,
        }));
        router.register(MSG.CONNECTIVITY_RECHECK, async () => ({
            online: await connectivityService.refresh(),
        }));

        connectivityService.onChange((online) => {
            server.broadcast({
                type: MSG.CONNECTIVITY_STATUS_CHANGED,
                payload: { online },
            });
            if (online) {
                if (config.instanceId === "main") void schedulerService.resumeDeferred();
                if (config.instanceId === "main") {
                    void remoteAgentService.retryAutoStartIfEnabled();
                }
            }
        });

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
        await writeInstancePortFile(config.instancePortFile, startedServer.port);
        advertisedPort = startedServer.port;
        console.log(`Taskflow backend running on port ${startedServer.port}`);
        console.log(`Detected editors: ${editors.map((e) => e.name).join(", ") || "none"}`);

        let network = (await settingsStore.get()).network;

        const advertiser = createAdvertiser({
            payload: () => ({
                v: 1 as const,
                protocolVersion: PROTOCOL_VERSION,
                instanceId: config.instanceId,
                hostname: hostname(),
                // Clamped here as well as in the Settings input, because
                // `settings.json` is a file a user can edit and this is the
                // last point before the bytes go on the wire. Over the cap the
                // announcement is unparsable and this backend silently
                // disappears from every other machine's menu.
                displayName: (network.displayName.trim() || hostname()).slice(
                    0,
                    DISCOVERY_MAX_DISPLAY_NAME,
                ),
                port: startedServer.port,
                appVersion: APP_VERSION,
                os: process.platform,
                backendUid: config.backendUid,
            }),
        });

        // The setting is a switch, not a boot flag: toggling it in Settings has
        // to start or stop the beacon without a restart, and the next announce
        // has to pick up a renamed backend. `payload` is called per announce,
        // so keeping `network` current is all the rename needs.
        async function applyNetworkSettings(next: NetworkSettings): Promise<void> {
            network = next;
            if (next.discoverable) await advertiser.start();
            else advertiser.stop();
        }

        await applyNetworkSettings(network);
        settingsStore.onUpdated((settings) => void applyNetworkSettings(settings.network));

        // Initialize scheduler after server is running
        await schedulerService.init();

        // Auto-start remote agent if enabled
        if (config.instanceId === "main") {
            void remoteAgentService.autoStartIfEnabled();
        }

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

        let shuttingDown = false;
        const shutdown = async () => {
            if (shuttingDown) return;
            shuttingDown = true;
            try {
                await sessionLifecycle.prepareForShutdown();
            } catch (error) {
                console.error("Failed to persist interrupted sessions during shutdown:", error);
            }
            connectivityService.shutdown();
            schedulerService.shutdown();
            changeTracker.dispose();
            ptyManager.closeAll();
            await Promise.allSettled([fileWatcher.stopAll(), wikiIndex.stopAll()]);
            advertiser.stop();
            await releaseInstancePort(config.instancePortFile, startedServer.port, stop);
            process.exit(0);
        };
        process.on("SIGINT", () => void shutdown());
        if (process.platform !== "win32") {
            process.on("SIGTERM", () => void shutdown());
        }
    } catch (error) {
        if (advertisedPort !== undefined) {
            await releaseInstancePort(config.instancePortFile, advertisedPort, stop);
        } else {
            stop?.();
        }
        throw error;
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
