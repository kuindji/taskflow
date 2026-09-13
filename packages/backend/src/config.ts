import { execFileSync } from "child_process";
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { mkdir, writeFile, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { getConfigBaseDir } from "./services/platform";
import { randomBytes, randomUUID } from "crypto";

const BASE_DIR = getConfigBaseDir();
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

function buildDataPaths(dataDir: string, instanceId: string) {
    return {
        dataDir,
        projectsFile: join(dataDir, "projects.json"),
        tasksDir: join(dataDir, "tasks"),
        archiveDir: join(dataDir, "archive"),
        taskLogsDir: join(dataDir, "task-logs"),
        agentSkillsDir: join(BASE_DIR, "agent-skills"),
        themesDir: join(dataDir, "themes"),
        flowsDir: join(dataDir, "flows"),
        flowRunsDir: join(dataDir, "flow-runs"),
        schedulesFile: join(dataDir, "schedules.json"),
        notificationsFile: join(dataDir, "notifications.json"),
        masterSessionsFile: join(dataDir, "sessions", instanceId, "master.json"),
        sessionLogsDir: join(dataDir, "session-logs", instanceId),
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

const initialDataDir = readDataDir();

/**
 * The instance id names a file, is announced on the LAN, and is interpolated
 * into a remote command, so it is reduced to one safe label at the point it is
 * derived. Must stay in step with `isSafeLabel` in the beacon codec.
 */
function toSafeLabel(value: string): string {
    const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+/, "");
    return cleaned.slice(0, 64) || "unknown";
}

const instanceId = devBranch ? toSafeLabel(`dev-${devBranch}`) : "main";

function hasErrorCode(error: unknown, code: string): boolean {
    return error instanceof Error && "code" in error && error.code === code;
}

/** The uid stored in `file`, or null when there is none or it is not a valid uid. */
function readBackendUid(file: string): string | null {
    try {
        const value = readFileSync(file, "utf-8").trim();
        return /^[0-9a-f]{32}$/.test(value) ? value : null;
    } catch (error) {
        if (hasErrorCode(error, "ENOENT")) return null;
        throw error;
    }
}

/**
 * A backend's stable identity, minted once per install and per instance. Host
 * names and IP addresses are how you *reach* a backend; this is what one *is*,
 * so the client cannot attach the same backend twice under two aliases.
 *
 * Keyed by instance because `main` and `dev-*` share BASE_DIR and the data
 * directory; one uid between them would merge them into one record.
 *
 * Synchronous on purpose: everything downstream expects a plain string, not a
 * promise.
 */
export function readOrCreateBackendUid(baseDir: string, instanceId: string): string {
    const file = join(baseDir, `backend-uid-${instanceId}`);
    const existing = readBackendUid(file);
    if (existing) return existing;

    mkdirSync(baseDir, { recursive: true });
    const minted = randomBytes(16).toString("hex");
    // Written whole to a private temp file, then published with link(), which
    // fails if the uid file already exists. Of several backends starting at once
    // exactly one mints and the rest adopt its uid, and none reads a torn file.
    const temp = `${file}.${process.pid}.${minted.slice(0, 8)}.tmp`;
    writeFileSync(temp, minted, { mode: 0o600 });
    try {
        linkSync(temp, file);
        return minted;
    } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) throw error;
        const winner = readBackendUid(file);
        if (winner) return winner;
        // The file exists but holds no valid uid (corrupt or hand-edited). Every
        // backend starting now sees that, so the repair is serialized and re-checked:
        // the first replaces the file and the rest adopt what it wrote.
        return withFileLock(file, () => {
            const repaired = readBackendUid(file);
            if (repaired) return repaired;
            renameSync(temp, file);
            return minted;
        });
    } finally {
        rmSync(temp, { force: true });
    }
}

/** A lock older than this belongs to a process that died holding it. */
const STALE_LOCK_MS = 10_000;

/** Runs `run` while holding an exclusive lock directory next to `file`. */
function withFileLock<T>(file: string, run: () => T): T {
    const lock = `${file}.lock`;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    for (;;) {
        try {
            mkdirSync(lock);
            break;
        } catch (error) {
            if (!hasErrorCode(error, "EEXIST")) throw error;
        }
        try {
            if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) {
                rmSync(lock, { recursive: true, force: true });
                continue;
            }
        } catch (error) {
            if (!hasErrorCode(error, "ENOENT")) throw error;
            continue;
        }
        Atomics.wait(pause, 0, 0, 10);
    }
    try {
        return run();
    } finally {
        rmSync(lock, { recursive: true, force: true });
    }
}

let backendUid: string | undefined;

export const config = {
    baseDir: BASE_DIR,
    binDir: join(BASE_DIR, "bin"),
    dataLocationFile: DATA_LOCATION_FILE,
    settingsFile: join(BASE_DIR, "settings.json"),
    portFile: process.env.TASKFLOW_PORT_FILE ?? join(tmpdir(), `.taskflow-port-${process.pid}`),
    /** Stable, spawner-independent port file. Read over ssh when multicast is unavailable. */
    instancePortFile: join(BASE_DIR, `${instanceId}.port`),
    /**
     * Stable backend identity. See readOrCreateBackendUid. Minted on first read,
     * not at import, so the many modules and tests that import config write
     * nothing into the config directory.
     */
    get backendUid(): string {
        backendUid ??= readOrCreateBackendUid(BASE_DIR, instanceId);
        return backendUid;
    },
    port: Number.isInteger(devPort) && devPort > 0 ? devPort : 0,
    instanceId,
    bootId: randomUUID(),
    ...buildDataPaths(initialDataDir, instanceId),
};

export function updateConfigDataDir(newDataDir: string): void {
    const paths = buildDataPaths(newDataDir, config.instanceId);
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
