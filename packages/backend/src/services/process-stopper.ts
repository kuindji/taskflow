type StopOutcome =
    | { status: "stopped" }
    | { status: "gone" }
    | { status: "reused" }
    | { status: "failed"; error: string };

type StopProcess = (pid: number, registeredAt: string) => Promise<StopOutcome>;

interface CommandResult {
    exitCode: number;
    stdout: string;
}

type CommandRunner = (command: string[]) => Promise<CommandResult>;

type Kill = (pid: number, signal: "SIGTERM" | "SIGKILL" | 0) => void;

/** One live process from a snapshot of the OS process table. */
interface ProcessRow {
    pid: number;
    ppid: number;
    /** Epoch ms. Windows only: there a ppid can name a parent that exited and whose pid was reused. */
    startedMs?: number;
}

/** The OS calls a stop needs. The real implementations are below; tests inject fakes. */
interface ProcessOps {
    /** Start time in whole epoch seconds; null when the pid isn't running. Throws when it can't tell. */
    startTime(pid: number): Promise<number | null>;
    /** Every live process, zombies left out, from one snapshot. Throws when the table can't be read. */
    processes(): Promise<ProcessRow[]>;
    /**
     * Ask the pids to exit (force = kill), in order, stopping at the first refusal.
     * The stopper passes the registered pid first, so a refused root signals nothing below it.
     */
    signal(pids: number[], force: boolean): Promise<"sent" | "denied">;
}

