import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
    acquireNativeSessionLaunchLock,
    captureNativeSessionIds,
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
