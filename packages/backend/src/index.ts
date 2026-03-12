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
import { detectShells } from "./services/shell-detector";
import { registerProjectHandlers } from "./handlers/project";
import { registerTaskHandlers } from "./handlers/task";
import { registerSessionHandlers } from "./handlers/session";
import { registerFileHandlers } from "./handlers/file";
import { registerGitHandlers } from "./handlers/git";
import { registerSettingsHandlers } from "./handlers/settings";
import { SettingsStore } from "./services/settings-store";
import { ApiRouter } from "./api/router";
import { registerApiRoutes } from "./api/routes";
import { createTitleGenerator } from "./services/title-generator";
import { writeFile } from "fs/promises";

async function main() {
    await ensureDirectories();
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
        await store.cleanExpiredArchives();

        const ptyManager = new PtyManager();
        const gitService = new GitService();
        const fileWatcher = new FileWatcher();

        const router = new Router();
        const apiRouter = new ApiRouter();
        const server = createServer(router, config.port, apiRouter);
        let serverPort = config.port;

        const titleGenerator = createTitleGenerator({
            taskStore: store,
            broadcast: server.broadcast,
        });

        registerProjectHandlers(router, store, gitService, (sessionId) => {
            ptyManager.close(sessionId);
        });
        registerTaskHandlers({
            router,
            store,
            closeSession: (sessionId) => {
                ptyManager.close(sessionId);
            },
            generateTitle: (taskId, description) => {
                void titleGenerator.generate(taskId, description);
            },
        });
        registerSessionHandlers({
            router,
            ptyManager,
            taskStore: store,
            broadcast: server.broadcast,
            getPort: () => serverPort,
        });
        registerFileHandlers({
            router,
            fileWatcher,
            taskStore: store,
            broadcast: server.broadcast,
        });
        registerGitHandlers({ router, git: gitService, taskStore: store });

        const settingsStore = new SettingsStore(config.settingsFile);
        registerSettingsHandlers(router, settingsStore);
        registerApiRoutes({
            apiRouter,
            taskStore: store,
            ptyManager,
            broadcast: server.broadcast,
        });

        router.register(MSG.BROWSER_OPEN, async (payload) => {
            const typed = payload as BrowserOpenPayload;
            server.broadcast({ type: MSG.BROWSER_OPEN, payload: typed });
            return { success: true };
        });

        const editors = await detectEditors();
        const shells = await detectShells();
        router.register(MSG.SYSTEM_INFO, async () => ({ editors }));
        router.register(MSG.SHELLS_LIST, async () => ({ shells }));
        console.log(`Detected shells: ${shells.map((s) => s.name).join(", ") || "none"}`);

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
