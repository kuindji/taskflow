import { afterEach, describe, expect, it } from "bun:test";
import {
    createPosixProcessOps,
    createProcessStopper,
    createWindowsProcessOps,
} from "../../src/services/process-stopper";
import type {
    CommandResult,
    CommandRunner,
    Kill,
    ProcessOps,
    ProcessRow,
} from "../../src/services/process-stopper";
import { expectRejects } from "../expect-rejects";

const nowSec = () => Math.floor(Date.now() / 1000);

interface FakeOptions {
    start?: number | null;
    rows?: ProcessRow[];
    deny?: boolean;
    survivesTerm?: number[];
    survivesKill?: number[];
}

interface FakeOps extends ProcessOps {
    signals: Array<{ pids: number[]; force: boolean }>;
}

function fakeOps(options: FakeOptions = {}): FakeOps {
    let phase: "before" | "term" | "kill" = "before";
    const signals: Array<{ pids: number[]; force: boolean }> = [];
    const rows = options.rows ?? [{ pid: 42, ppid: 1 }];
    return {
        signals,
        startTime: () =>
            Promise.resolve(options.start === undefined ? nowSec() - 60 : options.start),
        processes: () => {
            if (phase === "before") return Promise.resolve(rows);
            const survivors =
                phase === "term" ? (options.survivesTerm ?? []) : (options.survivesKill ?? []);
            return Promise.resolve(rows.filter((row) => survivors.includes(row.pid)));
        },
        signal: (pids, force) => {
            signals.push({ pids, force });
            phase = force ? "kill" : "term";
            return Promise.resolve(options.deny ? "denied" : "sent");
        },
    };
}

function stopperWith(ops: ProcessOps) {
    return createProcessStopper({ ops, termGraceMs: 0, killGraceMs: 0, pollMs: 1 });
}

describe("createProcessStopper", () => {
    const registeredAt = () => new Date().toISOString();
    const tree: ProcessRow[] = [
        { pid: 1, ppid: 0 },
        { pid: 42, ppid: 1 },
        { pid: 43, ppid: 42 },
        { pid: 44, ppid: 43 },
        { pid: 50, ppid: 1 },
    ];

    it("reports a pid that is not running as gone and signals nothing", async () => {
        const ops = fakeOps({ start: null });
        expect(await stopperWith(ops)(42, registeredAt())).toEqual({ status: "gone" });
        expect(ops.signals).toEqual([]);
    });

    it("treats a process that started after registration as reused and signals nothing", async () => {
        const ops = fakeOps({ start: nowSec() });
        const earlier = new Date(Date.now() - 10_000).toISOString();
        expect(await stopperWith(ops)(42, earlier)).toEqual({ status: "reused" });
        expect(ops.signals).toEqual([]);
    });

    it("compares whole seconds with no slack", async () => {
        const at = "2026-10-11T12:00:00.500Z";
        const registeredSec = Math.floor(Date.parse(at) / 1000);

        const sameSecond = fakeOps({ start: registeredSec });
        expect(await stopperWith(sameSecond)(42, at)).toEqual({ status: "stopped" });

        const nextSecond = fakeOps({ start: registeredSec + 1 });
        expect(await stopperWith(nextSecond)(42, at)).toEqual({ status: "reused" });
        expect(nextSecond.signals).toEqual([]);
    });

    it("sends SIGTERM to the registered pid first, then its descendants", async () => {
        const ops = fakeOps({ rows: tree });
        expect(await stopperWith(ops)(42, registeredAt())).toEqual({ status: "stopped" });
        expect(ops.signals).toEqual([{ pids: [42, 43, 44], force: false }]);
    });

    it("waits for descendants that outlive the registered pid and kills them", async () => {
        // The wrapper exits on SIGTERM; its child keeps the port.
        const ops = fakeOps({ rows: tree, survivesTerm: [43] });
        expect(await stopperWith(ops)(42, registeredAt())).toEqual({ status: "stopped" });
        expect(ops.signals).toEqual([
            { pids: [42, 43, 44], force: false },
            { pids: [43], force: true },
        ]);
    });

    it("fails when a process survives SIGKILL", async () => {
        const ops = fakeOps({ rows: tree, survivesTerm: [43], survivesKill: [43] });
        expect(await stopperWith(ops)(42, registeredAt())).toEqual({
            status: "failed",
            error: "Could not stop pid 42: process is still running",
        });
    });

    it("fails when the OS refuses the signal", async () => {
        const ops = fakeOps({ rows: tree, deny: true });
        expect(await stopperWith(ops)(42, registeredAt())).toEqual({
            status: "failed",
            error: "Could not stop pid 42: operation not permitted",
        });
        expect(ops.signals).toHaveLength(1);
        expect(ops.signals[0].pids[0]).toBe(42);
    });

    it("never signals a non-positive pid or the backend itself", async () => {
        const ops = fakeOps({
            rows: [
                { pid: 42, ppid: 1 },
                { pid: 0, ppid: 42 },
                { pid: process.pid, ppid: 42 },
            ],
        });
        await stopperWith(ops)(42, registeredAt());
        expect(ops.signals[0].pids).toEqual([42]);
    });

    it("skips a child that predates its parent (a stale ppid naming a reused pid)", async () => {
        const ops = fakeOps({
            rows: [
                { pid: 42, ppid: 1, startedMs: 2000 },
                { pid: 43, ppid: 42, startedMs: 1000 },
                { pid: 44, ppid: 42, startedMs: 3000 },
            ],
        });
        await stopperWith(ops)(42, registeredAt());
        expect(ops.signals[0].pids).toEqual([42, 44]);
    });

    it("lets an op failure propagate instead of reporting a result", async () => {
        const ops: ProcessOps = {
            ...fakeOps(),
            processes: () => Promise.reject(new Error("Could not list processes")),
        };
        await expectRejects(stopperWith(ops)(42, registeredAt()), "Could not list processes");
    });
});

