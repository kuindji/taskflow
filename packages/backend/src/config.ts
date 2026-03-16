import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { mkdir, writeFile, access } from "fs/promises";
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
        taskLogsDir: join(dataDir, "task-logs"),
        agentSkillsDir: join(dataDir, "agent-skills"),
        themesDir: join(dataDir, "themes"),
        flowsDir: join(dataDir, "flows"),
        flowRunsDir: join(dataDir, "flow-runs"),
    };
}

const devPort = process.env.TASKFLOW_DEV_PORT ? parseInt(process.env.TASKFLOW_DEV_PORT, 10) : 0;

function getDevBranch(): string | null {
    if (process.env.TASKFLOW_DEV_BRANCH) {
        return process.env.TASKFLOW_DEV_BRANCH;
    }
    if (process.env.TASKFLOW_DEV) {
        try {
            return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
                encoding: "utf-8",
                timeout: 3000,
            })
                .trim()
                .replace(/\//g, "-");
        } catch {
            return "unknown";
        }
    }
    return null;
}

const devBranch = getDevBranch();

function getSessionLogsDir(): string {
    if (devBranch) {
        return join(tmpdir(), `taskflow-session-logs-dev-${devBranch}`);
    }
    return join(tmpdir(), "taskflow-session-logs");
}

const initialDataDir = readDataDir();

export const config = {
    baseDir: BASE_DIR,
    binDir: join(BASE_DIR, "bin"),
    dataLocationFile: DATA_LOCATION_FILE,
    settingsFile: join(BASE_DIR, "settings.json"),
    portFile: process.env.TASKFLOW_PORT_FILE ?? join(tmpdir(), `.taskflow-port-${process.pid}`),
    port: Number.isInteger(devPort) && devPort > 0 ? devPort : 0,
    sessionLogsDir: getSessionLogsDir(),
    instanceId: devBranch ? `dev-${devBranch}` : "main",
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
    await mkdir(config.taskLogsDir, { recursive: true });
    await mkdir(config.agentSkillsDir, { recursive: true });
    await mkdir(config.binDir, { recursive: true });
    await mkdir(config.themesDir, { recursive: true });
    await mkdir(config.flowsDir, { recursive: true });
    await mkdir(config.flowRunsDir, { recursive: true });
    await seedThemeExample(config.themesDir);
}

async function seedThemeExample(themesDir: string): Promise<void> {
    const examplePath = join(themesDir, "example.jsonc");
    try {
        await access(examplePath);
    } catch {
        await writeFile(examplePath, THEME_EXAMPLE);
    }
}

const THEME_EXAMPLE = `// Example Taskflow theme
// Rename this file to <your-theme-name>.json to make it appear in the theme selector.
// The filename (without .json) becomes the theme ID.
// To override a bundled theme, use the same ID as the bundled theme (e.g. "dracula.json").
{
    "version": 1,
    "name": "My Custom Theme",
    "origin": "custom",
    "colors": {
        "foreground": "#d4d4d4",
        "background": "#1e1e1e",
        "cursor": "#aeafad",
        "cursorText": "#1e1e1e",
        "selection": "#264f78",
        "selectionText": "#d4d4d4",
        "ansi": {
            "black": "#1e1e1e",
            "red": "#f44747",
            "green": "#6a9955",
            "yellow": "#d7ba7d",
            "blue": "#569cd6",
            "magenta": "#c586c0",
            "cyan": "#4ec9b0",
            "white": "#d4d4d4",
            "brightBlack": "#808080",
            "brightRed": "#f44747",
            "brightGreen": "#6a9955",
            "brightYellow": "#d7ba7d",
            "brightBlue": "#569cd6",
            "brightMagenta": "#c586c0",
            "brightCyan": "#4ec9b0",
            "brightWhite": "#d4d4d4"
        }
    },
    // Optional: override CSS custom properties used by the UI.
    // Common overrides:
    "overrides": {
        "--border": "#333333",
        "--sidebar-border": "#333333",
        "--input": "#333333"
    }
}
`;
