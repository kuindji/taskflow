# Section 1: Shared types, store, process stopper, service

Read first: the plan index (`../2026-10-11-dev-servers.md`), especially "Cross-section interfaces" and "Global Constraints"; then `handoff.md`; then the spec sections "Record", "Storage" and "Stop service".

This section adds:

- the shared `DevServer` types and the two `MSG` entries;
- `DevServerStore`, a JSON file of records serialized through a `KeyedQueue`;
- `process-stopper.ts`, the one-shot stop: PID-reuse guard, tree collection, SIGTERM, then SIGKILL;
- `DevServerService`, which validates input, runs stops, and broadcasts the full list after every change.

Nothing is wired into the backend yet. Section 2 does that.

**Deviation from the spec (record it under "Amendments" in the spec when you implement this section):** the spec reads the start time with `ps -o lstart=`. This plan uses `ps -o etime=` instead. `etime` prints `[[dd-]hh:]mm:ss` in every locale, while `lstart` prints locale-dependent month and day names. The start time is computed as `floor(now) - etime`. Because `etime` and `now` are both whole seconds, the computed start can be up to one second late. So the reuse rule is: **reused iff `startSec > floor(registeredAtMs / 1000) + 1`**.

### Task 1: Shared types and `DevServerStore`

**Files:**
- Create: `packages/shared/src/types/dev-server.ts`
- Modify: `packages/shared/src/index.ts`. Add `export * from "./types/dev-server";` directly after the `./types/notification` line.
- Modify: `packages/shared/src/constants.ts`. Add the two `MSG` entries after the `// Notifications` block (around line 207).
- Create: `packages/backend/src/services/dev-server-store.ts`
- Test: `packages/backend/tests/services/dev-server-store.test.ts`

**Interfaces:**
- Produces (shared): `DevServer`, `DevServerListResponse`, `DevServerStopPayload`, `DevServerStopResult` (exactly as in the plan index), `MSG.DEV_SERVER_LIST = "devserver:list"` and `MSG.DEV_SERVER_STOP = "devserver:stop"`.
- Produces (backend `dev-server-store.ts`):
  - `interface DevServerInput { pid: number; label: string; projectId: string; taskId?: string; sessionId?: string }` (type export);
  - `class DevServerStore` with:
    - `constructor(filePath: string)`
    - `list(): Promise<DevServer[]>`
    - `get(id: string): Promise<DevServer | null>`
    - `add(input: DevServerInput): Promise<DevServer>`
    - `remove(id: string): Promise<boolean>`
    - `removeByPid(pid: number): Promise<boolean>`
- Store behaviour:
  - Every read and write goes through one `KeyedQueue` key, so a `list()` called after a write always sees that write. Task 3's broadcast ordering depends on this.
  - A missing or unparsable file reads as `[]`. Records are disposable.
  - `add` with a PID already in the file replaces that record in place: new `label`, `projectId`, `taskId`, `sessionId` and `registeredAt`, same `id`, same position. `taskId` and `sessionId` are dropped if the new input lacks them.
  - The store does no validation. `DevServerService` (Task 3) does.

- [ ] **Step 1: Add the shared types and constants**

Create `packages/shared/src/types/dev-server.ts`:

```ts
/** A long-running process an agent registered for the user (a dev server). Taskflow only stores it. */
export interface DevServer {
    id: string;
    pid: number;
    label: string;
    /** ISO timestamp. Also the PID-reuse guard: a process that started later is a different one. */
    registeredAt: string;
    projectId: string;
    taskId?: string;
    sessionId?: string;
}

export interface DevServerListResponse {
    devServers: DevServer[];
}

export interface DevServerStopPayload {
    id: string;
}

export type DevServerStopResult = { ok: true } | { ok: false; error: string };
```

In `packages/shared/src/index.ts`, after `export * from "./types/notification";`:

```ts
export * from "./types/dev-server";
```

In `packages/shared/src/constants.ts`, after the `NOTIFICATION_DELETED` line and before `// Master workspace`:

```ts

    // Dev servers
    DEV_SERVER_LIST: "devserver:list",
    DEV_SERVER_STOP: "devserver:stop",
```

- [ ] **Step 2: Write the failing store tests**