function fakeRunner(respond: (command: string[]) => CommandResult): {
    run: CommandRunner;
    commands: string[][];
} {
    const commands: string[][] = [];
    return {
        commands,
        run: (command) => {
            commands.push(command);
            return Promise.resolve(respond(command));
        },
    };
}

function osError(code: string): Error {
    return Object.assign(new Error(code), { code });
}

/** A kill that records its calls and throws the given code for the given pids. */
function fakeKill(errors: Record<number, string> = {}): { kill: Kill; calls: unknown[][] } {
    const calls: unknown[][] = [];
    return {
        calls,
        kill: (pid, signal) => {
            calls.push([pid, signal]);
            const code = errors[pid];
            if (code) throw osError(code);
        },
    };
}

describe("createPosixProcessOps", () => {
    it("reads the start time from lstart in UTC", async () => {
        const { run, commands } = fakeRunner(() => ({
            exitCode: 0,
            stdout: "Sun Oct 11 17:58:30 2026\n",
        }));
        const ops = createPosixProcessOps(run, fakeKill().kill);
        expect(await ops.startTime(42)).toBe(Date.UTC(2026, 9, 11, 17, 58, 30) / 1000);
        expect(commands).toEqual([["ps", "-o", "lstart=", "-p", "42"]]);
    });

    it("parses a single-digit day", async () => {
        const { run } = fakeRunner(() => ({ exitCode: 0, stdout: "Thu Oct  1 09:05:03 2026\n" }));
        expect(await createPosixProcessOps(run, fakeKill().kill).startTime(42)).toBe(
            Date.UTC(2026, 9, 1, 9, 5, 3) / 1000,
        );
    });

    it("returns null when ps fails and the pid does not exist", async () => {
        const { run } = fakeRunner(() => ({ exitCode: 1, stdout: "" }));
        const { kill, calls } = fakeKill({ 42: "ESRCH" });
        expect(await createPosixProcessOps(run, kill).startTime(42)).toBeNull();
        expect(calls).toEqual([[42, 0]]);
    });

    it("throws when ps fails or prints garbage for a pid that exists", async () => {
        const failing = fakeRunner(() => ({ exitCode: 1, stdout: "" }));
        await expectRejects(
            createPosixProcessOps(failing.run, fakeKill().kill).startTime(42),
            "Could not read the start time of pid 42",
        );
        const garbage = fakeRunner(() => ({ exitCode: 0, stdout: "dim. 11 oct. 2026\n" }));
        await expectRejects(
            createPosixProcessOps(garbage.run, fakeKill({ 42: "EPERM" }).kill).startTime(42),
            "Could not read the start time of pid 42",
        );
    });

    it("reads one process table snapshot and leaves zombies out", async () => {
        const { run, commands } = fakeRunner(() => ({
            exitCode: 0,
            stdout: "    1     0 Ss\n   42     1 S\n   43    42 Z+\n",
        }));
        expect(await createPosixProcessOps(run, fakeKill().kill).processes()).toEqual([
            { pid: 1, ppid: 0 },
            { pid: 42, ppid: 1 },
        ]);
        expect(commands).toEqual([["ps", "-A", "-o", "pid=,ppid=,stat="]]);
    });

    it("throws instead of reporting an empty table when ps fails", async () => {
        for (const result of [
            { exitCode: 1, stdout: "" },
            { exitCode: 0, stdout: "" },
        ]) {
            const { run } = fakeRunner(() => result);
            await expectRejects(
                createPosixProcessOps(run, fakeKill().kill).processes(),
                "Could not list processes",
            );
        }
    });

    it("signals in order, skips exited pids, and stops at the first refusal", async () => {
        const { run } = fakeRunner(() => ({ exitCode: 0, stdout: "" }));

        const skipping = fakeKill({ 42: "ESRCH" });
        expect(await createPosixProcessOps(run, skipping.kill).signal([42, 43], false)).toBe(
            "sent",
        );
        expect(skipping.calls).toEqual([
            [42, "SIGTERM"],
            [43, "SIGTERM"],
        ]);

        const refusing = fakeKill({ 42: "EPERM" });
        expect(await createPosixProcessOps(run, refusing.kill).signal([42, 43], true)).toBe(
            "denied",
        );
        expect(refusing.calls).toEqual([[42, "SIGKILL"]]);
    });
});

