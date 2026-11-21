import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import { Database } from "bun:sqlite";
import {
    acquireNativeSessionLaunchLock,
    captureNativeSessionIds,
    discoverNativeSessionId,
} from "../../src/services/native-session-discovery";

const dirs: string[] = [];
afterEach(async () => {
    let dir = dirs.pop();
    while (dir) {
        await rm(dir, { recursive: true, force: true });
        dir = dirs.pop();
    }
});

async function codexHomeWithSession(id: string, cwd: string): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), "taskflow-codex-home-"));
    dirs.push(home);
    const dayDir = join(home, "sessions", "2026", "09", "17");
    await mkdir(dayDir, { recursive: true });
    await writeFile(
        join(dayDir, `rollout-${id}.jsonl`),
        `${JSON.stringify({ type: "session_meta", payload: { id, cwd, timestamp: new Date().toISOString() } })}\n`,
    );
    return home;
}

/** Kimi Code's layout: one directory per conversation, named by the ID `--session` takes. */
async function kimiHomeWithSession(
    id: string,
    workDir = "/work/repo",
    home?: string,
): Promise<string> {
    if (!home) {
        home = await mkdtemp(join(tmpdir(), "taskflow-kimi-home-"));
        dirs.push(home);
    }
    const workspace = `wd_${workDir.split("/").pop()}_0123456789ab`;
    const sessionDir = join(home, "sessions", workspace, id);
    await mkdir(join(sessionDir, "agents", "main"), { recursive: true });
    await writeFile(join(sessionDir, "state.json"), JSON.stringify({ workDir }));
    await writeFile(join(sessionDir, "agents", "main", "wire.jsonl"), "{}\n");
    return home;
}

describe("Kimi native session discovery", () => {
    it("identifies a new Kimi conversation by its session directory", async () => {
        const startedAt = Date.now();
        const home = await kimiHomeWithSession("session_4f1c2d3e-0000-4000-8000-000000000001");
        const id = await discoverNativeSessionId("kimi", "/work/repo", new Set(), startedAt, home);
        expect(id).toBe("session_4f1c2d3e-0000-4000-8000-000000000001");
    });

    it("ignores a Kimi conversation another workspace started at the same time", async () => {
        const startedAt = Date.now();
        const home = await kimiHomeWithSession(
            "session_4f1c2d3e-0000-4000-8000-00000000000a",
            "/work/a",
        );
        await kimiHomeWithSession("session_4f1c2d3e-0000-4000-8000-00000000000b", "/work/b", home);
        const id = await discoverNativeSessionId("kimi", "/work/a", new Set(), startedAt, home);
        expect(id).toBe("session_4f1c2d3e-0000-4000-8000-00000000000a");
    });

    it("counts an existing Kimi conversation once in the baseline", async () => {
        const home = await kimiHomeWithSession("session_4f1c2d3e-0000-4000-8000-000000000002");
        const ids = await captureNativeSessionIds("kimi", "/work/repo", home);
        expect([...ids]).toEqual(["session_4f1c2d3e-0000-4000-8000-000000000002"]);
    });
});

async function antigravityHomeWithRows(
    rows: Array<{
        id: string;
        workspaces: string[];
        lastModifiedTime?: string;
        parentId?: string;
        createConvDb?: boolean;
    }>,
): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), "taskflow-agy-home-"));
    dirs.push(home);
    await mkdir(join(home, "conversations"), { recursive: true });
    const db = new Database(join(home, "conversation_summaries.db"));
    try {
        db.run(`
            CREATE TABLE conversation_summaries (
                conversation_id text PRIMARY KEY,
                workspace_uris text NOT NULL,
                last_modified_time datetime NOT NULL,
                parent_conversation_id text NOT NULL DEFAULT ""
            );
        `);
        const insert = db.query(
            "INSERT INTO conversation_summaries (conversation_id, workspace_uris, last_modified_time, parent_conversation_id) VALUES (?, ?, ?, ?)",
        );
        for (const row of rows) {
            const uris = JSON.stringify(row.workspaces.map((dir) => pathToFileURL(dir).href));
            const modified =
                row.lastModifiedTime ??
                new Date().toISOString().replace("T", " ").replace("Z", "+00:00");
            insert.run(row.id, uris, modified, row.parentId ?? "");
            if (row.createConvDb) {
                await writeFile(join(home, "conversations", `${row.id}.db`), "");
            }
        }
    } finally {
        db.close();
    }
    return home;
}

