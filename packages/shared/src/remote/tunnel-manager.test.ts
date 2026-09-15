import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendRecord } from "../types/backend";
import { createTunnelManager } from "./tunnel-manager";

// A stand-in `ssh` on PATH. It reads the local port from `-L`, logs its pid,
// and after a delay starts answering there the way the backend does, so the
// manager's readiness probe runs against a real child and a real port.
const FAKE_SSH = `#!/usr/bin/env bun
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
const localPort = Number(args[args.indexOf("-L") + 1].split(":")[1]);
const log = (entry) => appendFileSync(process.env.FAKE_SSH_LOG, JSON.stringify(entry) + "\\n");
log({ event: "spawn", pid: process.pid, localPort });
setTimeout(() => {
    Bun.serve({ hostname: "127.0.0.1", port: localPort, fetch: () => new Response("Taskflow backend") });
    log({ event: "ready", pid: process.pid, at: Date.now() });
}, Number(process.env.FAKE_SSH_READY_DELAY_MS));
`;

interface LogEntry {
    event: "spawn" | "ready";
    pid: number;
    localPort?: number;
    at?: number;
}

const record: BackendRecord = {
    id: "192.168.1.20:main",
    backendUid: null,
    host: "192.168.1.20",
    instanceId: "main",
    displayName: "desktop",
    user: "kuindji",
    sshPort: 22,
    lastKnownPort: 54892,
    attached: false,
    addedAt: "2026-08-23T00:00:00.000Z",
};

let dir = "";
let logFile = "";
const savedPath = process.env.PATH;

function readLog(): LogEntry[] {
    return readFileSync(logFile, "utf-8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as LogEntry);
}

async function answers(localPort: number): Promise<boolean> {
    try {
        const response = await fetch(`http://127.0.0.1:${localPort}/`, {
            signal: AbortSignal.timeout(1_000),
        });
        return (await response.text()) === "Taskflow backend";
    } catch {
        return false;
    }
}

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "tunnel-manager-"));
    const ssh = join(dir, "ssh");
    writeFileSync(ssh, FAKE_SSH);
    chmodSync(ssh, 0o755);
    process.env.PATH = `${dir}:${savedPath ?? ""}`;
    process.env.FAKE_SSH_READY_DELAY_MS = "500";
});

afterAll(() => {
    process.env.PATH = savedPath;
    delete process.env.FAKE_SSH_LOG;
    delete process.env.FAKE_SSH_READY_DELAY_MS;
    rmSync(dir, { recursive: true, force: true });
});

function useLog(name: string): void {
    logFile = join(dir, name);
    writeFileSync(logFile, "");
    process.env.FAKE_SSH_LOG = logFile;
}

describe("openTunnel", () => {
    const manager = createTunnelManager();
    afterEach(() => {
        for (const id of [record.id, "abc123"]) manager.closeTunnel(id);
    });

    test("two concurrent opens for one record spawn one child and resolve only after readiness", async () => {
        useLog("concurrent.log");

        const settledAt: number[] = [];
        const opens = [manager.openTunnel(record, 54892), manager.openTunnel(record, 54892)].map(
            (open) =>
                open.then((result) => {
                    settledAt.push(Date.now());
                    return result;
                }),
        );
        const results = await Promise.all(opens);

        const log = readLog();
        expect(log.filter((entry) => entry.event === "spawn")).toHaveLength(1);
        const readyAt = log.find((entry) => entry.event === "ready")?.at ?? Infinity;
        expect(results[0]).toEqual(results[1]);
        expect(results[0].ok).toBe(true);
        for (const at of settledAt) expect(at).toBeGreaterThanOrEqual(readyAt);
    });
});

describe("rekeyTunnel", () => {
    const manager = createTunnelManager();
    afterEach(() => {
        for (const id of [record.id, "abc123"]) manager.closeTunnel(id);
    });

    test("refiles a live child under the new id without killing it", async () => {
        useLog("rekey.log");

        const result = await manager.openTunnel(record, 54892);
        if (!result.ok) throw new Error(result.failure.message);

        manager.rekeyTunnel(record.id, "abc123");

        expect(manager.hasTunnel(record.id)).toBe(false);
        expect(manager.hasTunnel("abc123")).toBe(true);
        expect(await answers(result.localPort)).toBe(true);
        expect(readLog().filter((entry) => entry.event === "spawn")).toHaveLength(1);
        // Reachable under the new id: an open for it adopts the same child.
        expect(await manager.openTunnel({ ...record, id: "abc123" }, 54892)).toEqual(result);
    });

    test("a rekeyed child that exits is reported under the new id", async () => {
        useLog("rekey-exit.log");

        const result = await manager.openTunnel(record, 54892);
        if (!result.ok) throw new Error(result.failure.message);
        manager.rekeyTunnel(record.id, "abc123");

        const reported = new Promise<string>((resolve) =>
            manager.onTunnelExit((id) => resolve(id)),
        );
        const pid = readLog().find((entry) => entry.event === "spawn")?.pid;
        if (pid === undefined) throw new Error("fake ssh never started");
        process.kill(pid, "SIGKILL");

        expect(await reported).toBe("abc123");
        expect(manager.hasTunnel("abc123")).toBe(false);
    });
});

describe("separate managers", () => {
    const first = createTunnelManager();
    const second = createTunnelManager();
    afterEach(() => {
        first.closeTunnel(record.id);
        second.closeTunnel(record.id);
    });

    test("a tunnel opened on one manager is not visible on another", async () => {
        useLog("isolation.log");

        const result = await first.openTunnel(record, 54892);
        if (!result.ok) throw new Error(result.failure.message);

        expect(first.hasTunnel(record.id)).toBe(true);
        expect(second.hasTunnel(record.id)).toBe(false);
    });

    test("closing all tunnels on one manager does not stop another from opening", async () => {
        useLog("closing.log");

        first.closeAllTunnels();
        const result = await second.openTunnel(record, 54892);

        if (!result.ok) expect(result.failure.message).not.toBe("Taskflow is quitting.");
        expect(result.ok).toBe(true);
        expect(second.hasTunnel(record.id)).toBe(true);
    });
});