describe("createWindowsProcessOps", () => {
    it("reads the start time through PowerShell", async () => {
        const { run, commands } = fakeRunner(() => ({ exitCode: 0, stdout: "1791720005\r\n" }));
        expect(await createWindowsProcessOps(run).startTime(42)).toBe(1791720005);
        expect(commands[0].slice(0, 4)).toEqual([
            "powershell",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
        ]);
        expect(commands[0][4]).toContain("Get-Process -Id 42");
    });

    it("returns null for a missing process and throws when it can't tell", async () => {
        const missing = fakeRunner(() => ({ exitCode: 0, stdout: "missing\r\n" }));
        expect(await createWindowsProcessOps(missing.run).startTime(42)).toBeNull();

        const broken = fakeRunner(() => ({ exitCode: 1, stdout: "" }));
        await expectRejects(
            createWindowsProcessOps(broken.run).startTime(42),
            "Could not read the start time of pid 42",
        );
    });

    it("reads the process table with creation times", async () => {
        const { run, commands } = fakeRunner(() => ({
            exitCode: 0,
            stdout: "4 0 0\r\n42 1 1791720000000\r\n43 42 1791720001000\r\n",
        }));
        expect(await createWindowsProcessOps(run).processes()).toEqual([
            { pid: 4, ppid: 0, startedMs: 0 },
            { pid: 42, ppid: 1, startedMs: 1791720000000 },
            { pid: 43, ppid: 42, startedMs: 1791720001000 },
        ]);
        expect(commands[0][4]).toContain("Win32_Process");
    });

    it("throws when the process table can't be read", async () => {
        const { run } = fakeRunner(() => ({ exitCode: 1, stdout: "" }));
        await expectRejects(createWindowsProcessOps(run).processes(), "Could not list processes");
    });

    it("forces each pid separately, without /T", async () => {
        const { run, commands } = fakeRunner(() => ({ exitCode: 0, stdout: "" }));
        expect(await createWindowsProcessOps(run).signal([42, 43], false)).toBe("sent");
        expect(commands).toEqual([
            ["taskkill", "/PID", "42", "/F"],
            ["taskkill", "/PID", "43", "/F"],
        ]);
    });

    it("counts a failed taskkill as refused only while the pid is still listed", async () => {
        const { run, commands } = fakeRunner((command) => {
            if (command[0] === "taskkill")
                return { exitCode: command[2] === "42" ? 128 : 1, stdout: "" };
            // 42 already exited; 43 is still there.
            return { exitCode: 0, stdout: "1 0 0\r\n43 1 1791720001000\r\n" };
        });
        expect(await createWindowsProcessOps(run).signal([42, 43, 44], true)).toBe("denied");
        expect(commands.filter((c) => c[0] === "taskkill").map((c) => c[2])).toEqual(["42", "43"]);
    });
});

