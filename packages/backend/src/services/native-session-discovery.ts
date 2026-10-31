import { createHash, randomUUID } from "crypto";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { mkdir, readdir, readFile, rm, stat } from "fs/promises";
import type { Dirent } from "fs";
import type { AgentType } from "@taskflow/shared";

interface NativeSessionCandidate {
    id: string;
    cwd?: string;
    createdAt: number;
}

const DISCOVERY_TIMEOUT_MS = 15_000;
const LAUNCH_LOCK_TIMEOUT_MS = 35_000;
const LOCK_STALE_MS = 30_000;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recentFiles(root: string, since: number, depth = 0): Promise<string[]> {
    if (depth > 5) return [];
    let entries: Dirent[];
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch {
        return [];
    }
    const files: string[] = [];
    for (const entry of entries) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await recentFiles(path, since, depth + 1)));
            continue;
        }
        if (!entry.isFile()) continue;
        try {
            if ((await stat(path)).mtimeMs >= since) files.push(path);
        } catch {
            // The agent may still be replacing its session file; retry on the next poll.
        }
    }
    return files;
}

async function codexCandidates(
    since: number,
    home = join(homedir(), ".codex"),
): Promise<NativeSessionCandidate[]> {
    const files = await recentFiles(join(home, "sessions"), since);
    const candidates: NativeSessionCandidate[] = [];
    for (const file of files.filter((path) => path.endsWith(".jsonl"))) {
        try {
            const firstLine = (await readFile(file, "utf-8")).split("\n", 1)[0];
            const entry = JSON.parse(firstLine) as {
                type?: string;
                payload?: { id?: string; session_id?: string; cwd?: string; timestamp?: string };
            };
            if (entry.type !== "session_meta") continue;
            const id = entry.payload?.id ?? entry.payload?.session_id;
            if (!id) continue;
            candidates.push({
                id,
                cwd: entry.payload?.cwd,
                createdAt: entry.payload?.timestamp
                    ? Date.parse(entry.payload.timestamp)
                    : (await stat(file)).birthtimeMs,
            });
        } catch {
            continue;
        }
    }
    return candidates;
}

async function openCodeCandidates(since: number): Promise<NativeSessionCandidate[]> {
    try {
        const proc = Bun.spawn(["opencode", "session", "list", "--format", "json", "-n", "50"], {
            stdout: "pipe",
            stderr: "ignore",
        });
        const output = await new Response(proc.stdout).text();
        if ((await proc.exited) !== 0) return [];
        const rows = JSON.parse(output) as Array<{
            id?: string;
            directory?: string;
            created?: number;
        }>;
        return rows.flatMap((row) =>
            row.id && typeof row.created === "number" && row.created >= since
                ? [{ id: row.id, cwd: row.directory, createdAt: row.created }]
                : [],
        );
    } catch {
        return [];
    }
}

/**
 * A path for a new Pi conversation, in Pi's own per-directory store
 * (`~/.pi/agent/sessions/--<cwd>--/`). `pi --session <path>` starts a new
 * conversation there when the file does not exist yet, so Taskflow knows the
 * conversation from launch instead of discovering it: Pi writes the file only
 * after the first assistant reply, which may come long after launch.
 */
function newPiSessionPath(cwd: string): string {
    const encodedCwd = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return join(
        homedir(),
        ".pi",
        "agent",
        "sessions",
        encodedCwd,
        `${timestamp}_${randomUUID()}.jsonl`,
    );
}

/**
 * Kimi Code keeps each conversation in its own directory,
 * `<KIMI_CODE_HOME>/sessions/<workspace>/session_<uuid>/`, and `kimi --session`
 * takes that directory name. Every file under it belongs to that one conversation.
 */
async function kimiCandidates(since: number, homeDir?: string): Promise<NativeSessionCandidate[]> {
    const home = homeDir ?? (process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code"));
    const files = await recentFiles(join(home, "sessions"), since);
    const byId = new Map<string, NativeSessionCandidate>();
    for (const file of files) {
        const id = file.split(/[\\/]/).find((part) => part.startsWith("session_"));
        if (!id || byId.has(id)) continue;
        try {
            const info = await stat(file);
            byId.set(id, { id, createdAt: info.birthtimeMs || info.mtimeMs });
        } catch {
            continue;
        }
    }
    return [...byId.values()];
}

async function candidatesFor(
    type: AgentType,
    since: number,
    homeDir?: string,
): Promise<NativeSessionCandidate[]> {
    if (type === "codex") return codexCandidates(since, homeDir);
    if (type === "opencode") return openCodeCandidates(since);
    if (type === "kimi") return kimiCandidates(since, homeDir);
    return [];
}

async function acquireNativeSessionLaunchLock(
    type: AgentType,
    homeDir?: string,
): Promise<() => Promise<void>> {
    // Accounts have their own session stores, so their launches never race; keying
    // the lock by home dir lets two accounts of the same agent start concurrently.
    const homeKey = homeDir
        ? `-${createHash("sha256").update(homeDir).digest("hex").slice(0, 12)}`
        : "";
    const lockPath = join(tmpdir(), `taskflow-native-session-launch-${type}${homeKey}.lock`);
    const deadline = Date.now() + LAUNCH_LOCK_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            await mkdir(lockPath);
            return async () => {
                await rm(lockPath, { recursive: true, force: true });
            };
        } catch {
            try {
                if (Date.now() - (await stat(lockPath)).mtimeMs > LOCK_STALE_MS) {
                    await rm(lockPath, { recursive: true, force: true });
                    continue;
                }
            } catch {
                continue;
            }
            await delay(100);
        }
    }
    throw new Error(`Timed out waiting to identify a new ${type} session`);
}

async function discoverNativeSessionId(
    type: AgentType,
    cwd: string,
    baselineIds: ReadonlySet<string>,
    startedAt: number,
    homeDir?: string,
): Promise<string | null> {
    const since = startedAt - 2_000;
    const deadline = Date.now() + DISCOVERY_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const recent = await candidatesFor(type, since, homeDir);
        const cwdMatches = recent.filter((candidate) => !candidate.cwd || candidate.cwd === cwd);
        const unique = [
            ...new Set(
                cwdMatches.map((candidate) => candidate.id).filter((id) => !baselineIds.has(id)),
            ),
        ];
        if (unique.length === 1) return unique[0];
        if (unique.length > 1) return null;
        await delay(200);
    }
    return null;
}

async function captureNativeSessionIds(
    type: AgentType,
    cwd: string,
    homeDir?: string,
): Promise<Set<string>> {
    const existing = await candidatesFor(type, 0, homeDir);
    return new Set(
        existing
            .filter((candidate) => !candidate.cwd || candidate.cwd === cwd)
            .map((candidate) => candidate.id),
    );
}

export {
    acquireNativeSessionLaunchLock,
    captureNativeSessionIds,
    discoverNativeSessionId,
    newPiSessionPath,
};
