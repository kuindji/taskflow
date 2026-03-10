import { ensureDirectories, config } from './config';
import { Router } from './ws/router';
import { createServer } from './ws/server';
import { TaskStore } from './services/task-store';
import { registerProjectHandlers } from './handlers/project';
import { registerTaskHandlers } from './handlers/task';
import { writeFile } from 'fs/promises';

async function main() {
  await ensureDirectories();

  const store = new TaskStore({
    projectsFile: config.projectsFile,
    tasksDir: config.tasksDir,
    archiveDir: config.archiveDir,
  });
  await store.init();
  await store.cleanExpiredArchives();

  const router = new Router();
  registerProjectHandlers(router, store);
  registerTaskHandlers(router, store);

  const server = createServer(router);
  const { port, stop } = await server.start();

  await writeFile(config.portFile, String(port));
  console.log(`Taskflow backend running on port ${port}`);

  process.on('SIGINT', () => {
    stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    stop();
    process.exit(0);
  });
}

main().catch(console.error);