describe.skipIf(process.platform === "win32")("process stopper on real processes", () => {
    const ops = createPosixProcessOps();
    const stopper = createProcessStopper({ termGraceMs: 2000, killGraceMs: 1000, pollMs: 20 });
    const spawned: Array<{ kill(signal?: number): void }> = [];
    const strays: number[] = [];

    afterEach(() => {
        for (const proc of spawned.splice(0)) proc.kill(9);
        for (const pid of strays.splice(0)) {
            try {
                process.kill(pid, "SIGKILL");
            } catch {
                // Already gone.
            }
        }
    });

    function spawnSh(script: string) {
        const proc = Bun.spawn(["sh", "-c", script], { stdout: "pipe", stderr: "ignore" });
        spawned.push(proc);
        return proc;
    }

    async function running(pids: number[]): Promise<number[]> {
        const live = new Set((await ops.processes()).map((row) => row.pid));
        return pids.filter((pid) => live.has(pid));
    }

    async function waitForChild(parent: number): Promise<number> {
        for (let attempt = 0; attempt < 100; attempt++) {
            const child = (await ops.processes()).find((row) => row.ppid === parent);
            if (child) return child.pid;
            await Bun.sleep(20);
        }
        throw new Error(`Process ${parent} never got a child`);
    }

    it("stops the registered process and its children", async () => {
        const parent = spawnSh("sleep 30 & wait");
        const tree = [parent.pid, await waitForChild(parent.pid)];
        strays.push(...tree);

        expect(await stopper(parent.pid, new Date().toISOString())).toEqual({ status: "stopped" });
        expect(await running(tree)).toEqual([]);
    });

    it("kills a tree that ignores SIGTERM", async () => {
        // An ignored signal stays ignored across fork and exec, so the sleep ignores TERM too.
        const parent = spawnSh('trap "" TERM; sleep 30 & wait');
        const tree = [parent.pid, await waitForChild(parent.pid)];
        strays.push(...tree);
        const quick = createProcessStopper({ termGraceMs: 200, killGraceMs: 1000, pollMs: 20 });

        expect(await quick(parent.pid, new Date().toISOString())).toEqual({ status: "stopped" });
        expect(await running(tree)).toEqual([]);
    });

    it("reports a pid that is not running as gone", async () => {
        const done = Bun.spawn(["true"]);
        await done.exited;
        expect(await stopper(done.pid, new Date().toISOString())).toEqual({ status: "gone" });
    });

    it("leaves a process alone when it started after the record was registered", async () => {
        const registeredAt = new Date(Date.now() - 10_000).toISOString();
        const proc = Bun.spawn(["sleep", "30"]);
        spawned.push(proc);

        expect(await stopper(proc.pid, registeredAt)).toEqual({ status: "reused" });
        expect(await running([proc.pid])).toEqual([proc.pid]);
    });

    it("reads the same start second as the clock for a process just started", async () => {
        const before = Math.floor(Date.now() / 1000);
        const proc = Bun.spawn(["sleep", "30"]);
        spawned.push(proc);
        const started = await ops.startTime(proc.pid);
        const after = Math.floor(Date.now() / 1000);

        expect(started).not.toBeNull();
        expect(started).toBeGreaterThanOrEqual(before);
        expect(started).toBeLessThanOrEqual(after);
    });

    it("does not signal the registered process's parent", async () => {
        // The wrapper stands in for the agent's shell: it must survive the stop.
        const wrapper = spawnSh("sleep 30 & echo $!; wait; sleep 30");
        const reader = wrapper.stdout.getReader();
        const { value } = await reader.read();
        reader.releaseLock();
        const child = Number(new TextDecoder().decode(value).trim());
        expect(child).toBeGreaterThan(0);
        strays.push(child);

        expect(await stopper(child, new Date().toISOString())).toEqual({ status: "stopped" });
        expect(await running([child])).toEqual([]);
        expect(await running([wrapper.pid])).toEqual([wrapper.pid]);
    });
});
