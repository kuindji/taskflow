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
import { detectRuntimes, detectAgents } from "./services/runtime-detector";
import { registerProjectHandlers } from "./handlers/project";
import { registerTaskHandlers } from "./handlers/task";
import { registerSessionHandlers } from "./handlers/session";
import { registerFileHandlers } from "./handlers/file";
import { registerGitHandlers } from "./handlers/git";
import { registerSettingsHandlers } from "./handlers/settings";
import { registerScriptsHandlers } from "./handlers/scripts";
import { registerThemeHandlers } from "./handlers/theme";
import { SettingsStore } from "./services/settings-store";
import { ThemeService } from "./services/theme-service";
import { ApiRouter } from "./api/router";
import { registerApiRoutes } from "./api/routes";
import { createTitleGenerator } from "./services/title-generator";
import { ensureCliScript } from "./services/internal-agent-skill";
import { FlowStore } from "./services/flow-store";
import { FlowRunner } from "./services/flow-runner";
import { createSessionLifecycle } from "./services/session-lifecycle";
import { registerFlowHandlers } from "./handlers/flow";
import { writeFile } from "fs/promises";

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
        await store.clearAllSessions();
        await store.cleanupAllSessionLogs();
        await store.cleanExpiredArchives();

        const flowStore = new FlowStore(config.flowsDir, config.flowRunsDir);
        await flowStore.init();

        const ptyManager = new PtyManager();
        const gitService = new GitService();
        const fileWatcher = new FileWatcher();
        const settingsStore = new SettingsStore(config.settingsFile);

        const shells = await detectShells();
        const systemShellPath = resolveSystemShellPath(shells);

        const router = new Router();
        const apiRouter = new ApiRouter();
        const server = createServer(router, config.port, apiRouter);
        let serverPort = config.port;

        const sessionLifecycle = createSessionLifecycle({
            ptyManager,
            taskStore: store,
            broadcast: server.broadcast,
            getPort: () => serverPort,
        });

        const titleGenerator = createTitleGenerator({
            taskStore: store,
            gitService,
            broadcast: server.broadcast,
        });

        // FlowRunner is referenced inside its own spawnSession callback (for
        // handleSessionExit) — the closure captures the variable, not the value,
        // so `const` is safe here since the callback is only invoked later.
        const flowRunner = new FlowRunner({
            flowStore,
            spawnSession: async (opts) => {
                const owner = opts.owner.taskId
                    ? { taskId: opts.owner.taskId }
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
                // If not task-scoped, must be project-scoped (FlowOwner is a discriminated union)
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

        registerProjectHandlers(router, store, gitService, (sessionId) => {
            ptyManager.close(sessionId);
        });
        registerTaskHandlers({
            router,
            store,
            gitService,
            closeSession: (sessionId) => {
                ptyManager.close(sessionId);
            },
            generateTitle: (taskId, description) => {
                void titleGenerator.generate(taskId, description);
            },
            flowStore,
            flowRunner,
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
        });
        registerGitHandlers({ router, git: gitService, taskStore: store });

        const themeService = new ThemeService(config.themesDir);
        registerSettingsHandlers({ router, settingsStore, taskStore: store });
        registerThemeHandlers(router, themeService);
        registerScriptsHandlers(router);
        registerFlowHandlers({ router, flowStore, flowRunner });
        registerApiRoutes({
            apiRouter,
            taskStore: store,
            ptyManager,
            broadcast: server.broadcast,
            settingsStore,
            flowStore,
            flowRunner,
            gitService,
            generateTitle: (taskId, description) => {
                void titleGenerator.generate(taskId, description);
            },
        });

        router.register(MSG.BROWSER_OPEN, async (payload) => {
            const typed = payload as BrowserOpenPayload;
            server.broadcast({ type: MSG.BROWSER_OPEN, payload: typed });
            return { success: true };
        });

        const editors = await detectEditors();
        const runtimes = await detectRuntimes();
        router.register(MSG.SYSTEM_INFO, async () => ({ editors }));
        router.register(MSG.SHELLS_LIST, async () => ({
            shells,
            systemShellPath,
        }));
        router.register(MSG.RUNTIMES_LIST, async () => ({ runtimes }));
        router.register(MSG.AGENTS_LIST, async () => ({ agents }));
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

        const shutdown = () => {
            ptyManager.closeAll();
            fileWatcher.stopAll();
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