Create `packages/backend/tests/services/dev-server-store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { DevServerStore } from "../../src/services/dev-server-store";

describe("DevServerStore", () => {
    let dir: string;
    let file: string;
    let store: DevServerStore;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "dev-server-store-"));
        file = join(dir, "dev-servers-main.json");
        store = new DevServerStore(file);
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("reads a missing file as empty", async () => {
        expect(await store.list()).toEqual([]);
    });

    it("reads an unparsable file as empty", async () => {
        await writeFile(file, "{not json");
        expect(await store.list()).toEqual([]);
    });

    it("adds a record with an id and registeredAt, and persists it", async () => {
        const before = Date.now();
        const added = await store.add({
            pid: 4242,
            label: "Vite :5173",
            projectId: "p1",
            taskId: "t1",
            sessionId: "s1",
        });

        expect(added.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(added).toMatchObject({
            pid: 4242,
            label: "Vite :5173",
            projectId: "p1",
            taskId: "t1",
            sessionId: "s1",
        });
        expect(Date.parse(added.registeredAt)).toBeGreaterThanOrEqual(before);
        expect(JSON.parse(await readFile(file, "utf-8")) as unknown).toEqual([added]);
        expect(await new DevServerStore(file).list()).toEqual([added]);
    });

    it("leaves out taskId and sessionId when they are not given", async () => {
        const added = await store.add({ pid: 7, label: "API :3000", projectId: "p1" });
        expect(added).not.toHaveProperty("taskId");
        expect(added).not.toHaveProperty("sessionId");
    });

    it("re-adding a pid replaces label, owner and registeredAt in place and keeps the id", async () => {
        const first = await store.add({
            pid: 10,
            label: "old",
            projectId: "p1",
            taskId: "t1",
            sessionId: "s1",
        });
        const other = await store.add({ pid: 11, label: "other", projectId: "p1" });
        await Bun.sleep(5);

        const second = await store.add({ pid: 10, label: "new", projectId: "p2" });

        expect(second.id).toBe(first.id);
        expect(second.label).toBe("new");
        expect(second.projectId).toBe("p2");
        expect(second).not.toHaveProperty("taskId");
        expect(second).not.toHaveProperty("sessionId");
        expect(Date.parse(second.registeredAt)).toBeGreaterThan(Date.parse(first.registeredAt));
        expect(await store.list()).toEqual([second, other]);
    });

    it("gets, removes by id and removes by pid", async () => {
        const a = await store.add({ pid: 1001, label: "a", projectId: "p" });
        await store.add({ pid: 1002, label: "b", projectId: "p" });

        expect(await store.get(a.id)).toEqual(a);
        expect(await store.get("missing")).toBeNull();
        expect(await store.remove(a.id)).toBe(true);
        expect(await store.remove(a.id)).toBe(false);
        expect(await store.removeByPid(1002)).toBe(true);
        expect(await store.removeByPid(1002)).toBe(false);
        expect(await store.list()).toEqual([]);
    });

    it("serializes concurrent adds", async () => {
        const pids = Array.from({ length: 10 }, (_, i) => 2000 + i);
        await Promise.all(pids.map((pid) => store.add({ pid, label: `s${pid}`, projectId: "p" })));
        expect((await store.list()).map((s) => s.pid).sort((x, y) => x - y)).toEqual(pids);
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/dev-server-store.test.ts`
Expected: FAIL with `Cannot find module '../../src/services/dev-server-store'`.

- [ ] **Step 4: Implement the store**

Create `packages/backend/src/services/dev-server-store.ts`:

```ts
import type { DevServer } from "@taskflow/shared";
import { readFile } from "fs/promises";
import { randomUUID } from "crypto";
import { KeyedQueue } from "./keyed-queue";
import { writeJsonAtomic } from "./write-file-atomic";

interface DevServerInput {
    pid: number;
    label: string;
    projectId: string;
    taskId?: string;
    sessionId?: string;
}

// One key for the whole file: reads and writes run in call order, so a list
// read after a write sees it. DevServerService relies on that to broadcast
// lists in mutation order.
const FILE_KEY = "file";

function isMissingFileError(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

class DevServerStore {
    private readonly filePath: string;
    private readonly queue = new KeyedQueue();

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    private async readAll(): Promise<DevServer[]> {
        let raw: string;
        try {
            raw = await readFile(this.filePath, "utf-8");
        } catch (error) {
            if (isMissingFileError(error)) return [];
            throw error;
        }
        try {
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as DevServer[]) : [];
        } catch {
            // Records are disposable: a torn or hand-edited file must not block the feature.
            return [];
        }
    }

    list(): Promise<DevServer[]> {
        return this.queue.run(FILE_KEY, () => this.readAll());
    }

    get(id: string): Promise<DevServer | null> {
        return this.queue.run(
            FILE_KEY,
            async () => (await this.readAll()).find((server) => server.id === id) ?? null,
        );
    }

    add(input: DevServerInput): Promise<DevServer> {
        return this.queue.run(FILE_KEY, async () => {
            const servers = await this.readAll();
            const index = servers.findIndex((server) => server.pid === input.pid);
            const server: DevServer = {
                id: index === -1 ? randomUUID() : servers[index].id,
                pid: input.pid,
                label: input.label,
                registeredAt: new Date().toISOString(),
                projectId: input.projectId,
                ...(input.taskId ? { taskId: input.taskId } : {}),
                ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            };
            if (index === -1) servers.push(server);
            else servers[index] = server;
            await writeJsonAtomic(this.filePath, servers);
            return server;
        });
    }

    remove(id: string): Promise<boolean> {
        return this.removeWhere((server) => server.id === id);
    }

    removeByPid(pid: number): Promise<boolean> {
        return this.removeWhere((server) => server.pid === pid);
    }

    private removeWhere(match: (server: DevServer) => boolean): Promise<boolean> {
        return this.queue.run(FILE_KEY, async () => {
            const servers = await this.readAll();
            const kept = servers.filter((server) => !match(server));
            if (kept.length === servers.length) return false;
            await writeJsonAtomic(this.filePath, kept);
            return true;
        });
    }
}

export { DevServerStore };
export type { DevServerInput };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/dev-server-store.test.ts`
Expected: PASS (7 tests).

