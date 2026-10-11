# Section 1: Shared types, store, process stopper, service

Read first: the plan index (`../2026-10-11-dev-servers.md`), especially "Cross-section interfaces" and "Global Constraints"; then `handoff.md`; then the spec sections "Record", "Storage" and "Stop service".

This section adds:

- the shared `DevServer` types and the two `MSG` entries;
- `DevServerStore`, a JSON file of records serialized through a `KeyedQueue`;
- `process-stopper.ts`, the one-shot stop: PID-reuse guard, tree collection, SIGTERM, then SIGKILL;
- `DevServerService`, which validates input, runs stops, and broadcasts the full list after every change.

Nothing is wired into the backend yet. Section 2 does that.

**Refinements of the spec (already recorded under "Amendments" in the spec, from plan review round 1):**
- The start time is read with `ps -o lstart=` under `LC_ALL=C TZ=UTC`, so it prints English names in UTC, and is parsed with `Date.UTC`. The reuse rule is the spec's, with no slack: **reused iff `startSec > floor(registeredAtMs / 1000)`**.
- The stopper signals the registered PID first and stops at the first refusal, so a PID it may not signal never gets its descendants signalled.
- Windows uses a process-table snapshot for the tree and survivor checks, and forces each PID with `taskkill /PID <pid> /F`.
- An OS command that fails throws. It never reads as "gone" or "stopped".
- The service removes a record only if it's still the registration it stopped (`removeIfUnchanged`).

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
    - `removeIfUnchanged(server: DevServer): Promise<boolean>`: removes the record only while it has the same `id` and `registeredAt`. A re-add of the same PID keeps the `id` but changes `registeredAt`, so a stop that started before the re-add leaves the new registration alone.
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

    it("removes a record only while it is the same registration", async () => {
        const first = await store.add({ pid: 1001, label: "a", projectId: "p" });
        await Bun.sleep(5);
        const second = await store.add({ pid: 1001, label: "a again", projectId: "p" });

        expect(await store.removeIfUnchanged(first)).toBe(false);
        expect(await store.list()).toEqual([second]);
        expect(await store.removeIfUnchanged(second)).toBe(true);
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

    /** Only while it is still that registration: a re-add of its pid keeps the id but not `registeredAt`. */
    removeIfUnchanged(target: DevServer): Promise<boolean> {
        return this.removeWhere(
            (server) => server.id === target.id && server.registeredAt === target.registeredAt,
        );
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
Expected: PASS (8 tests).

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
- Produces (type exports): `StopOutcome` and `StopProcess` (exactly as in the plan index), plus `ProcessOps`, `ProcessRow`, `CommandRunner`, `CommandResult` and `Kill`.

  ```ts
  interface CommandResult { exitCode: number; stdout: string }
  type CommandRunner = (command: string[]) => Promise<CommandResult>;
  type Kill = (pid: number, signal: "SIGTERM" | "SIGKILL" | 0) => void;
  interface ProcessRow { pid: number; ppid: number; startedMs?: number } // startedMs: Windows only
  interface ProcessOps {
      startTime(pid: number): Promise<number | null>; // whole epoch seconds; null = not running; throws when it can't tell
      processes(): Promise<ProcessRow[]>; // one snapshot of live processes, zombies left out; throws when it can't read
      signal(pids: number[], force: boolean): Promise<"sent" | "denied">; // in order, stops at the first refusal
  }
  ```
- Produces (value exports):
  - `createProcessStopper(options?: { ops?: ProcessOps; termGraceMs?: number; killGraceMs?: number; pollMs?: number }): StopProcess`. Defaults: platform ops, 3000 ms, 1000 ms, 100 ms.
  - `createPosixProcessOps(run?: CommandRunner, kill?: Kill): ProcessOps`
  - `createWindowsProcessOps(run?: CommandRunner): ProcessOps`
  Tests import the two ops factories. Section 1 Task 3 imports `createProcessStopper`.
- Stop algorithm:
  1. `startTime === null` → `gone`.
  2. `startTime > floor(registeredAt / 1000)` → `reused`, with no signal. Both sides are whole seconds, and there is no slack.
  3. Tree: the registered PID first, then its descendants, walked from one `processes()` snapshot. A child whose `startedMs` is earlier than its parent's is skipped, because Windows keeps a dead parent's PID as `ppid` and that PID may have been reused. Filter out PIDs `<= 0` and `process.pid`.
  4. SIGTERM the tree, registered PID first. `signal` stops at the first refusal, so **a refused registered PID means nothing below it is signalled**. If `denied`, return `failed` with `operation not permitted`.
  5. Wait for exit up to `termGraceMs`, checking every PID in the tree (not only the registered one) against fresh snapshots.
  6. SIGKILL the survivors, in tree order. If `denied`, return `failed` with `operation not permitted`.
  7. Wait up to `killGraceMs`. If any PID is left, return `failed` with `process is still running`. Otherwise return `stopped`.
  8. An exception from an op (a missing `ps`, an unreadable process table, an unreadable start time) propagates. It never reads as "gone" or "stopped".
- Commands run with `LC_ALL=C` and `TZ=UTC`. A command that can't be spawned throws.
- POSIX ops:
  - `startTime`: `ps -o lstart= -p <pid>`, which prints `Sun Oct 11 17:58:30 2026` (English names, UTC). It's parsed with `Date.UTC`. If `ps` fails or prints something unparsable, `kill(pid, 0)` decides: ESRCH → `null`; otherwise throw `Could not read the start time of pid <pid>`.
  - `processes`: one `ps -A -o pid=,ppid=,stat=` snapshot. A `stat` starting with `Z` (zombie) is left out. A non-zero exit or an empty table throws.
  - `signal`: `kill` per PID, in order. ESRCH is skipped. EPERM returns `denied` at once. Anything else throws.
- Windows ops:
  - `startTime`: PowerShell prints `missing` or `([DateTimeOffset]$p.StartTime).ToUnixTimeSeconds()`. Anything else throws.
  - `processes`: PowerShell `Get-CimInstance Win32_Process`, one `pid ppid startedMs` line per process. A non-zero exit or an empty table throws.
  - `signal`: `taskkill /PID <pid> /F` per PID, in order, without `/T` (the stopper already has the tree). Both phases force, because a taskkill without `/F` only asks windowed apps to close, and a console dev server ignores it. A non-zero exit for a PID that's still in a fresh snapshot returns `denied` at once.
  - These are unit-tested through a fake `CommandRunner` only. Real Windows behaviour is a Section 5 item.
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
        startTime: () => Promise.resolve(options.start === undefined ? nowSec() - 60 : options.start),
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
        expect(await createPosixProcessOps(run, skipping.kill).signal([42, 43], false)).toBe("sent");
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
            if (command[0] === "taskkill") return { exitCode: command[2] === "42" ? 128 : 1, stdout: "" };
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
    const [stdout, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
    ]);
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
    const match = /^[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/.exec(
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
export type {
    CommandResult,
    CommandRunner,
    Kill,
    ProcessOps,
    ProcessRow,
    StopOutcome,
    StopProcess,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/process-stopper.test.ts`
Expected: PASS. On Windows the 6 real-process tests are skipped.

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
  - `stopped`, `gone` or `reused` → remove the record with `store.removeIfUnchanged(server)`, broadcast if it was removed, and return `{ ok: true }`. A re-registration of the same PID that landed while the stop ran stays;
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

    it("a stop leaves a re-registration of the same pid that landed while it ran", async () => {
        const pending: { finish?: (outcome: StopOutcome) => void } = {};
        const s = createDevServerService({
            store,
            broadcast: (event) => events.push(event),
            stopProcess: () =>
                new Promise<StopOutcome>((resolve) => {
                    pending.finish = resolve;
                }),
        });
        const old = await s.add({ projectId: "p", pid: 7, label: "old" });
        await Bun.sleep(5);

        const stopping = s.stop(old.id);
        while (!pending.finish) await Bun.sleep(1);
        const again = await s.add({ projectId: "p", pid: 7, label: "new" });
        events = [];
        pending.finish?.({ status: "reused" });

        expect(await stopping).toEqual({ ok: true });
        expect(again.id).toBe(old.id);
        expect(await s.list()).toEqual([again]);
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
            // Not remove(id): a re-add of the pid while the stop ran keeps the id.
            if (await store.removeIfUnchanged(server)) await publish();
            return { ok: true };
        },
    };
}

export { createDevServerService, DevServerInputError };
export type { DevServerService };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/dev-server-service.test.ts`
Expected: PASS (11 tests).

Run: `bun run typecheck` (repo root), then the full backend suite: `cd packages/backend && bun test`.
Expected: typecheck exit 0; the suite passes. `platform.test.ts` "resolveConfigBaseDir … isolated backend" is the known flaky test; rerun once if it fails.

- [ ] **Step 5: Commit**

```bash
bunx prettier --write packages/backend/src/services/dev-server-service.ts packages/backend/tests/services/dev-server-service.test.ts
bunx eslint packages/backend/src/services/dev-server-service.ts packages/backend/tests/services/dev-server-service.test.ts
git add packages/backend/src/services/dev-server-service.ts packages/backend/tests/services/dev-server-service.test.ts
git commit -m "feat(backend): dev server service with validation and list broadcasts"
```

- [ ] **Step 6: Record the implementation in the handoff**

The spec's "Amendments" section already records this section's refinements (plan review round 1). Add anything you changed beyond them to the spec's "Amendments" and to "Deviations from the spec" in `handoff.md`. Commit it with the handoff update (`docs: TSK-4 section 1 handoff`).
