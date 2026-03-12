import { mkdir } from "fs/promises";
import { join } from "path";
import { homedir, tmpdir } from "os";

const CONFIG_DIR = join(homedir(), ".config", "taskflow");

const devPort = process.env.TASKFLOW_DEV_PORT ? parseInt(process.env.TASKFLOW_DEV_PORT, 10) : 0;

export const config = {
    configDir: CONFIG_DIR,
    projectsFile: join(CONFIG_DIR, "projects.json"),
    tasksDir: join(CONFIG_DIR, "tasks"),
    archiveDir: join(CONFIG_DIR, "archive"),
    sessionLogsDir: join(CONFIG_DIR, "session-logs"),
    taskLogsDir: join(CONFIG_DIR, "task-logs"),
    agentSkillsDir: join(CONFIG_DIR, "agent-skills"),
    settingsFile: join(CONFIG_DIR, "settings.json"),
    portFile: process.env.TASKFLOW_PORT_FILE ?? join(tmpdir(), `.taskflow-port-${process.pid}`),
    port: Number.isInteger(devPort) && devPort > 0 ? devPort : 0,
};

export async function ensureDirectories(): Promise<void> {
    await mkdir(config.configDir, { recursive: true });
    await mkdir(config.tasksDir, { recursive: true });
    await mkdir(config.archiveDir, { recursive: true });
    await mkdir(config.sessionLogsDir, { recursive: true });
    await mkdir(config.taskLogsDir, { recursive: true });
    await mkdir(config.agentSkillsDir, { recursive: true });
}