Run: `bun run typecheck` (repo root)
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
bunx prettier --write packages/shared/src/types/dev-server.ts packages/shared/src/index.ts packages/shared/src/constants.ts packages/backend/src/services/dev-server-store.ts packages/backend/tests/services/dev-server-store.test.ts
bunx eslint packages/shared/src/types/dev-server.ts packages/shared/src/constants.ts packages/backend/src/services/dev-server-store.ts packages/backend/tests/services/dev-server-store.test.ts
git add packages/shared/src/types/dev-server.ts packages/shared/src/index.ts packages/shared/src/constants.ts packages/backend/src/services/dev-server-store.ts packages/backend/tests/services/dev-server-store.test.ts
git commit -m "feat(backend): dev server records and store"
```

### Task 2: Process stopper

**Files:**
- Create: `packages/backend/src/services/process-stopper.ts`
- Test: `packages/backend/tests/services/process-stopper.test.ts`

**Interfaces:**
- Produces (type exports): `StopOutcome` and `StopProcess` (exactly as in the plan index), plus `ProcessOps`, `CommandRunner` and `CommandResult`.

  ```ts
  interface CommandResult { exitCode: number; stdout: string }
  type CommandRunner = (command: string[]) => Promise<CommandResult>;
  interface ProcessOps {
      startTime(pid: number): Promise<number | null>; // epoch seconds; null = not running
      tree(pid: number): Promise<number[]>; // pid first, then descendants
      signal(pids: number[], force: boolean): Promise<"sent" | "denied">;
      running(pids: number[]): Promise<number[]>; // subset still running; zombies count as gone
  }
  ```
- Produces (value exports):
  - `createProcessStopper(options?: { ops?: ProcessOps; termGraceMs?: number; killGraceMs?: number; pollMs?: number }): StopProcess`. Defaults: platform ops, 3000 ms, 1000 ms, 100 ms.
  - `createPosixProcessOps(run?: CommandRunner, now?: () => number): ProcessOps`
  - `createWindowsProcessOps(run?: CommandRunner): ProcessOps`
  Tests import the two ops factories. Section 1 Task 3 imports `createProcessStopper`.
- Stop algorithm:
  1. `startTime === null` → `gone`.
  2. `startTime > floor(registeredAt / 1000) + 1` → `reused`, with no signal.
  3. `tree` → filter out PIDs `<= 0` and `process.pid`.
  4. SIGTERM all. If `denied`, return `failed` with `operation not permitted`.
  5. Wait for exit up to `termGraceMs`.
  6. SIGKILL the survivors. If `denied`, return `failed` with `operation not permitted`.
  7. Wait up to `killGraceMs`. If any PID is left, return `failed` with `process is still running`. Otherwise return `stopped`.
- POSIX ops:
  - `ps` runs with `LC_ALL=C`.
  - `startTime`: `ps -o etime= -p <pid>`. `now` is read **before** running `ps`, which biases towards "not reused".
  - `tree`: one `ps -A -o pid=,ppid=` snapshot.
  - `signal`: `process.kill` per PID. ESRCH is ignored; EPERM means denied.
  - `running`: one `ps -A -o pid=,stat=` snapshot. A `stat` starting with `Z` (zombie) counts as gone.
  - If `ps` fails in `running`, it throws, so a broken `ps` never reads as "everything stopped".
- Windows ops:
  - `startTime`: PowerShell `(Get-Process -Id <pid>).StartTime.ToUniversalTime().ToString('o')`.
  - `tree`: `[pid]`, because `taskkill /T` walks the tree itself.
  - `signal`: `taskkill /PID <pid> /T`, plus `/F` when forced.
  - `running`: `tasklist /FI "PID eq <pid>" /NH /FO CSV`, matching `"<pid>"`.
  - These are unit-tested through a fake `CommandRunner` only. Real Windows behaviour is covered by Section 5's manual check, if a Windows machine is available.
- **Never signal a negative PID.** A negative PID addresses a process group, and background jobs from a non-interactive shell share the agent's process group.

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/tests/services/process-stopper.test.ts`:

