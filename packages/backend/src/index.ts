import { ensureDirectories, config } from './config';
import { Router } from './ws/router';
import { createServer } from './ws/server';
import { writeFile } from 'fs/promises';

async function main() {
  await ensureDirectories();

  const router = new Router();
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