const runCommand: CommandRunner = async (command) => {
    // A command that can't be spawned throws, and the stop fails with it: it must
    // never read as "not running".
    const proc = Bun.spawn(command, {
        stdout: "pipe",
        stderr: "ignore",
        // `ps -o lstart=` then prints English names, in UTC.
        env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return { exitCode, stdout };
};

const realKill: Kill = (pid, signal) => {
    process.kill(pid, signal);
};

function errorCode(error: unknown): unknown {
    return error instanceof Error && "code" in error ? error.code : undefined;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// `ps -o lstart=` under LC_ALL=C and TZ=UTC: "Sun Oct 11 17:58:30 2026".
function parseLstart(text: string): number | null {
    const match =
        /^[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/.exec(
            text.trim(),
        );
    if (!match) return null;
    const [, month, day, hours, minutes, seconds, year] = match;
    const monthIndex = MONTHS.indexOf(month);
    if (monthIndex === -1) return null;
    return (
        Date.UTC(
            Number(year),
            monthIndex,
            Number(day),
            Number(hours),
            Number(minutes),
            Number(seconds),
        ) / 1000
    );
}

function createPosixProcessOps(run: CommandRunner = runCommand, kill: Kill = realKill): ProcessOps {
    /** kill(pid, 0). EPERM means it exists but belongs to someone else. */
    function exists(pid: number): boolean {
        try {
            kill(pid, 0);
            return true;
        } catch (error) {
            if (errorCode(error) === "ESRCH") return false;
            if (errorCode(error) === "EPERM") return true;
            throw error;
        }
    }

    return {
        async startTime(pid) {
            const { exitCode, stdout } = await run(["ps", "-o", "lstart=", "-p", String(pid)]);
            const started = exitCode === 0 ? parseLstart(stdout) : null;
            if (started !== null) return started;
            // ps fails the same way for a pid that exited and for a broken ps.
            if (!exists(pid)) return null;
            throw new Error(`Could not read the start time of pid ${pid}`);
        },
        async processes() {
            const { exitCode, stdout } = await run(["ps", "-A", "-o", "pid=,ppid=,stat="]);
            const rows: ProcessRow[] = [];
            for (const line of stdout.split("\n")) {
                const [pid, ppid, stat] = line.trim().split(/\s+/);
                if (!pid || !ppid || !stat || stat.startsWith("Z")) continue;
                rows.push({ pid: Number(pid), ppid: Number(ppid) });
            }
            // An empty table would read as "everything stopped". It always holds ps itself.
            if (exitCode !== 0 || rows.length === 0) throw new Error("Could not list processes");
            return rows;
        },
        signal(pids, force) {
            for (const pid of pids) {
                try {
                    kill(pid, force ? "SIGKILL" : "SIGTERM");
                } catch (error) {
                    if (errorCode(error) === "EPERM") return Promise.resolve("denied");
                    // ESRCH: it exited on its own.
                    if (errorCode(error) !== "ESRCH") throw error;
                }
            }
            return Promise.resolve("sent");
        },
    };
}

function powershell(script: string): string[] {
    return ["powershell", "-NoProfile", "-NonInteractive", "-Command", script];
}

function createWindowsProcessOps(run: CommandRunner = runCommand): ProcessOps {
    async function processes(): Promise<ProcessRow[]> {
        const { exitCode, stdout } = await run(
            powershell(
                "Get-CimInstance Win32_Process | ForEach-Object { $t = if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }; '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $t }",
            ),
        );
        const rows: ProcessRow[] = [];
        for (const line of stdout.split(/\r?\n/)) {
            const match = /^(\d+) (\d+) (\d+)$/.exec(line.trim());
            if (match) {
                rows.push({
                    pid: Number(match[1]),
                    ppid: Number(match[2]),
                    startedMs: Number(match[3]),
                });
            }
        }
        if (exitCode !== 0 || rows.length === 0) throw new Error("Could not list processes");
        return rows;
    }

    return {
        async startTime(pid) {
            const { exitCode, stdout } = await run(
                powershell(
                    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -eq $p) { 'missing' } else { ([DateTimeOffset]$p.StartTime).ToUnixTimeSeconds() }`,
                ),
            );
            const text = stdout.trim();
            if (exitCode === 0 && text === "missing") return null;
            if (exitCode === 0 && /^\d+$/.test(text)) return Number(text);
            throw new Error(`Could not read the start time of pid ${pid}`);
        },
        processes,
        // Both phases force: taskkill without /F only asks windowed apps to close, and a
        // console dev server ignores it. No /T: the stopper already has the tree.
        async signal(pids) {
            for (const pid of pids) {
                const { exitCode } = await run(["taskkill", "/PID", String(pid), "/F"]);
                if (exitCode === 0) continue;
                // It may have exited on its own; if it's still there, the OS refused.
                if ((await processes()).some((row) => row.pid === pid)) return "denied";
            }
            return "sent";
        },
    };
}

/**
 * The pid followed by its descendants. A child that started before its parent is
 * skipped: its ppid names an earlier holder of that pid (Windows keeps stale ppids).
 */
function collectTree(rows: ProcessRow[], pid: number): number[] {
    const startedMs = new Map(rows.map((row) => [row.pid, row.startedMs]));
    const children = new Map<number, ProcessRow[]>();
    for (const row of rows) {
        const siblings = children.get(row.ppid) ?? [];
        siblings.push(row);
        children.set(row.ppid, siblings);
    }
    const result = [pid];
    // for..of sees the entries pushed while it runs, so this walks every generation.
    for (const current of result) {
        const parentStarted = startedMs.get(current);
        for (const child of children.get(current) ?? []) {
            if (result.includes(child.pid)) continue;
            if (
                parentStarted !== undefined &&
                child.startedMs !== undefined &&
                child.startedMs < parentStarted
            ) {
                continue;
            }
            result.push(child.pid);
        }
    }
    return result;
}

interface StopperOptions {
    ops?: ProcessOps;
    termGraceMs?: number;
    killGraceMs?: number;
    pollMs?: number;
}

function createProcessStopper(options: StopperOptions = {}): StopProcess {
    const ops =
        options.ops ??
        (process.platform === "win32" ? createWindowsProcessOps() : createPosixProcessOps());
    const termGraceMs = options.termGraceMs ?? 3000;
    const killGraceMs = options.killGraceMs ?? 1000;
    const pollMs = options.pollMs ?? 100;

    async function running(pids: number[]): Promise<number[]> {
        const live = new Set((await ops.processes()).map((row) => row.pid));
        return pids.filter((pid) => live.has(pid));
    }

    async function waitForExit(pids: number[], graceMs: number): Promise<number[]> {
        const deadline = Date.now() + graceMs;
        for (;;) {
            const left = await running(pids);
            if (left.length === 0 || Date.now() >= deadline) return left;
            await Bun.sleep(pollMs);
        }
    }

    const failed = (pid: number, reason: string): StopOutcome => ({
        status: "failed",
        error: `Could not stop pid ${pid}: ${reason}`,
    });

    return async (pid, registeredAt) => {
        const started = await ops.startTime(pid);
        if (started === null) return { status: "gone" };
        // Whole seconds on both sides: a process that started in a later second
        // than the registration is a different one that got the pid.
        if (started > Math.floor(Date.parse(registeredAt) / 1000)) return { status: "reused" };

        // Registered pid first: signal stops at the first refusal, so a pid we may
        // not signal (PID 1, another user's) never gets its descendants signalled.
        // Never 0 or a negative pid (a process group: background jobs share the
        // agent's group, so a group kill could take the agent down), never the backend.
        const pids = collectTree(await ops.processes(), pid).filter(
            (p) => p > 0 && p !== process.pid,
        );
        if ((await ops.signal(pids, false)) === "denied")
            return failed(pid, "operation not permitted");
        const survivors = await waitForExit(pids, termGraceMs);
        if (survivors.length === 0) return { status: "stopped" };

        if ((await ops.signal(survivors, true)) === "denied") {
            return failed(pid, "operation not permitted");
        }
        const left = await waitForExit(survivors, killGraceMs);
        return left.length === 0 ? { status: "stopped" } : failed(pid, "process is still running");
    };
}

export { createPosixProcessOps, createProcessStopper, createWindowsProcessOps };
export type {
    CommandResult,
    CommandRunner,
    Kill,
    ProcessOps,
    ProcessRow,
    StopOutcome,
    StopProcess,
};