```ts
import { afterEach, describe, expect, it } from "bun:test";
import {
    createPosixProcessOps,
    createProcessStopper,
    createWindowsProcessOps,
} from "../../src/services/process-stopper";
import type {
    CommandResult,
    CommandRunner,
    ProcessOps,
} from "../../src/services/process-stopper";

const nowSec = () => Math.floor(Date.now() / 1000);

interface FakeOptions {
    start?: number | null;
    tree?: number[];
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
    return {
        signals,
        startTime: () => Promise.resolve(options.start === undefined ? nowSec() - 60 : options.start),
        tree: (pid) => Promise.resolve(options.tree ?? [pid]),
        signal: (pids, force) => {
            signals.push({ pids, force });
            phase = force ? "kill" : "term";
            return Promise.resolve(options.deny ? "denied" : "sent");
        },
        running: (pids) => {
            if (phase === "before") return Promise.resolve(pids);
            const survivors =
                phase === "term" ? (options.survivesTerm ?? []) : (options.survivesKill ?? []);
            return Promise.resolve(pids.filter((pid) => survivors.includes(pid)));
        },
    };
}

function stopperWith(ops: ProcessOps) {
    return createProcessStopper({ ops, termGraceMs: 0, killGraceMs: 0, pollMs: 1 });
}

describe("createProcessStopper", () => {
    const registeredAt = () => new Date().toISOString();

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

    it("allows one second of slack at the reuse boundary", async () => {
        const at = "2026-10-11T12:00:00.500Z";
        const registeredSec = Math.floor(Date.parse(at) / 1000);

        const atBoundary = fakeOps({ start: registeredSec + 1 });
        expect(await stopperWith(atBoundary)(42, at)).toEqual({ status: "stopped" });

        const past = fakeOps({ start: registeredSec + 2 });
        expect(await stopperWith(past)(42, at)).toEqual({ status: "reused" });
        expect(past.signals).toEqual([]);
    });

    it("sends SIGTERM to the whole tree and reports stopped", async () => {
        const ops = fakeOps({ tree: [42, 43, 44] });
        expect(await stopperWith(ops)(42, registeredAt())).toEqual({ status: "stopped" });
        expect(ops.signals).toEqual([{ pids: [42, 43, 44], force: false }]);
    });

    it("escalates to SIGKILL for the survivors only", async () => {
        const ops = fakeOps({ tree: [42, 43], survivesTerm: [43] });
        expect(await stopperWith(ops)(42, registeredAt())).toEqual({ status: "stopped" });
        expect(ops.signals).toEqual([
            { pids: [42, 43], force: false },
            { pids: [43], force: true },
        ]);
    });

    it("fails when a process survives SIGKILL", async () => {
        const ops = fakeOps({ tree: [42, 43], survivesTerm: [43], survivesKill: [43] });
        expect(await stopperWith(ops)(42, registeredAt())).toEqual({
            status: "failed",
            error: "Could not stop pid 42: process is still running",
        });
    });

    it("fails when the OS refuses the signal", async () => {
        const ops = fakeOps({ deny: true });
        expect(await stopperWith(ops)(42, registeredAt())).toEqual({
            status: "failed",
            error: "Could not stop pid 42: operation not permitted",
        });
        expect(ops.signals).toHaveLength(1);
    });

    it("never signals a non-positive pid or the backend itself", async () => {
        const ops = fakeOps({ tree: [42, 0, -7, process.pid] });
        await stopperWith(ops)(42, registeredAt());
        expect(ops.signals[0].pids).toEqual([42]);
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

describe("createPosixProcessOps", () => {
    const now = Date.parse("2026-10-11T12:00:00.000Z");
    const nowSeconds = now / 1000;

    it("computes the start time from etime with days", async () => {
        const { run, commands } = fakeRunner(() => ({ exitCode: 0, stdout: " 01-02:03:04\n" }));
        const ops = createPosixProcessOps(run, () => now);
        expect(await ops.startTime(42)).toBe(nowSeconds - (86400 + 2 * 3600 + 3 * 60 + 4));
        expect(commands).toEqual([["ps", "-o", "etime=", "-p", "42"]]);
    });

    it("computes the start time from a short etime", async () => {
        const { run } = fakeRunner(() => ({ exitCode: 0, stdout: "05:07\n" }));
        expect(await createPosixProcessOps(run, () => now).startTime(42)).toBe(nowSeconds - 307);
    });

    it("returns null when ps does not find the pid", async () => {
        const { run } = fakeRunner(() => ({ exitCode: 1, stdout: "" }));
        expect(await createPosixProcessOps(run, () => now).startTime(42)).toBeNull();
    });

    it("collects descendants from one ps snapshot", async () => {
        const { run, commands } = fakeRunner(() => ({
            exitCode: 0,
            stdout: "    1     0\n   42     1\n   43    42\n   44    43\n   50     1\n",
        }));
        expect(await createPosixProcessOps(run, () => now).tree(42)).toEqual([42, 43, 44]);
        expect(commands).toEqual([["ps", "-A", "-o", "pid=,ppid="]]);
    });

    it("counts zombies and missing pids as not running", async () => {
        const { run } = fakeRunner(() => ({ exitCode: 0, stdout: "   42 S\n   43 Z+\n" }));
        expect(await createPosixProcessOps(run, () => now).running([42, 43, 44])).toEqual([42]);
    });

    it("throws instead of reporting everything stopped when ps fails", async () => {
        const { run } = fakeRunner(() => ({ exitCode: 1, stdout: "" }));
        let error: unknown;
        try {
            await createPosixProcessOps(run, () => now).running([42]);
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(Error);
    });
});

describe("createWindowsProcessOps", () => {
    it("reads the start time through PowerShell", async () => {
        const { run, commands } = fakeRunner(() => ({
            exitCode: 0,
            stdout: "2026-10-11T12:00:05.7000000Z\r\n",
        }));
        const ops = createWindowsProcessOps(run);
        expect(await ops.startTime(42)).toBe(Date.parse("2026-10-11T12:00:05Z") / 1000);
        expect(commands[0].slice(0, 3)).toEqual(["powershell", "-NoProfile", "-Command"]);
        expect(commands[0][3]).toContain("Get-Process -Id 42");
    });

    it("returns null when the process does not exist", async () => {
        const { run } = fakeRunner(() => ({ exitCode: 1, stdout: "" }));
        expect(await createWindowsProcessOps(run).startTime(42)).toBeNull();
    });

    it("lets taskkill walk the tree, forcing only when asked", async () => {
        const { run, commands } = fakeRunner(() => ({ exitCode: 0, stdout: "" }));
        const ops = createWindowsProcessOps(run);
        expect(await ops.tree(42)).toEqual([42]);
        await ops.signal([42], false);
        await ops.signal([42], true);
        expect(commands).toEqual([
            ["taskkill", "/PID", "42", "/T"],
            ["taskkill", "/PID", "42", "/T", "/F"],
        ]);
    });

    it("finds running pids in tasklist CSV output", async () => {
        const { run } = fakeRunner((command) => ({
            exitCode: 0,
            stdout: command.includes("PID eq 42")
                ? '"node.exe","42","Console","1","10,000 K"\r\n'
                : "INFO: No tasks are running which match the specified criteria.\r\n",
        }));
        expect(await createWindowsProcessOps(run).running([42, 43])).toEqual([42]);
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

    async function waitForTree(pid: number, size: number): Promise<number[]> {
        for (let attempt = 0; attempt < 100; attempt++) {
            const tree = await ops.tree(pid);
            if (tree.length >= size) return tree;
            await Bun.sleep(20);
        }
        throw new Error(`Process tree of ${pid} never reached ${size} processes`);
    }

    it("stops the registered process and its children", async () => {
        const parent = spawnSh("sleep 30 & wait");
        const tree = await waitForTree(parent.pid, 2);
        strays.push(...tree);

        expect(await stopper(parent.pid, new Date().toISOString())).toEqual({ status: "stopped" });
        expect(await ops.running(tree)).toEqual([]);
    });

    it("kills a tree that ignores SIGTERM", async () => {
        // An ignored signal stays ignored across fork and exec, so the sleep ignores TERM too.
        const parent = spawnSh('trap "" TERM; sleep 30 & wait');
        const tree = await waitForTree(parent.pid, 2);
        strays.push(...tree);
        const quick = createProcessStopper({ termGraceMs: 200, killGraceMs: 1000, pollMs: 20 });

        expect(await quick(parent.pid, new Date().toISOString())).toEqual({ status: "stopped" });
        expect(await ops.running(tree)).toEqual([]);
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
        expect(await ops.running([proc.pid])).toEqual([proc.pid]);
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
        expect(await ops.running([child])).toEqual([]);
        expect(await ops.running([wrapper.pid])).toEqual([wrapper.pid]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/process-stopper.test.ts`
