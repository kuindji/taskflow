import { mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir, tmpdir } from 'os';

const CONFIG_DIR = join(homedir(), '.config', 'taskflow');

export const config = {
  configDir: CONFIG_DIR,
  projectsFile: join(CONFIG_DIR, 'projects.json'),
  tasksDir: join(CONFIG_DIR, 'tasks'),
  archiveDir: join(CONFIG_DIR, 'archive'),
  portFile: process.env.TASKFLOW_PORT_FILE ?? join(tmpdir(), `.taskflow-port-${process.pid}`),
};

export async function ensureDirectories(): Promise<void> {
  await mkdir(config.configDir, { recursive: true });
  await mkdir(config.tasksDir, { recursive: true });
  await mkdir(config.archiveDir, { recursive: true });
}
