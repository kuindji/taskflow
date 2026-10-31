import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
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
async function kimiHomeWithSession(id: string): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), "taskflow-kimi-home-"));
    dirs.push(home);
    const sessionDir = join(home, "sessions", "wd_repo_0123456789ab", id);
    await mkdir(join(sessionDir, "agents", "main"), { recursive: true });
    await writeFile(join(sessionDir, "state.json"), JSON.stringify({ workDir: "/work/repo" }));
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

    it("counts an existing Kimi conversation once in the baseline", async () => {
        const home = await kimiHomeWithSession("session_4f1c2d3e-0000-4000-8000-000000000002");
        const ids = await captureNativeSessionIds("kimi", "/work/repo", home);
        expect([...ids]).toEqual(["session_4f1c2d3e-0000-4000-8000-000000000002"]);
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