Expected: FAIL with `Cannot find module '../../src/services/process-stopper'`.

- [ ] **Step 3: Implement the stopper**

Create `packages/backend/src/services/process-stopper.ts`:

```ts
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

/** The OS calls a stop needs. The real implementations are below; tests inject fakes. */
interface ProcessOps {
    /** Start time in epoch seconds, or null when the pid isn't running. */
    startTime(pid: number): Promise<number | null>;
    /** The pid followed by its descendants, from one snapshot. */
    tree(pid: number): Promise<number[]>;
    /** Ask the pids to exit (force = kill). "denied" when the OS refused any of them. */
    signal(pids: number[], force: boolean): Promise<"sent" | "denied">;
    /** The subset of pids still running. Zombies count as gone. */
    running(pids: number[]): Promise<number[]>;
}

const runCommand: CommandRunner = async (command) => {
    try {
        const proc = Bun.spawn(command, {
            stdout: "pipe",
            stderr: "ignore",
            env: { ...process.env, LC_ALL: "C" },
        });
        const [stdout, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            proc.exited,
        ]);
        return { exitCode, stdout };
    } catch {
        // The command itself is missing (no powershell, no ps).
        return { exitCode: -1, stdout: "" };
    }
};

function errorCode(error: unknown): unknown {
    return error instanceof Error && "code" in error ? error.code : undefined;
}

// `ps -o etime=` prints [[dd-]hh:]mm:ss in every locale.
function parseEtime(text: string): number | null {
    const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(text.trim());
    if (!match) return null;
    const [, days, hours, minutes, seconds] = match;
    return (
        Number(days ?? 0) * 86400 +
        Number(hours ?? 0) * 3600 +
        Number(minutes) * 60 +
        Number(seconds)
    );
}

function createPosixProcessOps(
    run: CommandRunner = runCommand,
    now: () => number = Date.now,
): ProcessOps {
    return {
        async startTime(pid) {
            // Read the clock before ps: a late clock would push the start later
            // and towards a false "reused".
            const nowSec = Math.floor(now() / 1000);
            const { exitCode, stdout } = await run(["ps", "-o", "etime=", "-p", String(pid)]);
            if (exitCode !== 0) return null;
            const elapsed = parseEtime(stdout);
            return elapsed === null ? null : nowSec - elapsed;
        },
        async tree(pid) {
            const { stdout } = await run(["ps", "-A", "-o", "pid=,ppid="]);
            const children = new Map<number, number[]>();
            for (const line of stdout.split("\n")) {
                const [child, parent] = line.trim().split(/\s+/).map(Number);
                if (!child || parent === undefined || Number.isNaN(parent)) continue;
                const siblings = children.get(parent) ?? [];
                siblings.push(child);
                children.set(parent, siblings);
            }
            const result = [pid];
            // for..of sees the entries pushed while it runs, so this walks every generation.
            for (const current of result) {
                for (const child of children.get(current) ?? []) {
                    if (!result.includes(child)) result.push(child);
                }
            }
            return result;
        },
        signal(pids, force) {
            let denied = false;
            for (const pid of pids) {
                try {
                    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
                } catch (error) {
                    // ESRCH: it exited on its own. Anything else that isn't EPERM can't happen for a positive pid.
                    if (errorCode(error) === "EPERM") denied = true;
                }
            }
            return Promise.resolve(denied ? "denied" : "sent");
        },
        async running(pids) {
            const { exitCode, stdout } = await run(["ps", "-A", "-o", "pid=,stat="]);
            // An empty snapshot would read as "everything stopped".
            if (exitCode !== 0) throw new Error("Could not list processes");
            const live = new Set<number>();
            for (const line of stdout.split("\n")) {
                const [pid, stat] = line.trim().split(/\s+/);
                if (pid && stat && !stat.startsWith("Z")) live.add(Number(pid));
            }
            return pids.filter((pid) => live.has(pid));
        },
    };
}

function createWindowsProcessOps(run: CommandRunner = runCommand): ProcessOps {
    return {
        async startTime(pid) {
            const { exitCode, stdout } = await run([
                "powershell",
                "-NoProfile",
                "-Command",
                `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`,
            ]);
            const started = Date.parse(stdout.trim());
            return exitCode === 0 && !Number.isNaN(started) ? Math.floor(started / 1000) : null;
        },
        // taskkill /T walks the tree itself.
        tree(pid) {
            return Promise.resolve([pid]);
        },
        async signal(pids, force) {
            for (const pid of pids) {
                await run(["taskkill", "/PID", String(pid), "/T", ...(force ? ["/F"] : [])]);
            }
            return "sent";
        },
        async running(pids) {
            const live: number[] = [];
            for (const pid of pids) {
                const { stdout } = await run([
                    "tasklist",
                    "/FI",
                    `PID eq ${pid}`,
                    "/NH",
                    "/FO",
                    "CSV",
                ]);
                if (stdout.includes(`"${pid}"`)) live.push(pid);
            }
            return live;
        },
    };
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

    async function waitForExit(pids: number[], graceMs: number): Promise<number[]> {
        const deadline = Date.now() + graceMs;
        for (;;) {
            const left = await ops.running(pids);
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
        // Whole seconds on both sides, plus a second of slack: the start time
        // read back from the OS can be up to a second late.
        if (started > Math.floor(Date.parse(registeredAt) / 1000) + 1) return { status: "reused" };

        // Never 0 or a negative pid (a process group: background jobs share the
        // agent's group, so a group kill could take the agent down), never the backend.
        const pids = (await ops.tree(pid)).filter((p) => p > 0 && p !== process.pid);
        if ((await ops.signal(pids, false)) === "denied") return failed(pid, "operation not permitted");
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
export type { CommandResult, CommandRunner, ProcessOps, StopOutcome, StopProcess };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/process-stopper.test.ts`
Expected: PASS. That's 23 tests on macOS/Linux; the 5 real-process tests are skipped on Windows.

