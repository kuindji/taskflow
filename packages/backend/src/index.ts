import { MSG } from '@taskflow/shared';
import { ensureDirectories, config } from './config';
import { Router } from './ws/router';
import { createServer } from './ws/server';
import { TaskStore } from './services/task-store';
import { PtyManager } from './services/pty-manager';
import { GitService } from './services/git-service';
import { FileWatcher } from './services/file-watcher';
import { detectEditors } from './services/editor-detector';
import { registerProjectHandlers } from './handlers/project';
import { registerTaskHandlers } from './handlers/task';
import { registerSessionHandlers } from './handlers/session';
import { registerFileHandlers } from './handlers/file';
import { registerGitHandlers } from './handlers/git';
import { writeFile } from 'fs/promises';

async function main() {
  await ensureDirectories();
  let stop: (() => void) | undefined;

  try {
    const store = new TaskStore({
      projectsFile: config.projectsFile,
      tasksDir: config.tasksDir,
      archiveDir: config.archiveDir,
    });
    await store.init();
    await store.cleanExpiredArchives();

    const ptyManager = new PtyManager();
    const gitService = new GitService();
    const fileWatcher = new FileWatcher();

    const router = new Router();
    const server = createServer(router);

    registerProjectHandlers(router, store);
    registerTaskHandlers({
      router,
      store,
      closeSession: (sessionId) => {
        ptyManager.close(sessionId);
      },
    });
    registerSessionHandlers({
      router, ptyManager, taskStore: store,
      broadcast: server.broadcast,
    });
    registerFileHandlers({
      router, fileWatcher, taskStore: store, broadcast: server.broadcast,
    });
    registerGitHandlers({ router, git: gitService, taskStore: store });

    const editors = await detectEditors();
    router.register(MSG.SYSTEM_INFO, async () => ({ editors }));

    const startedServer = await server.start();
    stop = startedServer.stop;

    await writeFile(config.portFile, String(startedServer.port));
    console.log(`Taskflow backend running on port ${startedServer.port}`);
    console.log(`Detected editors: ${editors.map((e) => e.name).join(', ') || 'none'}`);

    const shutdown = () => {
      ptyManager.closeAll();
      fileWatcher.stopAll();
      stop?.();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    stop?.();
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
