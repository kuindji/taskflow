import { readFileSync } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import { homedir, tmpdir } from "os";

const BASE_DIR = join(homedir(), ".config", "taskflow");
const DATA_LOCATION_FILE = join(BASE_DIR, "data-location.json");

function readDataDir(): string {
    try {
        const raw = readFileSync(DATA_LOCATION_FILE, "utf-8");
        const parsed = JSON.parse(raw) as { path?: string };
        if (parsed.path && typeof parsed.path === "string") {
            return parsed.path;
        }
    } catch {
        // Missing or invalid — use default
    }
    return BASE_DIR;
}

function buildDataPaths(dataDir: string) {
    return {
        dataDir,
        projectsFile: join(dataDir, "projects.json"),
        tasksDir: join(dataDir, "tasks"),
        archiveDir: join(dataDir, "archive"),
        sessionLogsDir: join(dataDir, "session-logs"),
        taskLogsDir: join(dataDir, "task-logs"),
        agentSkillsDir: join(dataDir, "agent-skills"),
        binDir: join(dataDir, "bin"),
    };
}

const devPort = process.env.TASKFLOW_DEV_PORT ? parseInt(process.env.TASKFLOW_DEV_PORT, 10) : 0;

const initialDataDir = readDataDir();

export const config = {
    baseDir: BASE_DIR,
    dataLocationFile: DATA_LOCATION_FILE,
    settingsFile: join(BASE_DIR, "settings.json"),
    portFile: process.env.TASKFLOW_PORT_FILE ?? join(tmpdir(), `.taskflow-port-${process.pid}`),
    port: Number.isInteger(devPort) && devPort > 0 ? devPort : 0,
    ...buildDataPaths(initialDataDir),
};

export function updateConfigDataDir(newDataDir: string): void {
    const paths = buildDataPaths(newDataDir);
    Object.assign(config, paths);
}

export function isDefaultDataDir(): boolean {
    return config.dataDir === BASE_DIR;
}

export async function ensureDirectories(): Promise<void> {
    await mkdir(config.baseDir, { recursive: true });
    await mkdir(config.tasksDir, { recursive: true });
    await mkdir(config.archiveDir, { recursive: true });
    await mkdir(config.sessionLogsDir, { recursive: true });
    await mkdir(config.taskLogsDir, { recursive: true });
    await mkdir(config.agentSkillsDir, { recursive: true });
    await mkdir(config.binDir, { recursive: true });
}