If "kills a tree that ignores SIGTERM" fails with `status: "stopped"` but a PID still in `running`, check that the shell really ignored TERM (`ps -o pid,stat,command`). Don't loosen the assertion.

Run: `grep -nE "kill\(\s*-|-pgid|process\.kill\(-" packages/backend/src/services/process-stopper.ts`
Expected: no output (no negative-PID signals).

- [ ] **Step 5: Commit**

```bash
bunx prettier --write packages/backend/src/services/process-stopper.ts packages/backend/tests/services/process-stopper.test.ts
bunx eslint packages/backend/src/services/process-stopper.ts packages/backend/tests/services/process-stopper.test.ts
git add packages/backend/src/services/process-stopper.ts packages/backend/tests/services/process-stopper.test.ts
git commit -m "feat(backend): one-shot process stopper with PID-reuse guard"
```

### Task 3: `DevServerService`

**Files:**
- Create: `packages/backend/src/services/dev-server-service.ts`
- Test: `packages/backend/tests/services/dev-server-service.test.ts`

**Interfaces:**
- Consumes: `DevServerStore` and `DevServerInput` (Task 1); `createProcessStopper` and `StopProcess` (Task 2); `MSG.DEV_SERVER_LIST`, `DevServerListResponse`, `DevServerStopResult` and `WsEvent` (shared).
- Produces (for Section 2):
  - `createDevServerService(deps: { store: DevServerStore; broadcast: (event: WsEvent) => void; stopProcess?: StopProcess }): DevServerService`
  - `class DevServerInputError extends Error`. Section 2 maps it to HTTP 400.
  - `type DevServerService` (type export), with the methods listed in the plan index.
- Validation in `add`, in this order:
  1. `pid` is a positive integer, else `Field 'pid' must be a positive integer`.
  2. The trimmed `label` is non-empty, else `Field 'label' is required and must be a non-empty string`.
  3. The trimmed `label` is at most 80 characters, else `Field 'label' must be at most 80 characters`.
  The trimmed label is what gets stored. Section 2 passes `NaN` for a non-number `pid` and `""` for a non-string `label`, so both land in these messages.