describe("Antigravity native session discovery", () => {
    it("discovers a new conversation matching cwd even when --add-dir adds extra workspace URIs", async () => {
        const startedAt = Date.now();
        const home = await antigravityHomeWithRows([
            {
                id: "agy-conv-1",
                workspaces: ["/tmp/taskflow-prompt", "/work/repo"],
            },
            {
                id: "agy-conv-other",
                workspaces: ["/work/other"],
            },
            {
                id: "agy-subagent",
                workspaces: ["/work/repo"],
                parentId: "agy-conv-1",
            },
        ]);
        const id = await discoverNativeSessionId(
            "antigravity",
            "/work/repo",
            new Set(),
            startedAt,
            home,
        );
        expect(id).toBe("agy-conv-1");
    });

    it("falls back to conversations/<id>.db mtime when last_modified_time is zero", async () => {
        const startedAt = Date.now();
        const home = await antigravityHomeWithRows([
            {
                id: "agy-conv-zero",
                workspaces: ["/work/repo"],
                lastModifiedTime: "0001-01-01 00:00:00+00:00",
                createConvDb: true,
            },
        ]);
        const id = await discoverNativeSessionId(
            "antigravity",
            "/work/repo",
            new Set(),
            startedAt,
            home,
        );
        expect(id).toBe("agy-conv-zero");
    });

    it("captures existing Antigravity conversations in baseline", async () => {
        const home = await antigravityHomeWithRows([
            { id: "agy-existing", workspaces: ["/work/repo"] },
        ]);
        const ids = await captureNativeSessionIds("antigravity", "/work/repo", home);
        expect([...ids]).toEqual(["agy-existing"]);
    });

    it("captures existing Antigravity conversations from a cleanly closed WAL database with no sidecars", async () => {
        const home = await mkdtemp(join(tmpdir(), "taskflow-agy-wal-"));
        dirs.push(home);
        const dbPath = join(home, "conversation_summaries.db");
        const db = new Database(dbPath);
        try {
            db.run("PRAGMA journal_mode=WAL;");
            db.run(`
                CREATE TABLE conversation_summaries (
                    conversation_id text PRIMARY KEY,
                    workspace_uris text NOT NULL,
                    last_modified_time datetime NOT NULL,
                    parent_conversation_id text NOT NULL DEFAULT ""
                );
            `);
            db.query(
                "INSERT INTO conversation_summaries (conversation_id, workspace_uris, last_modified_time, parent_conversation_id) VALUES (?, ?, ?, '')",
            ).run(
                "agy-wal-closed",
                JSON.stringify([pathToFileURL("/work/repo").href]),
                new Date().toISOString().replace("T", " ").replace("Z", "+00:00"),
            );
            db.run("PRAGMA wal_checkpoint(TRUNCATE);");
        } finally {
            db.close();
        }
        await rm(`${dbPath}-wal`, { force: true });
        await rm(`${dbPath}-shm`, { force: true });

        const ids = await captureNativeSessionIds("antigravity", "/work/repo", home);
        expect([...ids]).toEqual(["agy-wal-closed"]);
    });
});

describe("native session discovery with account homes", () => {
    it("reads Codex sessions from the given home dir", async () => {
        const home = await codexHomeWithSession("abc-123", "/work/repo");
        const ids = await captureNativeSessionIds("codex", "/work/repo", home);
        expect([...ids]).toEqual(["abc-123"]);
    });

    it("locks per home dir so different accounts launch concurrently", async () => {
        const releaseA = await acquireNativeSessionLaunchLock("codex", "/homes/a");
        const started = Date.now();
        const releaseB = await acquireNativeSessionLaunchLock("codex", "/homes/b");
        expect(Date.now() - started).toBeLessThan(1_000);
        await releaseA();
        await releaseB();
    });

    it("serializes launches that share one home dir", async () => {
        const releaseA = await acquireNativeSessionLaunchLock("codex", "/homes/shared");
        const started = Date.now();
        const pendingB = acquireNativeSessionLaunchLock("codex", "/homes/shared");
        const timer = setTimeout(() => void releaseA(), 200);
        const releaseB = await pendingB;
        clearTimeout(timer);
        expect(Date.now() - started).toBeGreaterThan(50);
        await releaseB();
    });
});