- Broadcasts: `{ type: MSG.DEV_SERVER_LIST, payload: { devServers } }`, with the full list read back from the store. They go out after `add`, after a `remove` or `removeByPid` that returned `true`, and after a `stop` that removed the record. There's no broadcast for a miss or a failed stop.
- `stop(id)`:
  - unknown id → `{ ok: true }`, with no signal;
  - `stopped`, `gone` or `reused` → remove the record, broadcast, and return `{ ok: true }`;
  - `failed` → keep the record and return `{ ok: false, error }`;
  - an exception from the stopper (for example `ps` failing) propagates, and the WS handler in Section 2 turns it into a request error.

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/tests/services/dev-server-service.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import type { DevServerListResponse, WsEvent } from "@taskflow/shared";
import { DevServerStore } from "../../src/services/dev-server-store";
import {
    createDevServerService,
    DevServerInputError,
} from "../../src/services/dev-server-service";
import type { StopOutcome, StopProcess } from "../../src/services/process-stopper";
import { expectRejects } from "../expect-rejects";

describe("DevServerService", () => {
    let dir: string;
    let store: DevServerStore;
    let events: WsEvent[];
    let outcome: StopOutcome;
    let stopCalls: Array<{ pid: number; registeredAt: string }>;

    const stopProcess: StopProcess = (pid, registeredAt) => {
        stopCalls.push({ pid, registeredAt });
        return Promise.resolve(outcome);
    };

    function service() {
        return createDevServerService({
            store,
            broadcast: (event) => events.push(event),
            stopProcess,
        });
    }

    /** The pids in each broadcast list, in broadcast order. */
    function broadcastPids(): number[][] {
        return events.map((event) => {
            expect(event.type).toBe(MSG.DEV_SERVER_LIST);
            return (event.payload as DevServerListResponse).devServers.map((s) => s.pid);
        });
    }

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "dev-server-service-"));
        store = new DevServerStore(join(dir, "dev-servers.json"));
        events = [];
        outcome = { status: "stopped" };
        stopCalls = [];
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("rejects invalid input with the exact messages and stores nothing", async () => {
        const s = service();
        for (const pid of [0, -1, 1.5, Number.NaN]) {
            await expectRejects(
                s.add({ projectId: "p", pid, label: "Vite :5173" }),
                "Field 'pid' must be a positive integer",
            );
        }
        await expectRejects(
            s.add({ projectId: "p", pid: 5, label: "   " }),
            "Field 'label' is required and must be a non-empty string",
        );
        await expectRejects(
            s.add({ projectId: "p", pid: 5, label: "x".repeat(81) }),
            "Field 'label' must be at most 80 characters",
        );
        const error = await s.add({ projectId: "p", pid: 0, label: "x" }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(DevServerInputError);
        expect(await store.list()).toEqual([]);
        expect(events).toEqual([]);
    });

    it("stores a trimmed label, accepts 80 characters, and broadcasts after an add", async () => {
        const s = service();
        const added = await s.add({ projectId: "p", pid: 7, label: "  Vite :5173  " });
        expect(added.label).toBe("Vite :5173");
        await s.add({ projectId: "p", pid: 8, label: "y".repeat(80) });
        expect(broadcastPids()).toEqual([[7], [7, 8]]);
    });

    it("re-adding a pid keeps one record", async () => {
        const s = service();
        const first = await s.add({ projectId: "p", pid: 7, label: "a" });
        const second = await s.add({ projectId: "p", taskId: "t", pid: 7, label: "b" });
        expect(second.id).toBe(first.id);
        expect(await s.list()).toEqual([second]);
        expect(broadcastPids()).toEqual([[7], [7]]);
    });

    it("broadcasts concurrent adds in mutation order", async () => {
        const s = service();
        await Promise.all([
            s.add({ projectId: "p", pid: 1, label: "a" }),
            s.add({ projectId: "p", pid: 2, label: "b" }),
        ]);
        const pids = broadcastPids();
        expect(pids[pids.length - 1]).toEqual([1, 2]);
        expect(pids[0].length).toBeLessThanOrEqual(pids[1].length);
    });

    it("broadcasts after a remove that hit and not after one that missed", async () => {
        const s = service();
        const a = await s.add({ projectId: "p", pid: 7, label: "a" });
        await s.add({ projectId: "p", pid: 8, label: "b" });
        events = [];

        expect(await s.remove("missing")).toBe(false);
        expect(await s.removeByPid(999)).toBe(false);
        expect(events).toEqual([]);

        expect(await s.remove(a.id)).toBe(true);
        expect(await s.removeByPid(8)).toBe(true);
        expect(broadcastPids()).toEqual([[8], []]);
    });

    for (const status of ["stopped", "gone", "reused"] as const) {
        it(`stop removes the record and broadcasts when the process is ${status}`, async () => {
            const s = service();
            const a = await s.add({ projectId: "p", pid: 7, label: "a" });
            events = [];
            outcome = { status };

            expect(await s.stop(a.id)).toEqual({ ok: true });
            expect(stopCalls).toEqual([{ pid: 7, registeredAt: a.registeredAt }]);
            expect(await s.list()).toEqual([]);
            expect(broadcastPids()).toEqual([[]]);
        });
    }

    it("a failed stop keeps the record, returns the error and broadcasts nothing", async () => {
        const s = service();
        const a = await s.add({ projectId: "p", pid: 7, label: "a" });
        events = [];
        outcome = { status: "failed", error: "Could not stop pid 7: operation not permitted" };

        expect(await s.stop(a.id)).toEqual({
            ok: false,
            error: "Could not stop pid 7: operation not permitted",
        });
        expect(await s.list()).toEqual([a]);
        expect(events).toEqual([]);
    });

    it("stopping an unknown id is ok and signals nothing", async () => {
        expect(await service().stop("missing")).toEqual({ ok: true });
        expect(stopCalls).toEqual([]);
        expect(events).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/dev-server-service.test.ts`
Expected: FAIL with `Cannot find module '../../src/services/dev-server-service'`.

- [ ] **Step 3: Implement the service**

Create `packages/backend/src/services/dev-server-service.ts`:

```ts
import { MSG } from "@taskflow/shared";
import type {
    DevServer,
    DevServerListResponse,
    DevServerStopResult,
    WsEvent,
} from "@taskflow/shared";
import type { DevServerInput, DevServerStore } from "./dev-server-store";
import { createProcessStopper } from "./process-stopper";
import type { StopProcess } from "./process-stopper";

const MAX_LABEL_LENGTH = 80;

class DevServerInputError extends Error {}

interface DevServerService {
    list(): Promise<DevServer[]>;
    add(input: DevServerInput): Promise<DevServer>;
    remove(id: string): Promise<boolean>;
    removeByPid(pid: number): Promise<boolean>;
    stop(id: string): Promise<DevServerStopResult>;
}

interface DevServerServiceDeps {
    store: DevServerStore;
    broadcast: (event: WsEvent) => void;
    stopProcess?: StopProcess;
}

function validate(input: DevServerInput): DevServerInput {
    if (!Number.isInteger(input.pid) || input.pid <= 0) {
        throw new DevServerInputError("Field 'pid' must be a positive integer");
    }
    const label = input.label.trim();
    if (!label) {
        throw new DevServerInputError("Field 'label' is required and must be a non-empty string");
    }
    if (label.length > MAX_LABEL_LENGTH) {
        throw new DevServerInputError(`Field 'label' must be at most ${MAX_LABEL_LENGTH} characters`);
    }
    return { ...input, label };
}

function createDevServerService(deps: DevServerServiceDeps): DevServerService {
    const { store, broadcast } = deps;
    const stopProcess = deps.stopProcess ?? createProcessStopper();

    // The store queues this read behind every write already queued, so the
    // lists go out in mutation order and never step back.
    async function publish(): Promise<void> {
        const payload: DevServerListResponse = { devServers: await store.list() };
        broadcast({ type: MSG.DEV_SERVER_LIST, payload });
    }

    return {
        list: () => store.list(),

        async add(input) {
            const server = await store.add(validate(input));
            await publish();
            return server;
        },

        async remove(id) {
            const removed = await store.remove(id);
            if (removed) await publish();
            return removed;
        },

        async removeByPid(pid) {
            const removed = await store.removeByPid(pid);
            if (removed) await publish();
            return removed;
        },

        async stop(id) {
            const server = await store.get(id);
            if (!server) return { ok: true };
            const outcome = await stopProcess(server.pid, server.registeredAt);
            if (outcome.status === "failed") return { ok: false, error: outcome.error };
            if (await store.remove(id)) await publish();
            return { ok: true };
        },
    };
}

export { createDevServerService, DevServerInputError };
export type { DevServerService };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/dev-server-service.test.ts`
Expected: PASS (10 tests).

Run: `bun run typecheck` (repo root), then the full backend suite: `cd packages/backend && bun test`.
Expected: typecheck exit 0; the suite passes. `platform.test.ts` "resolveConfigBaseDir … isolated backend" is the known flaky test; rerun once if it fails.

- [ ] **Step 5: Commit**

```bash
bunx prettier --write packages/backend/src/services/dev-server-service.ts packages/backend/tests/services/dev-server-service.test.ts
bunx eslint packages/backend/src/services/dev-server-service.ts packages/backend/tests/services/dev-server-service.test.ts
git add packages/backend/src/services/dev-server-service.ts packages/backend/tests/services/dev-server-service.test.ts
git commit -m "feat(backend): dev server service with validation and list broadcasts"
```

- [ ] **Step 6: Record the spec amendment**

Append to the spec (`docs/superpowers/specs/2026-10-11-dev-servers-design.md`) an "Amendments" section, if one isn't there yet:

```markdown
## Amendments

- Section 1 (implementation): the start time is read with `ps -o etime=` instead of `ps -o lstart=`, because `lstart` is locale-dependent. The start is `floor(now) - etime`, so the reuse rule allows one second of slack: reused iff `startSec > floor(registeredAt / 1000) + 1`.
- Section 1 (implementation): `ps` runs with `LC_ALL=C`; a zombie counts as stopped; a `ps` failure while checking for survivors fails the stop instead of reporting success.
```

Commit it with the handoff update (`docs: TSK-4 section 1 handoff and spec amendment`).
