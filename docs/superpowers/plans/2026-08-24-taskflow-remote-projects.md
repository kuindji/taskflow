# Taskflow Remote Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the desktop client hold several Taskflow backends attached at once, so projects from other machines appear in one sidebar alongside local ones and each workspace runs on the machine that owns it.

**Architecture:** Electron main keeps an *attached set* of backends, each with its own ssh tunnel and origin. The renderer holds one `Connection` per backend in a registry; every request carries a `backendId` and every event delivers one. Stores that anything reads outside the active workspace hold per-backend slices and merge for display; stores that serve only the open pane stay single-backend and take their target from the active workspace. A "hard switch" is the same attach/detach primitive applied to the whole set, leaving one backend as primary.

**Tech Stack:** Bun, TypeScript, React 19, zustand, Electron, `node:dgram`, OpenSSH, Monaco, xterm. Tests are `bun test` (`bun:test` API).

**Spec:** `docs/superpowers/specs/2026-08-24-taskflow-remote-projects-design.md`

**Superseded plan:** `docs/superpowers/plans/2026-08-23-taskflow-multi-backend.md`. Tasks 2, 3, 5 and 6 of that document are carried forward here by reference — see "Carried-forward tasks" below. Do not execute that plan's Tasks 7 through 14; they implement a topology this plan replaces.

## Global Constraints

- Use `bun`, never `npm` or `yarn`.
- No `as any`. Reach for a real type or a type guard.
- Do not add co-authored-by trailers to commits.
- Do not export a symbol until something outside its module uses it.
- Do not disable eslint rules; fix the cause.
- Reuse existing types from `@taskflow/shared` before adding new ones.
- Prettier: 4-space indent, 100-column print width. Run `bun run format` before committing if unsure.
- Multicast group `239.255.42.98`, port `47654`, TTL `1`.
- Announce interval `5000` ms. A discovered entry is stale after `15000` ms.
- `PROTOCOL_VERSION` starts at `1`. Equal attaches; anything else refuses that one backend.
- Backend binds `127.0.0.1` from Task 1 onward. Nothing in this plan may reintroduce a routable bind.
- Reconnect backoff per backend: exponential, ceiling `60000` ms.
- A backend is identified by its `backendUid`, never by the host string the user typed.

**Decisions settled during design — do not re-litigate.**

- **App-level managers address primary only.** Settings, Appearance, the global Flow/Action manager and the global Schedule view show and edit primary's data. Changing another machine's means hard-switching to it. There is no machine picker in any app-level manager.
- **Availability follows the record.** A project's run menu, flows, actions and schedules are its own machine's and execute there. `FLOW_START` resolves a flow id against the backend it is sent to, so this is not a preference.
- **Anything opened from a project or task row routes to that record's machine**, including creating a project-scoped flow, action or schedule.
- **Settings are mirrored read-only per machine.** Launch payloads read the target machine's defaults. Only primary's slice is writable and `SETTINGS_UPDATE` is only ever sent to primary.
- **Remote setup stays out of scope.** Add Project, location repair, theme import and native file-drop remain disabled for remote targets.
- **No local cache of remote records.** An unreachable machine shows a section header with a retry and no projects.

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `packages/shared/src/types/backend.ts` | `BeaconAnnounce`, `BeaconProbe`, `DiscoveredBackend`, `BackendRecord`, `TunnelFailure` (Task 3) |
| `packages/shared/src/discovery/*` | Beacon codec and dgram sockets (Tasks 3, 4) |
| `electron/src/backend-records.ts` | Pure record-list operations, uid keying, provisional records |
| `electron/src/backend-registry.ts` | The attached set, per-backend state, persistence, discovery listener |
| `electron/src/tunnel-args.ts` | Pure `buildTunnelArgs`, `classifyTunnelFailure` (Task 6) |
| `electron/src/tunnel-manager.ts` | A map of ssh children; readiness; known_hosts (Task 7) |
| `packages/ui/src/lib/connection.ts` | One `Connection`: socket, epoch, pending requests, reconnect |
| `packages/ui/src/lib/connection-registry.ts` | `Map<backendId, Connection>`; `sendRequest`, `onEvent`, status |
| `packages/ui/src/lib/backend-scope.ts` | `Scoped<T>`, slice helpers, revision guard |
| `packages/ui/src/stores/backend-store.ts` | Renderer mirror of the registry; attach, detach, hard switch |
| `packages/ui/src/stores/store-reset.ts` | Per-backend reset callbacks |
| `packages/ui/src/hooks/useWorkspaceBackend.ts` | The active workspace's `backendId` |
| `packages/ui/src/hooks/useIsLocalBackend.ts` | Gating predicate, per backend |
| `packages/ui/src/components/sidebar/MachineSection.tsx` | Collapsible per-machine section |
| `packages/ui/src/components/sidebar/MachinesMenu.tsx` | Attach checkboxes, "Work as…", connect, manage |
| `packages/ui/src/components/sidebar/ConnectBackendDialog.tsx` | Manual host entry |
| `packages/ui/src/components/sidebar/ManageBackendsDialog.tsx` | Rename / edit / remove |
| `packages/ui/src/components/sidebar/TrustHostKeyDialog.tsx` | Fingerprint approval |

**Modified files**

| Path | Change |
|---|---|
| `packages/backend/src/ws/server.ts` | Bind `127.0.0.1` |
| `packages/backend/src/config.ts` | `instancePortFile`, safe `instanceId`, `backendUid` |
| `packages/backend/src/index.ts` | Port file, `SYSTEM_INFO` fields, advertiser |
| `packages/backend/src/services/file-watcher.ts` | Per-client watcher ownership |
| `packages/backend/src/handlers/file.ts` | Pass the client id to watch/unwatch |
| `packages/backend/src/ws/router.ts` | Expose a stable per-connection client id |
| `packages/shared/src/constants.ts` | `PROTOCOL_VERSION`, discovery constants |
| `packages/shared/src/types/system.ts` | `hostname`, `protocolVersion`, `backendUid` |
| `packages/ui/src/hooks/useWebSocket.ts` | Becomes a thin re-export over the registry |
| `packages/ui/src/lib/backend-url.ts` | Origin per backend |
| `packages/ui/src/stores/*` | Per-backend slices; routed mutations |
| `packages/ui/src/components/panes/editor-dirty-state.ts` | Keyed by backend-scoped URI |
| `packages/ui/src/components/panes/EditorPaneImpl.tsx` | Backend-scoped Monaco URI |
| `packages/ui/src/components/sidebar/TaskSidebar.tsx` | Machine sections; machines menu |
| `electron/src/main.ts` | Wire registry and tunnels |
| `electron/src/ipc-handlers.ts` | Backend IPC channels; `saveArtifact` rework |
| `electron/src/notification-poller.ts` | Per-backend watermarks and origins |
| `electron/src/tray-manager.ts` | Aggregate across attached backends |

---

## Reusing the superseded plan

Four tasks of `docs/superpowers/plans/2026-08-23-taskflow-multi-backend.md` are
unchanged in substance and are executed from that document rather than copied
here: its Tasks 2, 3, 5 and 6 become Tasks 3, 4, 6 and 7 below. Each appears in
sequence with the deltas that apply. They are long and already verified;
duplicating them would create two versions to keep in step.

Do **not** execute that plan's Tasks 7 through 14. They implement the
one-active-backend topology this plan replaces.

---

### Task 1: Backend prerequisites — protocol version, stable port file, backend uid

Adds the three values discovery, the handshake and backend identity depend on.

**Already done, do not redo:** the loopback bind this plan's constraints require
has landed. `packages/backend/src/ws/server.ts:61` passes
`hostname: resolveBackendHost()`, and `packages/shared/src/utils/backend-host.ts`
pins `127.0.0.1`, refuses any `TASKFLOW_HOST` that is not loopback, and is
covered by `packages/shared/src/utils/backend-host.test.ts`. That is stricter
than the superseded plan specified. Verify it still holds with
`bun test packages/shared/src/utils/backend-host.test.ts` before starting, and
do not add a second bind test.

**Files:**
- Modify: `packages/backend/src/config.ts:69-79`
- Modify: `packages/backend/src/index.ts:416`, `:470`, and the `shutdown` handler at `:499`
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/types/system.ts:15-18`
- Test: `packages/backend/tests/config/backend-uid.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PROTOCOL_VERSION: number` from `@taskflow/shared`; `config.instancePortFile: string`; `config.backendUid: string`; `SystemInfo.hostname: string`, `SystemInfo.protocolVersion?: number`, `SystemInfo.backendUid?: string`.

- [ ] **Step 1: Confirm the bind precondition**

Run: `bun test packages/shared/src/utils/backend-host.test.ts`
Expected: PASS. If it does not, stop — every later task assumes the backend is
unreachable from the LAN, and advertising a port that is not is strictly worse
than doing nothing.

- [ ] **Step 2: Add the protocol version constant**

At the top of `packages/shared/src/constants.ts`, above `export const MSG = {`:

```ts
/**
 * Bumped only when a protocol change is NOT backward compatible. A client
 * refuses to attach to a backend reporting a different value, so a bump breaks
 * cross-machine attachment until both sides update. Do not bump for additive
 * changes.
 */
export const PROTOCOL_VERSION = 1;
```

- [ ] **Step 3: Constrain the instance id at its source**

`instanceId` becomes three things at once: a filename, a value announced on the
network, and part of a command run over ssh. Task 3's codec refuses a label
outside `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, and today's derivation can produce
one that fails it — `TASKFLOW_DEV_BRANCH` is taken verbatim (`config.ts:45-47`)
and the git fallback only replaces `/` (`config.ts:55-56`). A backend whose id
the codec rejects is silently undiscoverable: it announces, every listener drops
the datagram, and nothing logs anything.

In `packages/backend/src/config.ts`, above `const instanceId`:

```ts
/**
 * The instance id names a file, is announced on the LAN, and is interpolated
 * into a remote command, so it is reduced to one safe label at the point it is
 * derived. Must stay in step with `isSafeLabel` in the beacon codec.
 */
function toSafeLabel(value: string): string {
    const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+/, "");
    return cleaned.slice(0, 64) || "unknown";
}
```

```ts
const instanceId = devBranch ? toSafeLabel(`dev-${devBranch}`) : "main";
```

`main` is unchanged, so no production instance moves. A *dev* instance whose
branch name contained something outside the set gets a new `instanceId`, which
moves exactly two paths: `masterSessionsFile` and `sessionLogsDir`
(`buildDataPaths`, `config.ts:25-40`). `dataDir`, `projectsFile`, `tasksDir` and
`flowsDir` are not instance-scoped and stay put. Session rows already written
under the old id remain in the shared task files but are invisible to
`filterSessions` (`services/instance-filter.ts:4`) — stranded, not deleted, and
dev-only.

- [ ] **Step 4: Write the failing uid test**

Create `packages/backend/tests/config/backend-uid.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readOrCreateBackendUid } from "../../src/config";

describe("readOrCreateBackendUid", () => {
    test("mints a uid once and returns the same one afterwards", async () => {
        const dir = await mkdtemp(join(tmpdir(), "uid-"));
        try {
            const first = readOrCreateBackendUid(dir);
            const second = readOrCreateBackendUid(dir);
            expect(first).toBe(second);
            expect(first).toMatch(/^[0-9a-f]{32}$/);
            expect((await readFile(join(dir, "backend-uid"), "utf-8")).trim()).toBe(first);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("two data directories get different uids", async () => {
        const a = await mkdtemp(join(tmpdir(), "uid-a-"));
        const b = await mkdtemp(join(tmpdir(), "uid-b-"));
        try {
            expect(readOrCreateBackendUid(a)).not.toBe(readOrCreateBackendUid(b));
        } finally {
            await rm(a, { recursive: true, force: true });
            await rm(b, { recursive: true, force: true });
        }
    });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `bun test packages/backend/tests/config/backend-uid.test.ts`
Expected: FAIL — `readOrCreateBackendUid` is not exported from `config`.

- [ ] **Step 6: Mint the backend uid**

In `packages/backend/src/config.ts`, add near the top imports:

```ts
import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
```

Then, above the `config` object:

```ts
/**
 * A backend's stable identity, minted once per data directory. Host names and
 * IP addresses are how you *reach* a backend; this is what one *is*, so the
 * client cannot attach the same backend twice under two aliases.
 *
 * Synchronous on purpose: `config` is built at module load and everything
 * downstream expects a plain string, not a promise.
 */
export function readOrCreateBackendUid(baseDir: string): string {
    const file = join(baseDir, "backend-uid");
    if (existsSync(file)) {
        const existing = readFileSync(file, "utf-8").trim();
        if (/^[0-9a-f]{32}$/.test(existing)) return existing;
    }
    mkdirSync(baseDir, { recursive: true });
    const minted = randomBytes(16).toString("hex");
    writeFileSync(file, minted, { mode: 0o600 });
    return minted;
}
```

- [ ] **Step 7: Add the uid and the stable port file to config**

In the `config` object, next to `portFile`:

```ts
    portFile: process.env.TASKFLOW_PORT_FILE ?? join(tmpdir(), `.taskflow-port-${process.pid}`),
    /** Stable, spawner-independent port file. Read over ssh when multicast is unavailable. */
    instancePortFile: join(BASE_DIR, `${instanceId}.port`),
    /** Stable backend identity. See readOrCreateBackendUid. */
    backendUid: readOrCreateBackendUid(BASE_DIR),
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test packages/backend/tests/config/backend-uid.test.ts`
Expected: PASS

- [ ] **Step 9: Report identity and version from SYSTEM_INFO**

In `packages/shared/src/types/system.ts`, extend the interface:

```ts
export interface SystemInfo {
    editors: EditorInfo[];
    homedir: string;
    /** The backend machine's hostname. What the network name setting falls back
     *  to, and the only way the renderer can name the machine it is talking to. */
    hostname: string;
    /** Absent on a backend older than this feature. Treat as incompatible. */
    protocolVersion?: number;
    /** Stable backend identity, confirmed by handshake. The registry rekeys a
     *  provisional record onto this and merges duplicates. Absent on an older
     *  backend, which is refused on protocolVersion first. */
    backendUid?: string;
}
```

In `packages/backend/src/index.ts`, change the `SYSTEM_INFO` registration at line 416:

```ts
        router.register(MSG.SYSTEM_INFO, async () => ({
            editors,
            homedir: homedir(),
            hostname: hostname(),
            protocolVersion: PROTOCOL_VERSION,
            backendUid: config.backendUid,
        }));
```

Add `PROTOCOL_VERSION` to the existing `@taskflow/shared` import in that file, and `hostname` to the existing `os` import.

- [ ] **Step 10: Write and remove the stable port file**

In `packages/backend/src/index.ts`, immediately after the existing `writeFile(config.portFile, ...)` at line 470:

```ts
        await writeFile(config.instancePortFile, String(startedServer.port));
```

In the `shutdown` handler (line 499), before the process exits:

```ts
            await rm(config.instancePortFile, { force: true });
```

Import `rm` from `fs/promises` alongside the existing `writeFile` import.

- [ ] **Step 11: Verify the whole suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 12: Commit**

```bash
git add packages/backend/src/config.ts packages/backend/src/index.ts packages/shared/src/constants.ts packages/shared/src/types/system.ts packages/backend/tests/config/backend-uid.test.ts
git commit -m "feat(backend): report a protocol version and a stable backend uid

The backend now has an identity of its own, minted once per data directory,
so a client cannot attach the same backend twice under two host aliases.

The instance id is reduced to [A-Za-z0-9._-] and capped at 64 characters so it
is safe as a filename, as a beacon field and inside a command run over ssh.
Only dev instances are affected; 'main' is unchanged. A dev instance whose
branch name contained anything outside that set gets a new sessions directory
and session-log directory. Its projects, tasks and flows do not move. Session
rows already recorded under the old id stay in the shared task files where the
instance filter can no longer see them."
```

---
### Task 2: Per-client file watcher ownership

Watchers are owned per path today: `watch()` stops any existing watcher for a path before creating its own (`file-watcher.ts:122-123`) and `FILE_UNWATCH` stops it globally (`handlers/file.ts:72-76`). One client per backend made that safe. Attaching a second client makes it a bug, and this plan *causes* it, because detach sends `FILE_UNWATCH`:

1. The desktop app watches `/repo` for its open task.
2. The laptop, viewing the same project remotely, watches `/repo`; the backend stops the desktop's watcher and installs the laptop's.
3. The laptop detaches and sends `FILE_UNWATCH`.
4. The backend closes the only watcher. The desktop app is still open, still connected, and silently stops receiving file changes.

Watches become refcounted by path, and a dropped connection releases its own references. Nothing in this task is client-visible; it is a prerequisite for Task 10's detach.

**Files:**
- Modify: `packages/backend/src/ws/router.ts`
- Modify: `packages/backend/src/ws/server.ts:63`, `:70-80`, `:93`
- Modify: `packages/backend/src/services/file-watcher.ts:34`, `:122-160`
- Modify: `packages/backend/src/handlers/file.ts:62-77`
- Test: `packages/backend/tests/services/file-watcher-ownership.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ClientContext = { clientId: string }` exported from `packages/backend/src/ws/router.ts`; `Handler = (payload: unknown, ctx: ClientContext) => Promise<unknown>`; `createServer(...).onDisconnect(cb: (clientId: string) => void): void`; on `FileWatcher` — `watch(dirPath: string, clientId: string, onChange: (event: FileChangeEvent) => void): Promise<void>`, `release(dirPath: string, clientId: string): Promise<void>`, `releaseClient(clientId: string): Promise<void>`. `stop(dirPath)` becomes private; `stopAll()` is unchanged.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/services/file-watcher-ownership.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { FileWatcher } from "../../src/services/file-watcher";

const dirs: string[] = [];
let watcher: FileWatcher | null = null;

afterEach(async () => {
    await watcher?.stopAll();
    watcher = null;
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "watch-"));
    dirs.push(dir);
    return dir;
}

/** Chokidar is not synchronous; give it a beat to notice. */
function settle(ms = 400): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("FileWatcher ownership", () => {
    test("a second client releasing does not stop the first client's watch", async () => {
        const dir = await tempDir();
        watcher = new FileWatcher();

        const events: string[] = [];
        await watcher.watch(dir, "client-a", (event) => events.push(event.path));
        await watcher.watch(dir, "client-b", (event) => events.push(event.path));

        await watcher.release(dir, "client-b");
        await settle();

        await writeFile(join(dir, "a.txt"), "hello");
        await settle();

        expect(events.length).toBeGreaterThan(0);
    });

    test("the last release stops the watch", async () => {
        const dir = await tempDir();
        watcher = new FileWatcher();

        const events: string[] = [];
        await watcher.watch(dir, "client-a", (event) => events.push(event.path));
        await watcher.release(dir, "client-a");
        await settle();

        await writeFile(join(dir, "a.txt"), "hello");
        await settle();

        expect(events).toHaveLength(0);
    });

    test("releaseClient drops every path that client owned", async () => {
        const one = await tempDir();
        const two = await tempDir();
        watcher = new FileWatcher();

        const events: string[] = [];
        await watcher.watch(one, "client-a", (event) => events.push(event.path));
        await watcher.watch(two, "client-a", (event) => events.push(event.path));
        await watcher.releaseClient("client-a");
        await settle();

        await writeFile(join(one, "a.txt"), "hello");
        await writeFile(join(two, "b.txt"), "hello");
        await settle();

        expect(events).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/backend/tests/services/file-watcher-ownership.test.ts`
Expected: FAIL — `watch` takes two arguments, and `release` / `releaseClient` do not exist.

- [ ] **Step 3: Refcount the watchers**

In `packages/backend/src/services/file-watcher.ts`, change the watcher map to
carry its owners. Replace the declaration at line 34:

```ts
    private watchers = new Map<string, ActiveWatcher>();
```

with:

```ts
    private watchers = new Map<string, ActiveWatcher & { owners: Set<string> }>();
```

Replace `watch` (line 122) with:

```ts
    /**
     * Watch `dirPath` on behalf of `clientId`. Several clients may watch one
     * path: the chokidar watcher is shared and reference counted, because two
     * clients on one backend is now normal and one of them releasing must not
     * blind the other.
     */
    async watch(
        dirPath: string,
        clientId: string,
        onChange: (event: FileChangeEvent) => void,
    ): Promise<void> {
        const existing = this.watchers.get(dirPath);
        if (existing) {
            existing.owners.add(clientId);
            return;
        }

        const watcher = chokidar.watch(dirPath, {
            ignored: (path) => this.shouldIgnorePath(path),
            ignoreInitial: true,
            ignorePermissionErrors: true,
```

Leave the rest of the chokidar setup exactly as it is. Where the method
currently stores the watcher, store the owner set with it:

```ts
        this.watchers.set(dirPath, { watcher, onChange, owners: new Set([clientId]) });
```

Match the existing `ActiveWatcher` fields — do not invent new ones beyond
`owners`.

- [ ] **Step 4: Add release and releaseClient**

Below `watch`, and above the existing `stop`:

```ts
    /** Drop one client's interest in a path. Stops chokidar only when the last goes. */
    async release(dirPath: string, clientId: string): Promise<void> {
        const entry = this.watchers.get(dirPath);
        if (!entry) return;
        entry.owners.delete(clientId);
        if (entry.owners.size === 0) await this.stop(dirPath);
    }

    /** Drop every path a client owned. Called when its connection closes. */
    async releaseClient(clientId: string): Promise<void> {
        const paths = [...this.watchers.entries()]
            .filter(([, entry]) => entry.owners.has(clientId))
            .map(([path]) => path);
        for (const path of paths) await this.release(path, clientId);
    }
```

Change `stop` (line 146) from `async stop(` to `private async stop(`. `stopAll`
already iterates the map and is unchanged; it is the shutdown path and does not
care about owners.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/backend/tests/services/file-watcher-ownership.test.ts`
Expected: PASS

- [ ] **Step 6: Give the router a client context**

In `packages/backend/src/ws/router.ts`, replace the handler type and `handle`:

```ts
/** Identifies one WebSocket connection, so per-client resources can be released when it closes. */
export interface ClientContext {
    clientId: string;
}

type Handler = (payload: unknown, ctx: ClientContext) => Promise<unknown>;

export class Router {
    private handlers = new Map<string, Handler>();

    register(type: string, handler: Handler): void {
        this.handlers.set(type, handler);
    }

    async handle(type: string, payload: unknown, ctx: ClientContext): Promise<unknown> {
        const handler = this.handlers.get(type);
        if (!handler) {
            throw new Error(`No handler for message type: ${type}`);
        }
        return handler(payload, ctx);
    }

    has(type: string): boolean {
        return this.handlers.has(type);
    }
}
```

Every existing handler is registered with a one-parameter function, which
remains assignable to the two-parameter `Handler`, so no other registration site
changes.

- [ ] **Step 7: Mint a client id per connection**

In `packages/backend/src/ws/server.ts`, import `randomUUID`:

```ts
import { randomUUID } from "crypto";
```

Change the socket data type at the top of `createServer`:

```ts
    interface SocketData {
        clientId: string;
    }
    let server: Server<unknown>;
    const clients = new Set<ServerWebSocket<SocketData>>();
    let connectCallback: (() => void) | null = null;
    let disconnectCallback: ((clientId: string) => void) | null = null;
```

Add alongside `onConnect`:

```ts
    /** Fired when a connection closes, so per-client resources can be released. */
    function onDisconnect(callback: (clientId: string) => void): void {
        disconnectCallback = callback;
    }
```

In `fetch`, give the upgrade its identity:

```ts
                if (server.upgrade(req, { data: { clientId: randomUUID() } })) return;
```

In `close`, fire the callback before the count is broadcast:

```ts
                close(ws) {
                    clients.delete(ws);
                    disconnectCallback?.(ws.data.clientId);
                    broadcastClientCount();
                },
```

In `message`, pass the context through:

```ts
                        const result = await router.handle(request.type, request.payload, {
                            clientId: ws.data.clientId,
                        });
```

Add `onDisconnect` to the returned object and to `createServer`'s declared
return type, next to `onConnect`.

- [ ] **Step 8: Route watch and unwatch through the client id**

In `packages/backend/src/handlers/file.ts`, change the two registrations:

```ts
    router.register(MSG.FILE_WATCH, async (payload, ctx) => {
        const { path } = payload as FileWatchPayload;
        const workspacePath = await assertWorkspacePath(taskStore, path);
        await fileWatcher.watch(workspacePath, ctx.clientId, (event) => {
            broadcast({ type: MSG.FILE_CHANGED, payload: event });
            changeTracker?.onFileChanged(event.path);
        });
        return { success: true };
    });

    router.register(MSG.FILE_UNWATCH, async (payload, ctx) => {
        const { path } = payload as FileUnwatchPayload;
        const workspacePath = await assertWorkspacePath(taskStore, path);
        await fileWatcher.release(workspacePath, ctx.clientId);
        return { success: true };
    });
```

- [ ] **Step 9: Release a client's watches when it disconnects**

In `packages/backend/src/index.ts`, where the server is created and `onConnect`
is already wired, add:

```ts
        startedServer.onDisconnect((clientId) => {
            void fileWatcher.releaseClient(clientId);
        });
```

Place it beside the existing `onConnect` registration. A client that vanishes
without sending `FILE_UNWATCH` — a crash, a killed tunnel — must not leave a
recursive chokidar watcher running for the life of the backend.

- [ ] **Step 10: Verify the whole suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS, no type errors. `packages/backend/tests/ws/router.test.ts` calls
`handle` and will need its call sites given a context argument; update them to
pass `{ clientId: "test" }`.

- [ ] **Step 11: Commit**

```bash
git add packages/backend/src/ws/router.ts packages/backend/src/ws/server.ts packages/backend/src/services/file-watcher.ts packages/backend/src/handlers/file.ts packages/backend/src/index.ts packages/backend/tests/services/file-watcher-ownership.test.ts packages/backend/tests/ws/router.test.ts
git commit -m "feat(backend): own file watches per client

Watchers were keyed by path alone, so a second client watching a path replaced
the first client's watcher and either client unwatching closed it for both. One
client per backend made that invisible. Attaching a remote client makes two
clients per backend normal.

Watches are now reference counted by path and released per client, including
when a connection closes without unwatching."
```

---
### Task 3: Shared discovery types and the pure beacon codec

Execute **Task 2** of `docs/superpowers/plans/2026-08-23-taskflow-multi-backend.md` in full, with two deltas.

**Delta A — the announce payload carries `backendUid`.**

In `packages/shared/src/types/backend.ts`, `BeaconAnnounce` gains:

```ts
    /** The advertising backend's stable identity. A hint only: anyone on the LAN
     *  can advertise one, so it is never trusted until a handshake confirms it. */
    backendUid: string;
```

`encodeAnnounce` includes it; `parseDatagram` requires it and returns `null`
when it is absent or fails `isSafeLabel`. Add a codec test asserting that a
datagram without `backendUid` parses to `null`, alongside the existing truncated
and future-`v` cases.

**Delta B — `backendIdFor` is no longer identity.**

That task produces `backendIdFor(hostname, instanceId)`. Keep it, but its doc
comment changes: it now builds a **provisional** key used only until a handshake
reports a `backendUid`. Add above it:

```ts
/**
 * Provisional key for a backend whose uid is not known yet — a manual connect,
 * a port-file fallback, or a record persisted before uids existed. Records under
 * this key are rekeyed to their backendUid on first successful handshake.
 * Never use it to decide whether two records are the same backend.
 */
```

---
### Task 4: The advertiser and listener, and the backend that runs one

Execute **Task 3** of the superseded plan in full, with one delta.

**Delta — the advertiser reports the uid.** Where that task builds the announce
payload in `packages/backend/src/index.ts`, include `backendUid: config.backendUid`
(created in Task 1 of this plan). No other change: the listener already passes
whole parsed announces through.

---
### Task 5: The backend record list, keyed by uid

Pure list operations, separated from persistence so they can be tested without Electron. This replaces **Task 4** of the superseded plan rather than carrying it: that version keys records by `${host}:${instanceId}`, which lets one backend attach twice under two aliases and deliver every record twice.

**Files:**
- Create: `electron/src/backend-records.ts`
- Create: `electron/src/backend-records.test.ts`
- Modify: `electron/package.json`

**Interfaces:**
- Consumes: `BackendRecord`, `DiscoveredBackend` from `@taskflow/shared`; `backendIdFor`, `isStale` from `@taskflow/shared/discovery`.
- Produces: `upsertRecord`, `removeRecord`, `recordFromDiscovered`, `matchesDiscovered`, `mergeForMenu`, `normalizeRecords`, `adoptUid`, and the `MenuEntry` type.

- [ ] **Step 1: Depend on the shared package**

In `electron/package.json`, add to `dependencies` (create the block if absent, above `devDependencies`):

```json
    "dependencies": {
        "@taskflow/shared": "workspace:*"
    },
```

Run: `bun install`

- [ ] **Step 2: Write the failing test**

Create `electron/src/backend-records.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { BackendRecord } from "@taskflow/shared";
import { adoptUid, normalizeRecords, upsertRecord } from "./backend-records";

function record(patch: Partial<BackendRecord> = {}): BackendRecord {
    return {
        id: "desktop.local:main",
        backendUid: null,
        host: "desktop.local",
        instanceId: "main",
        displayName: "desktop",
        user: "kuindji",
        sshPort: 22,
        lastKnownPort: null,
        attached: false,
        addedAt: "2026-08-24T00:00:00.000Z",
        ...patch,
    };
}

describe("adoptUid", () => {
    test("rekeys a provisional record onto its uid", () => {
        const records = [record()];
        const next = adoptUid(records, "desktop.local:main", "abc123");

        expect(next).toHaveLength(1);
        expect(next[0].id).toBe("abc123");
        expect(next[0].backendUid).toBe("abc123");
        expect(next[0].host).toBe("desktop.local");
    });

    test("merges an alias into the record that already holds the uid", () => {
        const byName = record({ id: "abc123", backendUid: "abc123", attached: true });
        const byIp = record({ id: "192.168.1.20:main", host: "192.168.1.20", sshPort: 2222 });

        const next = adoptUid([byName, byIp], "192.168.1.20:main", "abc123");

        expect(next).toHaveLength(1);
        expect(next[0].id).toBe("abc123");
        // The surviving record keeps its attached state and adopts the newly
        // proven reachable host, because that is the one that just answered.
        expect(next[0].attached).toBe(true);
        expect(next[0].host).toBe("192.168.1.20");
        expect(next[0].sshPort).toBe(2222);
    });

    test("is a no-op when the uid is already the record's id", () => {
        const records = [record({ id: "abc123", backendUid: "abc123" })];
        expect(adoptUid(records, "abc123", "abc123")).toEqual(records);
    });
});

describe("normalizeRecords", () => {
    test("reads a pre-uid file as provisional records", () => {
        const parsed = normalizeRecords([
            { id: "desktop.local:main", host: "desktop.local", instanceId: "main" },
        ]);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].backendUid).toBeNull();
        expect(parsed[0].attached).toBe(false);
    });

    test("drops entries that are not usable records", () => {
        expect(normalizeRecords([null, 42, {}, { host: "x" }])).toHaveLength(0);
    });
});

describe("upsertRecord", () => {
    test("replaces by id and keeps order", () => {
        const a = record({ id: "a", host: "a" });
        const b = record({ id: "b", host: "b" });
        const next = upsertRecord([a, b], record({ id: "a", host: "a", displayName: "renamed" }));
        expect(next.map((r) => r.id)).toEqual(["a", "b"]);
        expect(next[0].displayName).toBe("renamed");
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test electron/src/backend-records.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Write the record type**

In `packages/shared/src/types/backend.ts` (created in Task 3), add:

```ts
export interface BackendRecord {
    /** The record's key. The `backendUid` once known, otherwise a provisional
     *  `${host}:${instanceId}`. Never assume it is one or the other. */
    id: string;
    /** Confirmed identity, learned at handshake. `null` until then. */
    backendUid: string | null;
    host: string;
    instanceId: string;
    displayName: string;
    user: string;
    sshPort: number;
    /** The backend's own port, refreshed from the beacon. Not the tunnel's. */
    lastKnownPort: number | null;
    /** Restored at launch. Attach is attempted in the background, never blocking. */
    attached: boolean;
    addedAt: string;
}
```

- [ ] **Step 5: Write the module**

Create `electron/src/backend-records.ts`:

```ts
import { backendIdFor, isStale } from "@taskflow/shared/discovery";
import type { BackendRecord, DiscoveredBackend } from "@taskflow/shared";

/** A row in the machines menu: a saved record, a discovered backend, or both. */
export interface MenuEntry {
    id: string;
    displayName: string;
    instanceId: string;
    host: string;
    attached: boolean;
    saved: boolean;
    seen: boolean;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * Parse `backends.json`, tolerating a file written before uids existed. Such a
 * file has no `backendUid` and no `attached`, so its records are read as
 * provisional and detached; the first successful handshake rekeys them. There
 * is deliberately no migration step: a machine that is never reached again
 * simply stays provisional, which costs nothing.
 */
export function normalizeRecords(parsed: unknown): BackendRecord[] {
    if (!Array.isArray(parsed)) return [];
    const records: BackendRecord[] = [];
    for (const entry of parsed) {
        if (!isRecordLike(entry)) continue;
        const host = typeof entry.host === "string" ? entry.host : null;
        const instanceId = typeof entry.instanceId === "string" ? entry.instanceId : null;
        if (!host || !instanceId) continue;
        const backendUid = typeof entry.backendUid === "string" ? entry.backendUid : null;
        records.push({
            id: typeof entry.id === "string" ? entry.id : (backendUid ?? backendIdFor(host, instanceId)),
            backendUid,
            host,
            instanceId,
            displayName: typeof entry.displayName === "string" ? entry.displayName : host,
            user: typeof entry.user === "string" ? entry.user : "",
            sshPort: typeof entry.sshPort === "number" ? entry.sshPort : 22,
            lastKnownPort: typeof entry.lastKnownPort === "number" ? entry.lastKnownPort : null,
            attached: entry.attached === true,
            addedAt: typeof entry.addedAt === "string" ? entry.addedAt : new Date(0).toISOString(),
        });
    }
    return records;
}

export function upsertRecord(records: BackendRecord[], next: BackendRecord): BackendRecord[] {
    const index = records.findIndex((record) => record.id === next.id);
    if (index === -1) return [...records, next];
    const copy = [...records];
    copy[index] = next;
    return copy;
}

export function removeRecord(records: BackendRecord[], id: string): BackendRecord[] {
    return records.filter((record) => record.id !== id);
}

/**
 * Rekey the record currently under `currentId` onto the `backendUid` its
 * handshake reported. If another record already holds that uid, the two are one
 * backend reached by two names: they merge, the survivor keeps its attached
 * state, and it adopts the host that just proved reachable.
 */
export function adoptUid(
    records: BackendRecord[],
    currentId: string,
    backendUid: string,
): BackendRecord[] {
    const source = records.find((record) => record.id === currentId);
    if (!source) return records;
    if (source.id === backendUid && source.backendUid === backendUid) return records;

    const existing = records.find((record) => record.id === backendUid && record !== source);
    if (!existing) {
        return records.map((record) =>
            record === source ? { ...record, id: backendUid, backendUid } : record,
        );
    }

    const merged: BackendRecord = {
        ...existing,
        backendUid,
        id: backendUid,
        host: source.host,
        sshPort: source.sshPort,
        user: source.user || existing.user,
        lastKnownPort: source.lastKnownPort ?? existing.lastKnownPort,
        attached: existing.attached || source.attached,
    };
    return records.filter((record) => record !== source).map((record) => (record === existing ? merged : record));
}

export function recordFromDiscovered(entry: DiscoveredBackend, defaultUser: string): BackendRecord {
    return {
        id: entry.backendUid,
        backendUid: entry.backendUid,
        host: entry.hostname,
        instanceId: entry.instanceId,
        displayName: entry.displayName || entry.hostname,
        user: defaultUser,
        sshPort: 22,
        lastKnownPort: entry.port,
        attached: false,
        addedAt: new Date().toISOString(),
    };
}

/**
 * Does this announcement describe this record? Uid first, because that is
 * identity; host and instance only as a fallback for a record that has never
 * completed a handshake.
 */
export function matchesDiscovered(record: BackendRecord, entry: DiscoveredBackend): boolean {
    if (record.backendUid) return record.backendUid === entry.backendUid;
    return record.host === entry.hostname && record.instanceId === entry.instanceId;
}

/** Saved records first in their stored order, then live entries not yet saved. */
export function mergeForMenu(
    records: BackendRecord[],
    discovered: DiscoveredBackend[],
    now: number,
): MenuEntry[] {
    const live = discovered.filter((entry) => !isStale(entry.lastSeenAt, now));
    const saved: MenuEntry[] = records.map((record) => ({
        id: record.id,
        displayName: record.displayName,
        instanceId: record.instanceId,
        host: record.host,
        attached: record.attached,
        saved: true,
        seen: live.some((entry) => matchesDiscovered(record, entry)),
    }));
    const unsaved: MenuEntry[] = live
        .filter((entry) => !records.some((record) => matchesDiscovered(record, entry)))
        .map((entry) => ({
            id: entry.backendUid,
            displayName: entry.displayName || entry.hostname,
            instanceId: entry.instanceId,
            host: entry.hostname,
            attached: false,
            saved: false,
            seen: true,
        }));
    return [...saved, ...unsaved];
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test electron/src/backend-records.test.ts`
Expected: PASS

- [ ] **Step 7: Typecheck and commit**

Run: `bun run typecheck`
Expected: no errors.

```bash
git add electron/package.json electron/src/backend-records.ts electron/src/backend-records.test.ts packages/shared/src/types/backend.ts
git commit -m "feat(electron): back the record list with a confirmed backend uid

A record is keyed by the backend's own uid once a handshake reports one, and by
a provisional host:instance key until then. Adopting a uid merges any record
that already holds it, so one backend reached as an IP and as a hostname cannot
attach twice and deliver every record twice.

A backends.json written before uids is read as provisional records and rekeys
itself on first handshake, so there is no migration step."
```

---
### Task 6: SSH argument construction and failure classification

Execute **Task 5** of the superseded plan in full. No deltas. It is pure string
handling and the attached-set topology does not reach it.

---
### Task 7: The tunnel manager

Execute **Task 6** of the superseded plan in full, with one delta.

**Delta — many children, not one.** That task's module already keys its children
by record id (`closeTunnel(id)`, `hasTunnel(id)`, `closeAllTunnels()`), so the
map is present. What changes is the caller's expectation, and one guarantee to
add: `openTunnel` must be safe to call concurrently for different records, and
calling it twice for the *same* record id returns the existing tunnel rather than
spawning a second ssh. Add at the top of `openTunnel`:

```ts
    const existing = tunnels.get(record.id);
    if (existing?.localPort) return { ok: true, localPort: existing.localPort };
```

Add to that task's commit message that concurrent tunnels are now the normal
case rather than a transitional one.

---
### Task 8: One connection per backend

Replaces **Task 8** of the superseded plan. That task taught one module-global socket to hold a second socket to the *same* logical backend during a swap, which needed a generation counter to tell them apart. Two sockets to *different* machines are separate objects and need no such thing — but a reconnect still replaces the socket inside one connection, so each connection keeps a socket **epoch** of its own.

**Migration note, and it matters for every later task:** `sendRequest` gains a required first argument, which would break all 66 call sites at once. So this task adds the registry and leaves the old zero-backend functions in `useWebSocket.ts` as a shim that routes to primary. The build stays green; later tasks migrate call sites store by store; Task 19 removes the shim. Do not migrate call sites here.

**Files:**
- Create: `packages/ui/src/lib/connection.ts`
- Create: `packages/ui/src/lib/connection-registry.ts`
- Create: `packages/ui/src/lib/connection-registry.test.ts`
- Modify: `packages/ui/src/hooks/useWebSocket.ts`
- Modify: `packages/ui/src/lib/backend-url.ts`

**Interfaces:**
- Consumes: nothing.
- Produces from `lib/connection-registry.ts`: `openConnection(backendId: string, origin: string): Promise<void>`, `closeConnection(backendId: string, reason: "detach" | "switch"): void`, `sendRequest<T>(backendId: string, type: string, payload?: unknown): Promise<T>`, `sendFireAndForget(backendId: string, type: string, payload?: unknown): void`, `onEvent(type: string, handler: (payload: unknown, backendId: string) => void): () => void`, `onStatusChange(backendId: string, handler: (status: ConnectionStatus) => void): () => void`, `originFor(backendId: string): string | null`, `setPrimary(backendId: string): void`, `getPrimary(): string | null`. `BackendSwitchedError` and `BackendDetachedError` are exported error classes.
- Produces from `lib/backend-url.ts`: `rawFileUrl(backendId: string, absolutePath: string): string | null`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/lib/connection-registry.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import {
    closeConnection,
    onEvent,
    openConnection,
    sendRequest,
    setPrimary,
} from "./connection-registry";

/** A minimal WS server that answers every request with its own label. */
function startServer(label: string): { origin: string; stop(): void; broadcast(type: string): void } {
    const sockets = new Set<{ send(data: string): void }>();
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("ok")),
        websocket: {
            open(ws) {
                sockets.add(ws);
            },
            close(ws) {
                sockets.delete(ws);
            },
            message(ws, raw) {
                const request = JSON.parse(String(raw)) as { correlationId?: string; type: string };
                if (!request.correlationId) return;
                ws.send(
                    JSON.stringify({
                        correlationId: request.correlationId,
                        type: request.type,
                        payload: { from: label },
                    }),
                );
            },
        },
    });
    return {
        origin: `http://127.0.0.1:${server.port}`,
        stop: () => void server.stop(true),
        broadcast: (type: string) => {
            for (const ws of sockets) ws.send(JSON.stringify({ type, payload: { from: label } }));
        },
    };
}

const servers: { stop(): void }[] = [];
afterEach(() => {
    closeConnection("a", "detach");
    closeConnection("b", "detach");
    servers.splice(0).forEach((s) => s.stop());
});

describe("connection registry", () => {
    test("routes a request to the named backend and nowhere else", async () => {
        const a = startServer("A");
        const b = startServer("B");
        servers.push(a, b);

        await openConnection("a", a.origin);
        await openConnection("b", b.origin);
        setPrimary("a");

        expect(await sendRequest<{ from: string }>("a", "ping")).toEqual({ from: "A" });
        expect(await sendRequest<{ from: string }>("b", "ping")).toEqual({ from: "B" });
    });

    test("an event handler learns which backend delivered it", async () => {
        const a = startServer("A");
        const b = startServer("B");
        servers.push(a, b);

        await openConnection("a", a.origin);
        await openConnection("b", b.origin);

        const seen: string[] = [];
        const off = onEvent("thing", (_payload, backendId) => seen.push(backendId));
        b.broadcast("thing");
        await new Promise((resolve) => setTimeout(resolve, 200));
        off();

        expect(seen).toEqual(["b"]);
    });

    test("closing one backend rejects only its pending requests", async () => {
        const a = startServer("A");
        servers.push(a);
        await openConnection("a", a.origin);

        // A request that will never be answered, because we close first.
        const pending = sendRequest("a", "never");
        closeConnection("a", "detach");

        await expect(pending).rejects.toThrow(/detach/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui/src/lib/connection-registry.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the connection**

Create `packages/ui/src/lib/connection.ts`:

```ts
import type { WsRequest } from "@taskflow/shared";

export interface ConnectionStatus {
    connected: boolean;
    reconnecting: boolean;
}

const MAX_RECONNECT_DELAY = 60_000;
const REQUEST_TIMEOUT = 30_000;

interface Pending {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timeoutId: ReturnType<typeof setTimeout>;
    /** The socket epoch that sent this. A reply on a later epoch is ignored. */
    epoch: number;
}

export interface ConnectionHooks {
    /** Called for every event frame, with the owning backend id supplied by the registry. */
    onEvent(type: string, payload: unknown): void;
    onStatus(status: ConnectionStatus): void;
}

/**
 * One backend's socket, its pending requests and its reconnect timer.
 *
 * The epoch exists for reconnects, not for multiple backends: two backends are
 * two Connection objects and cannot confuse each other. Within one connection a
 * replaced socket can still deliver a late message, close or error, and without
 * the epoch a stale frame would resolve a request the new socket owns.
 */
export class Connection {
    private socket: WebSocket | null = null;
    private epoch = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempt = 0;
    private pending = new Map<string, Pending>();
    private status: ConnectionStatus = { connected: false, reconnecting: false };
    private closed = false;

    constructor(
        readonly backendId: string,
        readonly origin: string,
        private hooks: ConnectionHooks,
    ) {}

    getStatus(): ConnectionStatus {
        return this.status;
    }

    private setStatus(next: ConnectionStatus): void {
        this.status = next;
        this.hooks.onStatus(next);
    }

    private wsUrl(): string {
        return this.origin.replace(/^http/, "ws");
    }

    open(): Promise<void> {
        this.closed = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const epoch = ++this.epoch;
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(this.wsUrl());
            this.socket = socket;

            socket.onopen = () => {
                if (epoch !== this.epoch) return;
                this.reconnectAttempt = 0;
                this.setStatus({ connected: true, reconnecting: false });
                resolve();
            };
            socket.onerror = () => {
                if (epoch !== this.epoch) return;
                reject(new Error(`WebSocket error for backend ${this.backendId}`));
            };
            socket.onmessage = (event) => {
                if (epoch !== this.epoch) return;
                this.receive(event.data as string, epoch);
            };
            socket.onclose = () => {
                if (epoch !== this.epoch) return;
                this.failPending(new Error("WebSocket closed"), epoch);
                this.setStatus({ connected: false, reconnecting: false });
                if (!this.closed) this.scheduleReconnect();
            };
        });
    }

    private receive(raw: string, epoch: number): void {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return;
        const data = parsed as Record<string, unknown>;

        if (typeof data.correlationId === "string") {
            const entry = this.pending.get(data.correlationId);
            if (!entry || entry.epoch !== epoch) return;
            clearTimeout(entry.timeoutId);
            this.pending.delete(data.correlationId);
            if (data.error) {
                entry.reject(new Error(typeof data.error === "string" ? data.error : "Unknown error"));
            } else {
                entry.resolve(data.payload);
            }
            return;
        }
        if (typeof data.type === "string") this.hooks.onEvent(data.type, data.payload);
    }

    private failPending(reason: Error, epoch: number): void {
        for (const [id, entry] of [...this.pending]) {
            if (entry.epoch !== epoch) continue;
            clearTimeout(entry.timeoutId);
            this.pending.delete(id);
            entry.reject(reason);
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer || this.closed) return;
        this.setStatus({ connected: false, reconnecting: true });
        const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY);
        this.reconnectAttempt++;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.open().catch(() => {});
        }, delay);
    }

    /** Cancel the backoff and retry now. The beacon reappearing is the caller. */
    retryNow(): void {
        if (this.closed) return;
        this.reconnectAttempt = 0;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        void this.open().catch(() => {});
    }

    sendRequest<T>(type: string, payload: unknown): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                reject(new Error(`Backend ${this.backendId} is not connected`));
                return;
            }
            const correlationId = crypto.randomUUID();
            const epoch = this.epoch;
            const timeoutId = setTimeout(() => {
                if (this.pending.delete(correlationId)) {
                    reject(new Error(`Request timeout: ${type}`));
                }
            }, REQUEST_TIMEOUT);
            this.pending.set(correlationId, {
                resolve: resolve as (value: unknown) => void,
                reject,
                timeoutId,
                epoch,
            });
            const request: WsRequest = { correlationId, type, payload };
            this.socket.send(JSON.stringify(request));
        });
    }

    sendFireAndForget(type: string, payload: unknown): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.socket.send(JSON.stringify({ type, payload }));
    }

    /** Close for good. Pending requests reject with `reason` rather than timing out. */
    close(reason: Error): void {
        this.closed = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.failPending(reason, this.epoch);
        this.epoch++;
        this.socket?.close();
        this.socket = null;
        this.setStatus({ connected: false, reconnecting: false });
    }
}
```

- [ ] **Step 4: Write the registry**

Create `packages/ui/src/lib/connection-registry.ts`:

```ts
import { Connection, type ConnectionStatus } from "./connection";

/** Thrown to a request in flight when its backend is detached. */
export class BackendDetachedError extends Error {
    constructor(backendId: string) {
        super(`Backend ${backendId} was detached`);
        this.name = "BackendDetachedError";
    }
}

/** Thrown to a request in flight when a hard switch tears its backend down. */
export class BackendSwitchedError extends Error {
    constructor(backendId: string) {
        super(`Backend ${backendId} was switched away from`);
        this.name = "BackendSwitchedError";
    }
}

const connections = new Map<string, Connection>();
/** Keyed by message type, shared by every connection, as it is today. */
const eventListeners = new Map<string, Set<(payload: unknown, backendId: string) => void>>();
const statusListeners = new Map<string, Set<(status: ConnectionStatus) => void>>();
let primaryId: string | null = null;

export function setPrimary(backendId: string): void {
    primaryId = backendId;
}

export function getPrimary(): string | null {
    return primaryId;
}

export function originFor(backendId: string): string | null {
    return connections.get(backendId)?.origin ?? null;
}

export function attachedIds(): string[] {
    return [...connections.keys()];
}

export function openConnection(backendId: string, origin: string): Promise<void> {
    connections.get(backendId)?.close(new BackendDetachedError(backendId));
    const connection = new Connection(backendId, origin, {
        onEvent(type, payload) {
            const listeners = eventListeners.get(type);
            if (!listeners) return;
            for (const listener of listeners) listener(payload, backendId);
        },
        onStatus(status) {
            const listeners = statusListeners.get(backendId);
            if (!listeners) return;
            for (const listener of listeners) listener(status);
        },
    });
    connections.set(backendId, connection);
    return connection.open();
}

export function closeConnection(backendId: string, reason: "detach" | "switch"): void {
    const connection = connections.get(backendId);
    if (!connection) return;
    connection.close(
        reason === "switch" ? new BackendSwitchedError(backendId) : new BackendDetachedError(backendId),
    );
    connections.delete(backendId);
    if (primaryId === backendId) primaryId = null;
}

export function retryNow(backendId: string): void {
    connections.get(backendId)?.retryNow();
}

export function sendRequest<T = unknown>(
    backendId: string,
    type: string,
    payload: unknown = {},
): Promise<T> {
    const connection = connections.get(backendId);
    if (!connection) return Promise.reject(new BackendDetachedError(backendId));
    return connection.sendRequest<T>(type, payload);
}

export function sendFireAndForget(backendId: string, type: string, payload: unknown = {}): void {
    connections.get(backendId)?.sendFireAndForget(type, payload);
}

/**
 * Listeners are registered against message types, not sockets, and are shared
 * by every connection — which is what lets a machine attach or detach without
 * re-subscribing anything. The second argument is how a handler knows whose
 * event it is holding; without it a desktop TASK_UPDATED would be applied to a
 * laptop record of the same shape.
 */
export function onEvent(
    type: string,
    handler: (payload: unknown, backendId: string) => void,
): () => void {
    let listeners = eventListeners.get(type);
    if (!listeners) {
        listeners = new Set();
        eventListeners.set(type, listeners);
    }
    listeners.add(handler);
    return () => {
        eventListeners.get(type)?.delete(handler);
    };
}

export function onStatusChange(
    backendId: string,
    handler: (status: ConnectionStatus) => void,
): () => void {
    let listeners = statusListeners.get(backendId);
    if (!listeners) {
        listeners = new Set();
        statusListeners.set(backendId, listeners);
    }
    listeners.add(handler);
    handler(connections.get(backendId)?.getStatus() ?? { connected: false, reconnecting: false });
    return () => {
        statusListeners.get(backendId)?.delete(handler);
    };
}

export type { ConnectionStatus };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/ui/src/lib/connection-registry.test.ts`
Expected: PASS

- [ ] **Step 6: Turn useWebSocket into a temporary shim**

Replace the body of `packages/ui/src/hooks/useWebSocket.ts` entirely:

```ts
import {
    getPrimary,
    onEvent as onEventRouted,
    onStatusChange as onStatusChangeRouted,
    openConnection,
    originFor,
    sendFireAndForget as sendFireAndForgetRouted,
    sendRequest as sendRequestRouted,
    type ConnectionStatus,
} from "@/lib/connection-registry";

/**
 * TEMPORARY. These wrappers route to whichever backend is primary so that call
 * sites can migrate to explicit ids one store at a time instead of all 66 at
 * once. Every use is a site that has not been routed yet. Task 19 deletes this
 * file once none are left; do not add new callers.
 */
function primaryOrThrow(): string {
    const id = getPrimary();
    if (!id) throw new Error("No primary backend");
    return id;
}

export function sendRequest<T = unknown>(type: string, payload: unknown = {}): Promise<T> {
    return sendRequestRouted<T>(primaryOrThrow(), type, payload);
}

export function sendFireAndForget(type: string, payload: unknown = {}): void {
    sendFireAndForgetRouted(primaryOrThrow(), type, payload);
}

export function onEvent(type: string, handler: (payload: unknown) => void): () => void {
    return onEventRouted(type, (payload) => handler(payload));
}

export function onStatusChange(handler: (status: ConnectionStatus) => void): () => void {
    const id = getPrimary();
    if (!id) return () => {};
    return onStatusChangeRouted(id, handler);
}

export function connectWebSocket(origin: string): Promise<void> {
    return openConnection(primaryOrThrow(), origin);
}

export function getBackendOrigin(): string | null {
    const id = getPrimary();
    return id ? originFor(id) : null;
}
```

`getBackendPort()` is gone. Its only consumer is `backend-url.ts`, changed next.

- [ ] **Step 7: Resolve file URLs per backend**

Replace `packages/ui/src/lib/backend-url.ts`:

```ts
import { originFor } from "@/lib/connection-registry";

/** URL for the raw bytes of an absolute path on a specific backend, or null if it is not attached. */
function rawFileUrl(backendId: string, absolutePath: string): string | null {
    const origin = originFor(backendId);
    if (origin === null) return null;
    return `${origin}/api/file/raw?path=${encodeURIComponent(absolutePath)}`;
}

export { rawFileUrl };
```

Every `rawFileUrl` caller now needs a backend id. Until Task 15 routes the
editor, pass `getPrimary()` at each call site with a `// TODO(remote-projects):
route to the workspace backend` comment, so the compiler shows the remaining
ones.

- [ ] **Step 8: Verify and commit**

Run: `bun test && bun run typecheck`
Expected: PASS, no type errors.

```bash
git add packages/ui/src/lib/connection.ts packages/ui/src/lib/connection-registry.ts packages/ui/src/lib/connection-registry.test.ts packages/ui/src/hooks/useWebSocket.ts packages/ui/src/lib/backend-url.ts
git commit -m "feat(ui): hold one connection per backend

Each backend gets its own socket, pending-request map and reconnect timer, and
its own socket epoch so a replaced socket cannot resolve a request the new one
owns. Event handlers now receive the backend that delivered the event.

useWebSocket becomes a temporary shim routing to primary, so call sites migrate
one store at a time rather than all 66 in a single change."
```

---
### Task 9: The registry, the attached set, and the IPC surface

Replaces **Task 7** of the superseded plan, which owned a single `activeId`. Main owns the attached set, its persistence, the discovery listener, and the tunnels. It does **not** own the handshake: only the renderer has a socket, so it confirms `backendUid` and `protocolVersion` and reports them back, and main rekeys the record.

**Files:**
- Create: `electron/src/backend-registry.ts`
- Create: `electron/src/backend-registry.test.ts`
- Modify: `electron/src/ipc-handlers.ts`
- Modify: `electron/src/preload.ts`
- Modify: `packages/ui/src/env.d.ts`
- Modify: `electron/src/main.ts:90-140`

**Interfaces:**
- Consumes: Tasks 4, 5, 6, 7.
- Produces on `window.taskflow`:
  - `listBackends(): Promise<MenuEntry[]>`
  - `getAttached(): Promise<{ id: string; origin: string; isLocal: boolean; isPrimary: boolean }[]>`
  - `attachBackend(id): Promise<{ ok: true; origin: string } | { ok: false; failure: TunnelFailure }>`
  - `detachBackend(id): Promise<void>`
  - `confirmBackend(id, info: { backendUid: string; protocolVersion: number }): Promise<{ id: string }>` — rekeys and merges; returns the canonical id
  - `addBackend(input: { host: string; user?: string; sshPort?: number; port?: number }): Promise<BackendRecord>`
  - `updateBackend(id, patch: { displayName?: string; user?: string; sshPort?: number }): Promise<{ ok: boolean; reason?: string }>`
  - `removeBackend(id): Promise<{ ok: boolean; reason?: string }>`
  - `trustBackendHost(id): Promise<{ ok: boolean; reason?: string }>`
  - `getHostFingerprint(id): Promise<{ ok: true; fingerprint: string } | { ok: false; reason: string }>`
  - `onBackendsChanged(cb: () => void): () => void`
  - `onBackendDropped(cb: (id: string, failure: TunnelFailure) => void): () => void`
  - `onBackendSeen(cb: (id: string) => void): () => void` — the beacon reappeared; the renderer cancels that backend's backoff

- [ ] **Step 1: Write the failing test**

Create `electron/src/backend-registry.test.ts`. The registry's persistence and
attached-set arithmetic are testable without Electron or ssh by injecting the
file path and a fake tunnel opener:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createRegistry } from "./backend-registry";

const dirs: string[] = [];
afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function registry() {
    const dir = await mkdtemp(join(tmpdir(), "reg-"));
    dirs.push(dir);
    return {
        dir,
        reg: createRegistry({
            file: join(dir, "backends.json"),
            defaultUser: "kuindji",
            openTunnel: async () => ({ ok: true as const, localPort: 45001 }),
            closeTunnel: () => {},
            readRemotePort: async () => ({ port: 7777 }),
        }),
    };
}

describe("backend registry", () => {
    test("persists the attached flag so a machine is redialled next launch", async () => {
        const { dir, reg } = await registry();
        const record = await reg.addBackend({ host: "desktop.local" });
        await reg.attachBackend(record.id);

        const written = JSON.parse(await readFile(join(dir, "backends.json"), "utf-8")) as {
            attached: boolean;
        }[];
        expect(written[0].attached).toBe(true);
    });

    test("confirming a uid rekeys the record and returns the canonical id", async () => {
        const { reg } = await registry();
        const record = await reg.addBackend({ host: "desktop.local" });
        const { id } = await reg.confirmBackend(record.id, {
            backendUid: "abc123",
            protocolVersion: 1,
        });
        expect(id).toBe("abc123");
        expect((await reg.listBackends()).map((e) => e.id)).toEqual(["abc123"]);
    });

    test("confirming the same uid from a second alias merges rather than duplicating", async () => {
        const { reg } = await registry();
        const byName = await reg.addBackend({ host: "desktop.local" });
        await reg.confirmBackend(byName.id, { backendUid: "abc123", protocolVersion: 1 });

        const byIp = await reg.addBackend({ host: "192.168.1.20" });
        const { id } = await reg.confirmBackend(byIp.id, {
            backendUid: "abc123",
            protocolVersion: 1,
        });

        expect(id).toBe("abc123");
        expect(await reg.listBackends()).toHaveLength(1);
    });

    test("detaching clears the attached flag and the tunnel", async () => {
        const { reg } = await registry();
        const record = await reg.addBackend({ host: "desktop.local" });
        await reg.attachBackend(record.id);
        await reg.detachBackend(record.id);
        expect((await reg.listBackends())[0].attached).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test electron/src/backend-registry.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the registry**

Create `electron/src/backend-registry.ts`. It is a factory rather than a module
singleton so the test can inject a file path and fake tunnels; `main.ts` creates
the one real instance.

```ts
import { readFile, writeFile } from "fs/promises";
import type { BackendRecord, DiscoveredBackend, TunnelFailure } from "@taskflow/shared";
import { backendIdFor, createListener, type DiscoveryListener } from "@taskflow/shared/discovery";
import {
    adoptUid,
    mergeForMenu,
    matchesDiscovered,
    normalizeRecords,
    removeRecord,
    upsertRecord,
    type MenuEntry,
} from "./backend-records";

interface RegistryDeps {
    file: string;
    defaultUser: string;
    openTunnel(
        record: BackendRecord,
        backendPort: number,
    ): Promise<{ ok: true; localPort: number } | { ok: false; failure: TunnelFailure }>;
    closeTunnel(id: string): void;
    readRemotePort(record: BackendRecord): Promise<{ port: number } | { failure: TunnelFailure }>;
}

export function createRegistry(deps: RegistryDeps) {
    let records: BackendRecord[] = [];
    let discovered: DiscoveredBackend[] = [];
    let listener: DiscoveryListener | null = null;
    const origins = new Map<string, string>();
    const changeHandlers = new Set<() => void>();
    const seenHandlers = new Set<(id: string) => void>();

    function notifyChanged(): void {
        for (const handler of changeHandlers) handler();
    }

    async function persist(): Promise<void> {
        await writeFile(deps.file, JSON.stringify(records, null, 2));
    }

    async function load(): Promise<void> {
        try {
            records = normalizeRecords(JSON.parse(await readFile(deps.file, "utf-8")));
        } catch {
            records = [];
        }
    }

    /**
     * The backend's own port. The live beacon first, because a backend's port is
     * allocated per start; then the last one we saw; then the port file over ssh.
     */
    async function resolveBackendPort(record: BackendRecord): Promise<number | TunnelFailure> {
        const live = discovered.find((entry) => matchesDiscovered(record, entry));
        if (live) return live.port;
        if (record.lastKnownPort) return record.lastKnownPort;
        const result = await deps.readRemotePort(record);
        return "port" in result ? result.port : result.failure;
    }

    return {
        async init(): Promise<void> {
            await load();
            listener = createListener({
                onChange(entries) {
                    const before = new Set(
                        discovered.map((entry) => entry.backendUid),
                    );
                    discovered = entries;
                    for (const entry of entries) {
                        if (before.has(entry.backendUid)) continue;
                        const record = records.find((r) => matchesDiscovered(r, entry));
                        if (record) for (const handler of seenHandlers) handler(record.id);
                    }
                    notifyChanged();
                },
            });
            await listener.start();
        },

        listBackends(): Promise<MenuEntry[]> {
            return Promise.resolve(mergeForMenu(records, discovered, Date.now()));
        },

        /** Records whose attached flag was persisted, for the background dial at launch. */
        attachedRecords(): BackendRecord[] {
            return records.filter((record) => record.attached);
        },

        async addBackend(input: {
            host: string;
            user?: string;
            sshPort?: number;
            port?: number;
        }): Promise<BackendRecord> {
            const instanceId = "main";
            const record: BackendRecord = {
                id: backendIdFor(input.host, instanceId),
                backendUid: null,
                host: input.host,
                instanceId,
                displayName: input.host,
                user: input.user || deps.defaultUser,
                sshPort: input.sshPort ?? 22,
                lastKnownPort: input.port ?? null,
                attached: false,
                addedAt: new Date().toISOString(),
            };
            records = upsertRecord(records, record);
            await persist();
            notifyChanged();
            return record;
        },

        async attachBackend(
            id: string,
        ): Promise<{ ok: true; origin: string } | { ok: false; failure: TunnelFailure }> {
            const record = records.find((entry) => entry.id === id);
            if (!record) {
                return {
                    ok: false,
                    failure: { kind: "unknown", message: "No such backend", stderr: "" },
                };
            }

            const port = await resolveBackendPort(record);
            if (typeof port !== "number") return { ok: false, failure: port };

            const tunnel = await deps.openTunnel(record, port);
            if (!tunnel.ok) return tunnel;

            const origin = `http://127.0.0.1:${tunnel.localPort}`;
            origins.set(id, origin);
            records = upsertRecord(records, { ...record, attached: true, lastKnownPort: port });
            await persist();
            notifyChanged();
            return { ok: true, origin };
        },

        async detachBackend(id: string): Promise<void> {
            deps.closeTunnel(id);
            origins.delete(id);
            const record = records.find((entry) => entry.id === id);
            if (record) records = upsertRecord(records, { ...record, attached: false });
            await persist();
            notifyChanged();
        },

        /**
         * The renderer completed a handshake and learned who this really is.
         * Rekeying happens here rather than at attach time because only the
         * renderer has a socket, and a beacon-advertised uid is a hint anyone on
         * the LAN can forge.
         */
        async confirmBackend(
            id: string,
            info: { backendUid: string; protocolVersion: number },
        ): Promise<{ id: string }> {
            const before = records.find((entry) => entry.id === id);
            records = adoptUid(records, id, info.backendUid);
            if (before && id !== info.backendUid) {
                const origin = origins.get(id);
                if (origin) {
                    origins.delete(id);
                    origins.set(info.backendUid, origin);
                }
            }
            await persist();
            notifyChanged();
            return { id: info.backendUid };
        },

        async updateBackend(
            id: string,
            patch: { displayName?: string; user?: string; sshPort?: number },
        ): Promise<{ ok: boolean; reason?: string }> {
            const record = records.find((entry) => entry.id === id);
            if (!record) return { ok: false, reason: "No such backend" };
            records = upsertRecord(records, { ...record, ...patch });
            await persist();
            notifyChanged();
            return { ok: true };
        },

        async removeBackend(id: string): Promise<{ ok: boolean; reason?: string }> {
            deps.closeTunnel(id);
            origins.delete(id);
            records = removeRecord(records, id);
            await persist();
            notifyChanged();
            return { ok: true };
        },

        originFor(id: string): string | null {
            return origins.get(id) ?? null;
        },

        onChanged(handler: () => void): () => void {
            changeHandlers.add(handler);
            return () => changeHandlers.delete(handler);
        },

        onSeen(handler: (id: string) => void): () => void {
            seenHandlers.add(handler);
            return () => seenHandlers.delete(handler);
        },

        probe(): void {
            listener?.probe();
        },

        stop(): void {
            listener?.stop();
        },
    };
}

export type BackendRegistry = ReturnType<typeof createRegistry>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test electron/src/backend-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Expose the IPC channels**

In `electron/src/ipc-handlers.ts`, register one `ipcMain.handle` per method in
the Interfaces block above, each delegating to the registry instance created in
`main.ts`. Follow the file's existing registration style exactly. The local
backend is not a record: `getAttached` always includes it first, as
`{ id: "local", origin: backendOrigin(getBackendPort()), isLocal: true, isPrimary: … }`.

`onBackendsChanged`, `onBackendDropped` and `onBackendSeen` are `webContents.send`
pushes, not handles; wire them from `registry.onChanged`, the tunnel manager's
`onTunnelExit`, and `registry.onSeen` respectively.

- [ ] **Step 6: Bridge them in preload and type them**

In `electron/src/preload.ts`, add each channel to the `taskflow` object,
matching the file's existing `invoke` / `on` style. Mirror the signatures in
`packages/ui/src/env.d.ts` exactly as written in the Interfaces block. Do not
widen any type to `unknown` to make it compile.

- [ ] **Step 7: Create the registry at startup and dial in the background**

In `electron/src/main.ts`, after the local backend is spawned, create the
registry, call `init()`, and then dial every persisted attached record **without
awaiting them**:

```ts
    const registry = createRegistry({
        file: join(app.getPath("userData"), "backends.json"),
        defaultUser: userInfo().username,
        openTunnel,
        closeTunnel,
        readRemotePort,
    });
    await registry.init();

    // Deliberately not awaited: launch must not wait on ssh to a machine that
    // may be asleep or on another network. Failures surface per machine in the
    // sidebar, not as a blocked startup.
    for (const record of registry.attachedRecords()) {
        void registry.attachBackend(record.id);
    }
```

On `before-quit`, call `registry.stop()` and `closeAllTunnels()`.

- [ ] **Step 8: Verify and commit**

Run: `bun test && bun run typecheck`
Expected: PASS, no type errors.

```bash
git add electron/src/backend-registry.ts electron/src/backend-registry.test.ts electron/src/ipc-handlers.ts electron/src/preload.ts electron/src/main.ts packages/ui/src/env.d.ts
git commit -m "feat(electron): own an attached set of backends

Main persists which backends are attached and redials them in the background at
launch, so startup never waits on ssh to a sleeping machine.

The handshake stays in the renderer, which is the only side with a socket: it
reports the backend uid it actually saw and main rekeys and merges the record,
so a beacon-advertised uid is never trusted on its own."
```

---
### Task 10: The renderer's attached set — backend-store, handshake, detach

Replaces **Task 9** of the superseded plan, whose `resetAllState()` cleared everything. Here `detach(backendId)` is the only teardown primitive, and it must be complete on its own because aggregate mode has no remount to hide behind.

**Files:**
- Create: `packages/ui/src/stores/store-reset.ts`
- Create: `packages/ui/src/stores/backend-store.ts`
- Create: `packages/ui/src/stores/store-reset.test.ts`
- Modify: `packages/ui/src/providers/WebSocketProvider.tsx`

**Interfaces:**
- Consumes: Task 8's registry; Task 9's IPC.
- Produces: `registerBackendReset(name: string, reset: (backendId: string) => void): void` and `resetBackend(backendId: string): void` from `store-reset.ts`; `registeredResetNames(): string[]` for the enumeration test. From `backend-store.ts`: `useBackendStore` with `machines: MachineState[]`, `primaryId: string | null`, `attach(id)`, `detach(id)`, `retry(id)`, `bootstrapBackend(id)`, where `MachineState = { id, displayName, host, instanceId, state: "attaching" | "attached" | "offline" | "incompatible", failure?: TunnelFailure, isLocal: boolean }`.

- [ ] **Step 1: Write the failing reset test**

Create `packages/ui/src/stores/store-reset.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { registerBackendReset, registeredResetNames, resetBackend } from "./store-reset";

describe("store reset registry", () => {
    test("passes the backend id to every reset and calls each once", () => {
        const calls: string[] = [];
        registerBackendReset("alpha", (id) => calls.push(`alpha:${id}`));
        registerBackendReset("beta", (id) => calls.push(`beta:${id}`));

        resetBackend("desktop");

        expect(calls).toEqual(["alpha:desktop", "beta:desktop"]);
    });

    test("registering the same name twice replaces rather than duplicates", () => {
        const calls: string[] = [];
        registerBackendReset("gamma", () => calls.push("first"));
        registerBackendReset("gamma", () => calls.push("second"));
        resetBackend("x");
        expect(calls.filter((c) => c.startsWith("first"))).toHaveLength(0);
    });

    test("every store that holds backend data is registered", () => {
        // This list is the point of the test. Adding a per-backend store without
        // adding it here is the bug; the failure message should say which.
        const required = [
            "project-store",
            "task-store",
            "notification-store",
            "schedule-store",
            "diff-store",
            "flow-store",
            "settings-mirror",
            "session-store",
            "session-activity",
            "agent-cache",
            "homedir-cache",
            "editor-cache",
            "codex-model-cache",
            "tsconfig-cache",
            "connectivity",
            "run-menu-cache",
            "file-stat-cache",
            "editor-models",
        ];
        const names = registeredResetNames();
        for (const name of required) expect(names).toContain(name);
    });
});
```

The enumeration test fails until the later tasks register their stores. Mark it
`test.todo` for now and turn it on in Task 19, which is the task that completes
the set — but write it here so the list exists from the start.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui/src/stores/store-reset.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the reset registry**

Create `packages/ui/src/stores/store-reset.ts`:

```ts
/**
 * Per-backend teardown. A reset MUST drop only the named backend's state: in
 * aggregate mode a reset that clears everything looks correct until a second
 * machine is attached, and then quietly wipes it.
 */
type BackendReset = (backendId: string) => void;

const resets = new Map<string, BackendReset>();

export function registerBackendReset(name: string, reset: BackendReset): void {
    resets.set(name, reset);
}

export function resetBackend(backendId: string): void {
    for (const reset of resets.values()) reset(backendId);
}

export function registeredResetNames(): string[] {
    return [...resets.keys()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/ui/src/stores/store-reset.test.ts`
Expected: PASS (with the enumeration case still `test.todo`).

- [ ] **Step 5: Write the backend store**

Create `packages/ui/src/stores/backend-store.ts`:

```ts
import { create } from "zustand";
import { MSG, PROTOCOL_VERSION } from "@taskflow/shared";
import type { SystemInfoResponse, TunnelFailure } from "@taskflow/shared";
import {
    closeConnection,
    openConnection,
    retryNow,
    sendRequest,
    setPrimary,
} from "@/lib/connection-registry";
import { resetBackend } from "./store-reset";

/**
 * For the failures that never reach ssh at all — a refused socket, a handshake
 * that never answered. `classifyTunnelFailure` lives in the main process and is
 * not importable here, so this constructs the union's generic variant directly.
 * `stderr` stays empty rather than absent: it is always retained so that a
 * misclassification stays diagnosable.
 */
function unknownFailure(message: string): TunnelFailure {
    return { kind: "unknown", message, stderr: "" };
}

export type MachineState = {
    id: string;
    displayName: string;
    host: string;
    instanceId: string;
    state: "attaching" | "attached" | "offline" | "incompatible";
    failure?: TunnelFailure;
    isLocal: boolean;
};

interface BackendStore {
    machines: MachineState[];
    primaryId: string | null;
    attach(id: string): Promise<void>;
    detach(id: string): Promise<void>;
    retry(id: string): void;
}

function patch(id: string, changes: Partial<MachineState>): void {
    useBackendStore.setState((state) => ({
        machines: state.machines.map((m) => (m.id === id ? { ...m, ...changes } : m)),
    }));
}

export const useBackendStore = create<BackendStore>(() => ({
    machines: [],
    primaryId: null,

    async attach(id) {
        patch(id, { state: "attaching", failure: undefined });

        const result = await window.taskflow!.attachBackend(id);
        if (!result.ok) {
            patch(id, { state: "offline", failure: result.failure });
            return;
        }

        try {
            await openConnection(id, result.origin);
        } catch {
            patch(id, { state: "offline", failure: unknownFailure("Socket refused") });
            return;
        }

        // The handshake. A socket opening proves a server is listening, not that
        // it is a compatible Taskflow, and the beacon's uid is a hint anyone on
        // the LAN can forge — this is where identity is actually established.
        let info: SystemInfoResponse;
        try {
            info = await sendRequest<SystemInfoResponse>(id, MSG.SYSTEM_INFO, {});
        } catch {
            closeConnection(id, "detach");
            patch(id, { state: "offline", failure: unknownFailure("No handshake") });
            return;
        }

        if (info.protocolVersion !== PROTOCOL_VERSION) {
            closeConnection(id, "detach");
            patch(id, { state: "incompatible" });
            return;
        }

        if (info.backendUid) {
            const { id: canonical } = await window.taskflow!.confirmBackend(id, {
                backendUid: info.backendUid,
                protocolVersion: info.protocolVersion,
            });
            if (canonical !== id) {
                // Two aliases of one backend. Main merged the records; drop this
                // connection and let the canonical one stand.
                closeConnection(id, "detach");
                useBackendStore.setState((state) => ({
                    machines: state.machines.filter((m) => m.id !== id),
                }));
                return;
            }
        }

        patch(id, { state: "attached" });
    },

    async detach(id) {
        closeConnection(id, "detach");
        resetBackend(id);
        await window.taskflow!.detachBackend(id);
        patch(id, { state: "offline" });
    },

    retry(id) {
        retryNow(id);
        void useBackendStore.getState().attach(id);
    },
}));

export function setPrimaryBackend(id: string): void {
    setPrimary(id);
    useBackendStore.setState({ primaryId: id });
}
```

- [ ] **Step 6: Populate the machine list and follow main's pushes**

`machines` is never populated by the code above — `patch` only edits rows that
already exist. Add a `refresh()` that reads both IPC sources and reconciles
them, and subscribe to the three pushes Task 9 emits, which are otherwise
produced and never consumed:

```ts
    async refresh() {
        const [entries, attached] = await Promise.all([
            window.taskflow!.listBackends(),
            window.taskflow!.getAttached(),
        ]);
        const attachedById = new Map(attached.map((a) => [a.id, a]));
        useBackendStore.setState((state) => ({
            machines: entries.map((entry) => {
                const previous = state.machines.find((m) => m.id === entry.id);
                const live = attachedById.get(entry.id);
                return {
                    id: entry.id,
                    displayName: entry.displayName,
                    host: entry.host,
                    instanceId: entry.instanceId,
                    isLocal: live?.isLocal ?? false,
                    // A row mid-attach keeps its state; main's view of "attached"
                    // means a tunnel exists, not that the handshake passed.
                    state: previous?.state === "attaching" ? "attaching" : (live ? "attached" : "offline"),
                    failure: previous?.failure,
                };
            }),
        }));
    },
```

Wire the subscriptions once, where the store is created:

```ts
window.taskflow?.onBackendsChanged(() => void useBackendStore.getState().refresh());

window.taskflow?.onBackendDropped((id, failure) => {
    // The ssh child died. The connection is gone but the records are not: the
    // workspace stays on screen and only this machine goes offline.
    patch(id, { state: "offline", failure });
});

window.taskflow?.onBackendSeen((id) => {
    // The beacon reappeared, which is positive evidence the machine woke up.
    // Cancel the backoff rather than waiting out a 60-second ceiling.
    const machine = useBackendStore.getState().machines.find((m) => m.id === id);
    if (machine && machine.state === "offline") useBackendStore.getState().retry(id);
});
```

Add `refresh(): Promise<void>` to the `BackendStore` interface.

- [ ] **Step 7: Attach local first, then the rest, in the provider**

In `packages/ui/src/providers/WebSocketProvider.tsx`, replace the single connect
with: open the local connection, `setPrimaryBackend("local")`, bootstrap it, and
then read `window.taskflow.getAttached()` and attach every other entry, each
independently and none blocking the render.

Under the non-Electron dev renderer there is no `window.taskflow`: open one
connection to `VITE_BACKEND_PORT`'s origin as `"local"`, make it primary, and
stop. This path must not throw.

- [ ] **Step 8: Verify and commit**

Run: `bun test && bun run typecheck`
Expected: PASS, no type errors.

```bash
git add packages/ui/src/stores/store-reset.ts packages/ui/src/stores/store-reset.test.ts packages/ui/src/stores/backend-store.ts packages/ui/src/providers/WebSocketProvider.tsx
git commit -m "feat(ui): attach backends independently, with per-backend teardown

Detach is the only teardown primitive and drops one backend's state, because
aggregate mode has no remount to fall back on.

The handshake runs in the renderer and establishes identity: a socket opening
proves only that something is listening, and a beacon-advertised uid is a hint
anyone on the LAN can forge. Confirming it merges two aliases of one backend
into one attached member."
```

---

### Task 11: Per-backend slices, revision guards, and the project and task stores

The first two aggregating stores, and the pattern every later one copies. Read this task's `backend-scope.ts` before Tasks 12 and 13; they use it and do not restate it.

**Files:**
- Create: `packages/ui/src/lib/backend-scope.ts`
- Create: `packages/ui/src/lib/backend-scope.test.ts`
- Modify: `packages/ui/src/stores/project-store.ts`
- Modify: `packages/ui/src/stores/task-store.ts`
- Modify: `packages/shared/src/utils/task-order.ts:14`
- Create: `packages/ui/src/stores/aggregation.test.ts`

**Interfaces:**
- Consumes: Tasks 8, 10.
- Produces: `Scoped<T> = T & { backendId: string }`; `createSlices<T>()` returning `{ read(): Scoped<T>[]; replace(backendId, items, token): void; drop(backendId): void; apply(backendId, fn): void; token(backendId): number }`.

- [ ] **Step 1: Write the failing scope test**

Create `packages/ui/src/lib/backend-scope.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createSlices } from "./backend-scope";

interface Item {
    id: string;
}

describe("createSlices", () => {
    test("holds each backend's items separately and reads them merged", () => {
        const slices = createSlices<Item>();
        slices.replace("a", [{ id: "1" }], slices.token("a"));
        slices.replace("b", [{ id: "2" }], slices.token("b"));

        expect(slices.read().map((i) => `${i.backendId}:${i.id}`)).toEqual(["a:1", "b:2"]);
    });

    test("a stale list response is discarded rather than overwriting newer state", () => {
        const slices = createSlices<Item>();
        const token = slices.token("a"); // taken before the event lands

        // An event mutates the slice while the list request is in flight.
        slices.apply("a", (items) => [...items, { id: "created" }]);

        // The list response resolves with a snapshot taken before that.
        slices.replace("a", [], token);

        expect(slices.read().map((i) => i.id)).toEqual(["created"]);
    });

    test("a fresh list response replaces the slice", () => {
        const slices = createSlices<Item>();
        slices.apply("a", (items) => [...items, { id: "old" }]);
        slices.replace("a", [{ id: "new" }], slices.token("a"));
        expect(slices.read().map((i) => i.id)).toEqual(["new"]);
    });

    test("dropping one backend leaves the others untouched", () => {
        const slices = createSlices<Item>();
        slices.replace("a", [{ id: "1" }], slices.token("a"));
        slices.replace("b", [{ id: "2" }], slices.token("b"));
        slices.drop("a");
        expect(slices.read().map((i) => i.backendId)).toEqual(["b"]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui/src/lib/backend-scope.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the slice helper**

Create `packages/ui/src/lib/backend-scope.ts`:

```ts
/** A record tagged with the connection that delivered it. The protocol never carries this. */
export type Scoped<T> = T & { backendId: string };

interface Slice<T> {
    items: Scoped<T>[];
    /** Bumped by every write. A list response carrying an older token is stale. */
    revision: number;
}

/**
 * Per-backend slices behind a merged read.
 *
 * Two hazards make the slices necessary rather than tidy. A whole-array replace
 * erases other backends' records when one backend's fetch resolves. And a list
 * response is a snapshot: if an event — or a local optimistic write — lands
 * while the request is in flight, the response is older than the state it would
 * overwrite. `token()` before the request and `replace(..., token)` after is how
 * both are avoided.
 */
export function createSlices<T>() {
    const slices = new Map<string, Slice<T>>();

    function sliceFor(backendId: string): Slice<T> {
        let slice = slices.get(backendId);
        if (!slice) {
            slice = { items: [], revision: 0 };
            slices.set(backendId, slice);
        }
        return slice;
    }

    return {
        read(): Scoped<T>[] {
            return [...slices.values()].flatMap((slice) => slice.items);
        },
        token(backendId: string): number {
            return sliceFor(backendId).revision;
        },
        replace(backendId: string, items: T[], token: number): void {
            const slice = sliceFor(backendId);
            if (slice.revision !== token) return; // Stale snapshot; the newer writes stand.
            slice.items = items.map((item) => ({ ...item, backendId }));
            slice.revision++;
        },
        apply(backendId: string, fn: (items: Scoped<T>[]) => Scoped<T>[]): void {
            const slice = sliceFor(backendId);
            slice.items = fn(slice.items);
            slice.revision++;
        },
        drop(backendId: string): void {
            slices.delete(backendId);
        },
        backends(): string[] {
            return [...slices.keys()];
        },
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/ui/src/lib/backend-scope.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing aggregation test**

Create `packages/ui/src/stores/aggregation.test.ts` asserting, against the
project store with two fake backends attached: records from A and B coexist with
correct `backendId`s; a `PROJECT_UPDATED` event delivered by A changes only A's
record when both hold a project of the same shape; `detach("a")` leaves B's
records intact; and a mutation on a B record is sent on B's connection. Use the
two-server helper from Task 8's test — extract it to
`packages/ui/src/lib/test-ws-server.ts` and import it from both, rather than
copying it.

- [ ] **Step 6: Convert the project store**

In `packages/ui/src/stores/project-store.ts`: hold `createSlices<Project>()`,
expose `projects: Scoped<Project>[]` derived from `read()`, and change every
method to route by the record's own origin.

```ts
    async fetchProjects(backendId: string) {
        const token = slices.token(backendId);
        const { projects } = await sendRequest<ProjectListResponse>(backendId, MSG.PROJECT_LIST);
        slices.replace(backendId, projects, token);
        useProjectStore.setState({ projects: slices.read() });
    },

    async updateProject(project: Scoped<Project>, updates: ProjectUpdate) {
        const updated = await sendRequest<Project>(project.backendId, MSG.PROJECT_UPDATE, {
            id: project.id,
            ...updates,
        });
        slices.apply(project.backendId, (items) =>
            items.map((p) => (p.id === updated.id ? { ...updated, backendId: project.backendId } : p)),
        );
        useProjectStore.setState({ projects: slices.read() });
    },
```

Take the whole record rather than an id wherever a method mutates one — that is
what makes the target unforgeable. `reorderProjects(backendId, orderedIds)`
takes the machine explicitly, because ordering is per machine.

Move the four module-level `onEvent` handlers to the two-argument form and write
through the owning slice:

```ts
const _unsubProjectCreated = onEvent(MSG.PROJECT_CREATED, (payload, backendId) => {
    if (!payload || typeof payload !== "object" || !("id" in payload)) return;
    const project = payload as Project;
    slices.apply(backendId, (items) =>
        items.some((p) => p.id === project.id) ? items : [...items, { ...project, backendId }],
    );
    useProjectStore.setState({ projects: slices.read() });
});
```

Register the reset:

```ts
registerBackendReset("project-store", (backendId) => {
    slices.drop(backendId);
    useProjectStore.setState({ projects: slices.read() });
});
```

- [ ] **Step 7: Convert the task store the same way**

`fetchTasks(backendId)`, `fetchArchivedTasks(backendId)`, and mutations taking
`Scoped<Task>`. `createTask` writes optimistically from its own response
(`TASK_CREATE` does not broadcast), so it must go through `slices.apply`, which
bumps the revision — that is what stops an in-flight `TASK_LIST` from erasing it:

```ts
    async createTask(backendId: string, payload: TaskCreatePayload) {
        const task = await sendRequest<Task>(backendId, MSG.TASK_CREATE, payload);
        slices.apply(backendId, (items) => sortTasksByCreatedAtDesc([...items, { ...task, backendId }]));
        useTaskStore.setState({ tasks: slices.read() });
        return task;
    },
```

`sortTasksByCreatedAtDesc` is typed `(tasks: Task[]) => Task[]`
(`packages/shared/src/utils/task-order.ts:14`), which would drop the
`backendId` from the return type. Widen it in place — the body is unchanged:

```ts
export function sortTasksByCreatedAtDesc<T extends Task>(tasks: T[]): T[] {
```

Register `registerBackendReset("task-store", …)`.

- [ ] **Step 8: Fan out the bootstrap**

`bootstrapBackend(id)` in `backend-store.ts` calls `fetchProjects(id)` and
`fetchTasks(id)` for that one backend, and `backend-store.attach` calls it after
the handshake passes. A leg that throws marks that machine offline and leaves
every other slice alone.

- [ ] **Step 9: Run tests and commit**

Run: `bun test packages/ui/src/stores/aggregation.test.ts && bun test && bun run typecheck`
Expected: PASS

```bash
git add packages/ui/src/lib/backend-scope.ts packages/ui/src/lib/backend-scope.test.ts packages/ui/src/lib/test-ws-server.ts packages/ui/src/stores/project-store.ts packages/ui/src/stores/task-store.ts packages/ui/src/stores/aggregation.test.ts
git commit -m "feat(ui): hold projects and tasks in per-backend slices

Each backend's records live in their own slice behind a merged read, so one
machine's fetch cannot erase another's, and mutations route by the record's own
origin rather than by an ambient current backend.

Slices carry a revision. A list response is a snapshot, so an event or an
optimistic local write landing while the request is in flight makes the response
older than the state it would overwrite; the response is discarded instead."
```

---
### Task 12: The remaining aggregating stores

The rule from the spec: **a store aggregates if anything reads it from outside the active workspace.** The sidebar is why — it renders every project and task from every attached machine. Follow Task 11's pattern exactly; it is not restated here.

Three of these were wrongly classified as workspace-scoped during design, and the failure mode in each case is silence rather than an error.

**Files:**
- Modify: `packages/ui/src/stores/notification-store.ts`
- Modify: `packages/ui/src/stores/schedule-store.ts`
- Modify: `packages/ui/src/stores/diff-store.ts`
- Modify: `packages/ui/src/stores/flow-store.ts`
- Modify: `packages/ui/src/stores/settings-store.ts`

**Interfaces:**
- Consumes: Task 11's `createSlices`, `Scoped<T>`.
- Produces: `useSettingsStore.settingsFor(backendId): AppSettings | null` and `useSettingsStore.primarySettings(): AppSettings | null`; `filterByProject(items, projectId, backendId)` in `flow-store.ts`.

- [ ] **Step 1: Aggregate the notification store**

Slices of `Notification`. `fetchNotifications(backendId)`; `markAsRead` and
`deleteNotification` take `Scoped<Notification>`. `deleteAll()` fans out:

```ts
    async deleteAll() {
        // The list shows every attached machine's notifications, so clearing it
        // must clear every attached machine. Sending { all: true } to one
        // backend would present a merged list and empty one slice of it.
        await Promise.allSettled(
            slices.backends().map((backendId) =>
                sendRequest(backendId, MSG.NOTIFICATION_DELETED, { all: true }),
            ),
        );
    },
```

Register `registerBackendReset("notification-store", …)`.

- [ ] **Step 2: Aggregate the schedule store**

Slices of `Schedule`. Every `Schedule` carries a required `projectId`, so a
schedule's machine is always its project's machine — mutations take
`Scoped<Schedule>` and creation takes the project's `backendId`. Register
`registerBackendReset("schedule-store", …)`.

- [ ] **Step 3: Aggregate the diff store**

This one is populated only by a broadcast and has no fetch, so it needs slices
for teardown rather than for stale responses.

`diff-store.ts:31`'s `GIT_CHANGE_STATS` listener is the sole writer and its
`targetId` is a project or task id. `TaskSidebar.tsx:358-361` reads the maps for
every project and task row, so left single-backend, remote rows silently show no
diff badge and no behind count — no error, just missing numbers.

Keep the seven flat `Record<string, …>` maps, since `targetId`s are UUIDs and
cannot collide, but track which backend contributed each key:

```ts
const ownerByTarget = new Map<string, string>();

const _unsubChangeStats = onEvent(MSG.GIT_CHANGE_STATS, (payload, backendId) => {
    const { targetId, stats } = payload as ChangeStatsEvent;
    ownerByTarget.set(targetId, backendId);
    // …existing body unchanged…
});

registerBackendReset("diff-store", (backendId) => {
    const dropped = [...ownerByTarget.entries()]
        .filter(([, owner]) => owner === backendId)
        .map(([targetId]) => targetId);
    for (const targetId of dropped) ownerByTarget.delete(targetId);
    useDiffStore.setState((state) => omitKeys(state, dropped));
});
```

Write `omitKeys` as a small local helper that rebuilds each of the seven maps
without the dropped keys. Do not reach for `createSlices` here — the store's
shape is seven parallel maps, not a list, and forcing it would be worse.

- [ ] **Step 4: Aggregate flow and action definitions**

Slices of `FlowDefinition` and `ActionDefinition`. `activeRuns` stays a flat
`Record<string, FlowRun>` keyed by owner id, which is a UUID.

`filterByProject` (`flow-store.ts:21-27`) returns every definition with no
`projectId` for any project. Aggregated without a machine filter, a desktop
project's run menu would list the laptop's global flows, which the desktop
cannot run — `FLOW_START` resolves the id against its own store
(`handlers/flow.ts:88-90`) and throws. Add the machine dimension:

```ts
/**
 * Global definitions (no projectId) belong to a machine like any other. A
 * project's menu offers its own machine's globals plus its own definitions, and
 * never another machine's, because FLOW_START resolves ids locally.
 */
function filterByProject<T extends { projectId?: string }>(
    items: Scoped<T>[],
    projectId: string | null | undefined,
    backendId: string,
): Scoped<T>[] {
    const mine = items.filter((item) => item.backendId === backendId);
    if (!projectId) return mine.filter((item) => !item.projectId);
    return mine.filter((item) => !item.projectId || item.projectId === projectId);
}
```

Every caller — `useRunMenu.ts:76-82`, `useSessionSync.ts:69-75`,
`FlowManagementDialog.tsx` — passes a backend id. Register
`registerBackendReset("flow-store", …)`.

- [ ] **Step 5: Mirror settings per machine, writable only on primary**

Launch payloads carry agent defaults read from a single store
(`AgentOptionsPanel.tsx:41-45`). With a primary-only store, a task created on
the desktop is prefilled with this machine's default model, permission mode and
shell and sent to the desktop — routed correctly, populated wrongly, silently.

```ts
interface SettingsStore {
    /** Every attached machine's settings. Read-only except for primary's. */
    byBackend: Record<string, AppSettings>;
    fetchSettings(backendId: string): Promise<void>;
    /** Only ever sent to primary. Passing any other id is a programming error. */
    updateSettings(payload: SettingsUpdatePayload): Promise<void>;
}

export function settingsFor(backendId: string): AppSettings | null {
    return useSettingsStore.getState().byBackend[backendId] ?? null;
}
```

`updateSettings` reads `getPrimary()` itself rather than taking an id, so there
is no call site that can route a write to a non-primary machine. Register
`registerBackendReset("settings-mirror", …)`.

- [ ] **Step 6: Extend the aggregation test**

Add to `packages/ui/src/stores/aggregation.test.ts`: `deleteAll` reaches both
fake backends; a `GIT_CHANGE_STATS` from A followed by `detach("a")` leaves B's
badge entries intact; `filterByProject` for B's project returns none of A's
global flows; and `settingsFor("b")` returns B's values while
`updateSettings` sends only to primary.

- [ ] **Step 7: Run tests and commit**

Run: `bun test && bun run typecheck`
Expected: PASS

```bash
git add packages/ui/src/stores/notification-store.ts packages/ui/src/stores/schedule-store.ts packages/ui/src/stores/diff-store.ts packages/ui/src/stores/flow-store.ts packages/ui/src/stores/settings-store.ts packages/ui/src/stores/aggregation.test.ts
git commit -m "feat(ui): aggregate the stores the sidebar reads

Diff stats, flow and action definitions and settings all get read outside the
active workspace, so all three hold per-backend state now. Left single-backend
each failed silently: remote rows with no diff badges, a remote run menu
offering flows that machine cannot start, and remote tasks launched with this
machine's agent defaults.

Settings are mirrored read-only per machine; writes resolve primary themselves
so no call site can route one elsewhere."
```

---

### Task 13: Session state per backend

Session tabs, status and activity timers. The pruning bug here closes live remote terminals, so it gets its own task rather than riding along with Task 12.

**Files:**
- Modify: `packages/ui/src/stores/session-sync.ts`
- Modify: `packages/ui/src/stores/session-store.ts`
- Modify: `packages/ui/src/stores/session-subscriptions.ts`
- Modify: `packages/ui/src/stores/session-activity.ts`
- Modify: `packages/ui/src/components/sidebar/hooks/useSidebarData.ts:32-70`
- Create: `packages/ui/src/stores/session-sync.backend.test.ts`

**Interfaces:**
- Consumes: Tasks 10, 11.
- Produces: `syncOwnerTabs` gains `ownedWorkspaceKeys: ReadonlySet<string>`; `syncWithTasks(backendId, tasks)` and `syncWithProjects(backendId, projects)`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/stores/session-sync.backend.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { SessionRef } from "@taskflow/shared";
import { syncOwnerTabs } from "./session-sync";
import { createSessionTab } from "./session-helpers";

function makeSession(id: string): SessionRef {
    return { id, type: "claude", label: "Claude", createdAt: "2026-01-01T00:00:00.000Z", instance: "test" };
}

describe("syncOwnerTabs scoped to one backend", () => {
    test("a sync for one machine leaves another machine's tabs alone", () => {
        const laptop = makeSession("session-laptop");
        const desktop = makeSession("session-desktop");
        const laptopTab = createSessionTab(laptop);
        const desktopTab = createSessionTab(desktop);

        const result = syncOwnerTabs({
            owners: [{ id: "laptop-task", sessions: [laptop] }],
            keyPrefix: "task:",
            getWorkspaceKey: (id: string) => `task:${id}`,
            // Only the laptop's workspaces are this sync's business.
            ownedWorkspaceKeys: new Set(["task:laptop-task"]),
            tabsByWorkspace: {
                "task:laptop-task": [laptopTab],
                "task:desktop-task": [desktopTab],
            },
            activeTabByWorkspace: {
                "task:laptop-task": laptopTab.id,
                "task:desktop-task": desktopTab.id,
            },
            pendingSessionCreates: new Set<string>(),
        });

        expect(result.tabsByWorkspace["task:laptop-task"]).toHaveLength(1);
        expect(result.tabsByWorkspace["task:desktop-task"]).toEqual([desktopTab]);
        expect(result.activeTabByWorkspace["task:desktop-task"]).toBe(desktopTab.id);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui/src/stores/session-sync.backend.test.ts`
Expected: FAIL — the desktop's entry is `undefined`, because `syncOwnerTabs`
rebuilds the whole `task:` namespace from the owners it was handed.

- [ ] **Step 3: Scope the rebuild**

In `packages/ui/src/stores/session-sync.ts`, `syncOwnerTabs` currently keeps only
keys outside `keyPrefix` and re-adds one per owner, so any workspace whose owner
is absent is dropped with its tabs. Add `ownedWorkspaceKeys` to
`SyncOwnerTabsArgs` and change the two carry-over loops (`session-sync.ts:84-92`):

```ts
    const nextTabs: Record<string, Tab[]> = {};
    for (const [key, value] of Object.entries(args.tabsByWorkspace)) {
        // Carry over anything this sync does not own: another key space entirely,
        // or another machine's workspace under the same prefix.
        if (!key.startsWith(keyPrefix) || !args.ownedWorkspaceKeys.has(key)) nextTabs[key] = value;
    }
    const nextActive: Record<string, string> = {};
    for (const [key, value] of Object.entries(args.activeTabByWorkspace)) {
        if (!key.startsWith(keyPrefix) || !args.ownedWorkspaceKeys.has(key)) nextActive[key] = value;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/ui/src/stores/session-sync.backend.test.ts`
Expected: PASS

- [ ] **Step 5: Make the store methods per backend**

`syncWithTasks(backendId, tasks)` and `syncWithProjects(backendId, projects)`
pass `ownedWorkspaceKeys` built from that backend's own records. In
`useSidebarData.ts`, replace the two effects that call them with per-backend
effects driven by `useBackendStore().machines`, and split the single
`connected`-gated bootstrap effect (`:32-52`) into `bootstrapBackend(id)`, which
Task 10 already calls on attach. The master-sessions fetch (`:64-70`) addresses
primary only.

- [ ] **Step 6: Clear session state and timers on detach**

In `session-store.ts`, register a reset dropping `tabsByWorkspace`,
`activeTabByWorkspace` and `sessionStatus` entries for that backend's workspace
keys and session ids.

In `session-activity.ts`, the module maps and their timers (`:12-15`) outlive a
detach: a working-to-attention debounce that fires afterwards calls
`setSessionStatus` for a session that no longer exists, resurrecting a badge and
lighting the tray for a machine that is not attached. Track which backend owns
each session id, then:

```ts
registerBackendReset("session-activity", (backendId) => {
    for (const sessionId of sessionsOwnedBy(backendId)) {
        clearActivityTimer(sessionId);
        clearInteraction(sessionId);
    }
});
```

Register `registerBackendReset("session-store", …)` alongside it.

- [ ] **Step 7: Route the subscription layer**

In `session-subscriptions.ts`, every `onEvent` handler takes the second argument
and writes through the owning backend's state. `MASTER_SESSIONS_LIST` (`:177`)
applies only when its `backendId` is primary — the `"master"` workspace key is a
singleton and belongs to primary alone.

- [ ] **Step 8: Run tests and commit**

Run: `bun test && bun run typecheck`
Expected: PASS

```bash
git add packages/ui/src/stores/session-sync.ts packages/ui/src/stores/session-sync.backend.test.ts packages/ui/src/stores/session-store.ts packages/ui/src/stores/session-subscriptions.ts packages/ui/src/stores/session-activity.ts packages/ui/src/components/sidebar/hooks/useSidebarData.ts
git commit -m "feat(ui): scope session tabs and activity to their backend

syncOwnerTabs rebuilt an entire workspace-key namespace from the owners it was
handed, so a sync for one machine dropped another machine's workspaces and the
live terminals in them. It now rebuilds only the keys it owns.

Activity timers are cleared per backend on detach; a debounce firing after its
machine is gone would otherwise recreate session status and light the tray."
```

---

### Task 14: Per-machine caches

Every module-level value derived from backend data becomes keyed by `backendId`. In the superseded design these were leaks to clean on switch. Here they are correctness: the New Task dialog for a desktop project must offer the desktop's agents and runtimes, and the external-editor menu for a desktop file must offer the desktop's editors.

**Files:**
- Modify: `packages/ui/src/hooks/useAgentAvailability.ts:8-20`
- Modify: `packages/ui/src/hooks/useActiveWorkspace.ts:19-56`
- Modify: `packages/ui/src/lib/open-file.ts:10`
- Modify: `packages/ui/src/components/settings/CodexModelSelect.tsx:16`
- Modify: `packages/ui/src/lib/monaco-import-navigation.ts:9-12`
- Modify: `packages/ui/src/hooks/useConnectivity.ts:32-34`
- Modify: `packages/ui/src/hooks/useRunMenu.ts:92,100`
- Modify: `packages/ui/src/components/panes/terminal/terminal-link-provider.ts:76`
- Create: `packages/ui/src/hooks/useWorkspaceBackend.ts`
- Create: `packages/ui/src/lib/per-backend-cache.ts`
- Create: `packages/ui/src/lib/per-backend-cache.test.ts`

**Interfaces:**
- Consumes: Tasks 10, 11.
- Produces: `createPerBackendCache<T>(fetcher: (backendId: string) => Promise<T>, name: string)` returning `{ get(backendId): Promise<T>; peek(backendId): T | null }`, self-registering its reset; `useWorkspaceBackend(): string | null`.

- [ ] **Step 1: Write the failing cache test**

Create `packages/ui/src/lib/per-backend-cache.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createPerBackendCache } from "./per-backend-cache";
import { resetBackend } from "@/stores/store-reset";

describe("createPerBackendCache", () => {
    test("caches per backend and never serves one machine's value for another", async () => {
        const cache = createPerBackendCache(async (id) => `value-${id}`, "test-cache");
        expect(await cache.get("a")).toBe("value-a");
        expect(await cache.get("b")).toBe("value-b");
    });

    test("in-flight fetches are shared per backend, not globally", async () => {
        let calls = 0;
        const cache = createPerBackendCache(async (id) => {
            calls++;
            return id;
        }, "test-cache-2");
        await Promise.all([cache.get("a"), cache.get("a"), cache.get("b")]);
        expect(calls).toBe(2);
    });

    test("resetting one backend leaves the other cached", async () => {
        const cache = createPerBackendCache(async (id) => `v-${id}`, "test-cache-3");
        await cache.get("a");
        await cache.get("b");
        resetBackend("a");
        expect(cache.peek("a")).toBeNull();
        expect(cache.peek("b")).toBe("v-b");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui/src/lib/per-backend-cache.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the cache helper**

Create `packages/ui/src/lib/per-backend-cache.ts`:

```ts
import { registerBackendReset } from "@/stores/store-reset";

/**
 * A value fetched from one backend and cached against it.
 *
 * A global cache of backend-derived data silently answers with whichever
 * machine replied first, which is how a desktop task ends up offered this
 * laptop's installed agents.
 */
export function createPerBackendCache<T>(
    fetcher: (backendId: string) => Promise<T>,
    name: string,
): { get(backendId: string): Promise<T>; peek(backendId: string): T | null } {
    const values = new Map<string, T>();
    const inFlight = new Map<string, Promise<T>>();

    registerBackendReset(name, (backendId) => {
        values.delete(backendId);
        inFlight.delete(backendId);
    });

    return {
        get(backendId) {
            const cached = values.get(backendId);
            if (cached !== undefined) return Promise.resolve(cached);
            const pending = inFlight.get(backendId);
            if (pending) return pending;
            const promise = fetcher(backendId)
                .then((value) => {
                    values.set(backendId, value);
                    inFlight.delete(backendId);
                    return value;
                })
                .catch((error: unknown) => {
                    inFlight.delete(backendId);
                    throw error;
                });
            inFlight.set(backendId, promise);
            return promise;
        },
        peek(backendId) {
            return values.get(backendId) ?? null;
        },
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/ui/src/lib/per-backend-cache.test.ts`
Expected: PASS

- [ ] **Step 5: Add the workspace backend hook**

Create `packages/ui/src/hooks/useWorkspaceBackend.ts`:

```ts
import { useActiveWorkspace } from "./useActiveWorkspace";
import { useBackendStore } from "@/stores/backend-store";

/**
 * The machine the open workspace belongs to. Master workspace belongs to
 * primary. The single place the pane layer reads its target from — everything
 * outside a workspace (sidebar rows, background work) must carry its own.
 */
export function useWorkspaceBackend(): string | null {
    const workspace = useActiveWorkspace();
    const primaryId = useBackendStore((s) => s.primaryId);
    if (workspace.scope === "master") return primaryId;
    return workspace.project?.backendId ?? null;
}
```

`useActiveWorkspace` returns `Scoped<Project>` and `Scoped<Task>` now, since the
stores hold scoped records; no extra lookup is needed.

- [ ] **Step 6: Convert each cache**

Rewrite the six module caches on `createPerBackendCache`, registering the names
the Task 10 enumeration test requires: `agent-cache`, `homedir-cache`,
`editor-cache`, `codex-model-cache`, `tsconfig-cache`, `run-menu-cache`.
`useAgentAvailability()` becomes `useAgentAvailability(backendId)`;
`useHomedir()` becomes `useHomedir(backendId)`. Delete
`useAgentAvailability.ts`'s `onStatusChange` cache-clearing block — a successful
attach never goes disconnected, so it never fired usefully, and detach now owns
this.

`useConnectivity`'s `initialized` guard becomes a per-backend set, and
connectivity is fetched for primary; register `connectivity`.

`fileStatCache` (`terminal-link-provider.ts:76`) is keyed by absolute path
alone, which collides between two machines holding the same repo. Key it
`${backendId}:${absolutePath}` and register `file-stat-cache`.

- [ ] **Step 7: Verify and commit**

Run: `bun test && bun run typecheck`
Expected: PASS

```bash
git add packages/ui/src/lib/per-backend-cache.ts packages/ui/src/lib/per-backend-cache.test.ts packages/ui/src/hooks/useWorkspaceBackend.ts packages/ui/src/hooks/useAgentAvailability.ts packages/ui/src/hooks/useActiveWorkspace.ts packages/ui/src/lib/open-file.ts packages/ui/src/components/settings/CodexModelSelect.tsx packages/ui/src/lib/monaco-import-navigation.ts packages/ui/src/hooks/useConnectivity.ts packages/ui/src/hooks/useRunMenu.ts packages/ui/src/components/panes/terminal/terminal-link-provider.ts
git commit -m "feat(ui): key backend-derived caches by machine

Agents, homedir, editors, Codex models, the tsconfig map, connectivity, run-menu
scripts and the terminal stat cache were all module globals holding whichever
machine answered first. With more than one attached that is wrong rather than
stale: a desktop task would be offered this laptop's installed agents, and a
desktop file this laptop's editors.

The stat cache was keyed by absolute path alone, which collides outright between
two machines holding the same repository."
```

---
### Task 15: Editor identity across machines

The one place a mistake loses work rather than confusing the UI. Two machines very often hold the same repository at the same absolute path, and the editor identifies files by that path at three levels.

`monaco.Uri.file(filePath)` is the model's identity (`EditorPaneImpl.tsx:106-107`): the pane looks the URI up with `getModel` and reuses whatever it finds. Monaco's model registry is global and keyed by URI, so the desktop's `/Users/you/foo/src/a.ts` and the laptop's are **one model**, sharing text and undo history, whatever the surrounding maps are keyed by. Above that, `dirtyModels` and `viewStates` (`editor-dirty-state.ts:4,7`) and `pendingLines` (`:22`) are path-keyed, and `EditorPaneImpl.tsx:205-207` deliberately keeps a dirty model alive across unmount, skipping the disk read on the next mount (`:109,150`).

Keying only the maps and leaving `Uri.file` alone would look correct and still share one buffer between machines.

**Files:**
- Create: `packages/ui/src/components/panes/editor-uri.ts`
- Create: `packages/ui/src/components/panes/editor-uri.test.ts`
- Modify: `packages/ui/src/components/panes/editor-dirty-state.ts`
- Modify: `packages/ui/src/components/panes/EditorPaneImpl.tsx:106-109`, `:150`, `:178`, `:186`, `:205-207`, `:253`
- Modify: `packages/ui/src/lib/monaco-import-navigation.ts:134`, `:176`, `:191`, `:232`

**Interfaces:**
- Consumes: Task 14's `useWorkspaceBackend`.
- Produces: `modelUriFor(backendId: string, absolutePath: string): monaco.Uri`, `pathFromModelUri(uri: monaco.Uri): string`, `backendFromModelUri(uri: monaco.Uri): string`, `modelKey(backendId: string, absolutePath: string): string`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/components/panes/editor-uri.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { backendFromModelUri, modelUriFor, pathFromModelUri } from "./editor-uri";

describe("editor model URIs", () => {
    test("the same path on two machines produces two distinct URIs", () => {
        const a = modelUriFor("laptop", "/Users/me/repo/src/a.ts");
        const b = modelUriFor("desktop", "/Users/me/repo/src/a.ts");
        expect(a.toString()).not.toBe(b.toString());
    });

    test("round-trips the path, including spaces and unicode", () => {
        const path = "/Users/me/my repo/src/café ☕.ts";
        const uri = modelUriFor("desktop", path);
        expect(pathFromModelUri(uri)).toBe(path);
        expect(backendFromModelUri(uri)).toBe("desktop");
    });

    test("round-trips a Windows-style absolute path", () => {
        const path = "C:\\Users\\me\\repo\\src\\a.ts";
        expect(pathFromModelUri(modelUriFor("desktop", path))).toBe(path);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui/src/components/panes/editor-uri.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the URI helper**

Create `packages/ui/src/components/panes/editor-uri.ts`:

```ts
import * as monaco from "monaco-editor";

/**
 * Monaco's model registry is global and keyed by URI, so a file's identity must
 * include the machine it lives on. Without the authority, the same absolute
 * path on two machines resolves to one model with one buffer and one undo
 * stack, and saving writes the other machine's unsaved text to this machine's
 * file.
 *
 * The path is carried in the fragment rather than the URI path so that no part
 * of it is reinterpreted as URI structure — a Windows drive letter, a `#`, or a
 * `?` in a filename all survive unchanged.
 */
const SCHEME = "taskflow-file";

export function modelUriFor(backendId: string, absolutePath: string): monaco.Uri {
    return monaco.Uri.from({
        scheme: SCHEME,
        authority: backendId,
        path: "/",
        fragment: absolutePath,
    });
}

export function pathFromModelUri(uri: monaco.Uri): string {
    return uri.fragment;
}

export function backendFromModelUri(uri: monaco.Uri): string {
    return uri.authority;
}

/** Key for the dirty, view-state and pending-line maps. Same identity, as a string. */
export function modelKey(backendId: string, absolutePath: string): string {
    return modelUriFor(backendId, absolutePath).toString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/ui/src/components/panes/editor-uri.test.ts`
Expected: PASS

- [ ] **Step 5: Key the editor maps by model identity**

In `editor-dirty-state.ts`, the three maps keep their shapes but every key
becomes `modelKey(backendId, filePath)`. Change each exported function to take a
`backendId` first: `isEditorDirty(backendId, filePath)`,
`clearEditorDirty(backendId, filePath)`, `setPendingLine(backendId, filePath, line)`,
`consumePendingLine(backendId, filePath)`. Add the reset:

```ts
registerBackendReset("editor-models", (backendId) => {
    for (const key of [...dirtyModels.keys()]) {
        if (backendFromModelUri(monaco.Uri.parse(key)) !== backendId) continue;
        dirtyModels.delete(key);
        viewStates.delete(key);
        pendingLines.delete(key);
        monaco.editor.getModel(monaco.Uri.parse(key))?.dispose();
    }
});
```

- [ ] **Step 6: Scope the pane's model**

In `EditorPaneImpl.tsx`, take the backend from `useWorkspaceBackend()` and
replace line 106:

```ts
        const uri = modelUriFor(backendId, filePath);
        const existingModel = monaco.editor.getModel(uri);
        const model = existingModel ?? monaco.editor.createModel("", getLanguage(filePath), uri);
        const isDirty = existingModel != null && isEditorDirty(backendId, filePath);
```

`getLanguage(filePath)` is unchanged: it reads the path, not the URI. Update the
five other `dirtyModels` / `viewStates` sites (`:150`, `:178`, `:186`,
`:205-207`, `:253`) to the new accessors.

- [ ] **Step 7: Follow the URI through import navigation**

In `monaco-import-navigation.ts`, the TypeScript worker's `fileName` values come
from model URIs, so all four sites move together:

- `:134` — build the probe URI with `modelUriFor(backendId, path)`.
- `:176` — `const uri = model.uri;` stays, but anything deriving a filesystem
  path from it uses `pathFromModelUri(uri)`.
- `:191` — `monaco.Uri.file(result.resolvedPath)` becomes
  `modelUriFor(backendFromModelUri(model.uri), result.resolvedPath)`; a
  definition never crosses machines.
- `:232` — `monaco.Uri.parse(def.fileName)` still parses, and
  `pathFromModelUri` recovers the path.

The tsconfig cache from Task 14 is already per backend, so resolution cannot
cross machines either.

- [ ] **Step 8: Route the raw-file fetch**

Replace the `// TODO(remote-projects)` call sites Task 8 left in `rawFileUrl`
consumers with the workspace's backend.

- [ ] **Step 9: Verify and commit**

Run: `bun test && bun run typecheck`
Expected: PASS

```bash
git add packages/ui/src/components/panes/editor-uri.ts packages/ui/src/components/panes/editor-uri.test.ts packages/ui/src/components/panes/editor-dirty-state.ts packages/ui/src/components/panes/EditorPaneImpl.tsx packages/ui/src/lib/monaco-import-navigation.ts
git commit -m "feat(ui): give editor models a per-machine identity

Monaco's model registry is global and keyed by URI, so the same absolute path on
two machines was one model with one buffer and one undo stack. Keying only the
dirty-state maps would have looked correct and still shared the buffer.

Model URIs now carry the backend as their authority and the path as their
fragment, so nothing in a filename can be reinterpreted as URI structure."
```

---

### Task 16: Machine sections in the sidebar

Local projects render exactly as they do today with no header; each attached machine gets a collapsible section below. When nothing else is attached the sidebar is pixel-identical to today.

**Files:**
- Create: `packages/ui/src/components/sidebar/MachineSection.tsx`
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx:316-378`
- Modify: `packages/ui/src/components/sidebar/OfflineIndicator.tsx`
- Create: `packages/ui/src/components/sidebar/MachineSection.test.tsx`

**Interfaces:**
- Consumes: Tasks 10, 11, 12.
- Produces: `MachineSection` taking `{ machine: MachineState; projects: Scoped<Project>[] }`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/components/sidebar/MachineSection.test.tsx` asserting:
an `attached` machine with two projects renders both; an `offline` machine
renders its name, its `TunnelFailure` message and a retry control and **no**
projects; an `incompatible` machine renders "needs update" and no projects; and
a machine whose `isLocal` is true renders no header at all.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui/src/components/sidebar/MachineSection.test.tsx`
Expected: FAIL — the component does not exist.

- [ ] **Step 3: Write the section**

`MachineSection` renders, for a non-local machine, a header with the display
name, the `instanceId` as a badge when the host runs more than one instance, a
state dot, and — when `state` is `offline` — the classified failure message and
a retry button calling `useBackendStore().retry(machine.id)`. Only `attached`
renders the project list; the states map to copy as:

| State | Header shows |
|---|---|
| `attaching` | spinner, "connecting" |
| `attached` | dot, project list below |
| `offline` | failure message, "Retry" |
| `incompatible` | "needs update — this machine is running a different protocol version" |

- [ ] **Step 4: Group the sidebar by machine**

In `TaskSidebar.tsx`, partition `visibleProjects` by `backendId`. Render local's
projects first inside the existing `DndContext` exactly as now, then one
`MachineSection` per non-local machine from `useBackendStore().machines`, each
with its own `DndContext` so drag-reorder cannot cross a section — `PROJECT_REORDER`
is per machine and unchanged. `handleProjectDragEnd` calls
`reorderProjects(backendId, orderedIds)`.

- [ ] **Step 5: Make the offline indicator per backend**

`OfflineIndicator` currently reflects one global connection. It becomes a
banner for the *workspace's* backend, naming the machine: local work must stay
usable while a remote machine is down.

- [ ] **Step 6: Verify and commit**

Run: `bun test && bun run typecheck`
Expected: PASS

```bash
git add packages/ui/src/components/sidebar/MachineSection.tsx packages/ui/src/components/sidebar/MachineSection.test.tsx packages/ui/src/components/sidebar/TaskSidebar.tsx packages/ui/src/components/sidebar/OfflineIndicator.tsx
git commit -m "feat(ui): group remote projects into machine sections

Local projects render unchanged at the top; each attached machine gets a
collapsible section with its own drag context, so project order stays per
machine and matches what that machine's own app shows.

A machine that is offline or running a different protocol version costs one
section, not the app."
```

---

### Task 17: The machines menu and its dialogs

Replaces **Task 11** of the superseded plan. The `Monitor` button (`TaskSidebar.tsx:383-394`) opens it. Attaching and hard-switching must not look alike, or they will be confused for each other.

**Files:**
- Create: `packages/ui/src/components/sidebar/MachinesMenu.tsx`
- Create: `packages/ui/src/components/sidebar/ConnectBackendDialog.tsx`
- Create: `packages/ui/src/components/sidebar/ManageBackendsDialog.tsx`
- Create: `packages/ui/src/components/sidebar/TrustHostKeyDialog.tsx`
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx:383-394`

**Interfaces:**
- Consumes: Tasks 9, 10.
- Produces: `MachinesMenu`, mounted from the sidebar toolbar.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/components/sidebar/MachinesMenu.test.tsx` asserting:
every known machine renders with a checkbox reflecting `attached`; toggling an
unchecked one calls `attach` and a checked one calls `detach`; a discovered but
unsaved machine renders with an add affordance and no checkbox; and "Work as…"
is rendered as a distinct item, not as another checkbox row.

- [ ] **Step 2: Run test to verify it fails, then write the menu**

Run: `bun test packages/ui/src/components/sidebar/MachinesMenu.test.tsx`
Expected: FAIL.

```
Master Workspace                          ✓
──────────────────────────────────
☑ This machine (local)
☑ kuindji-desktop                         ● attached
☐ kuindji-desktop  dev-feature-x          ○ seen
☐ old-laptop                              ○ saved, not seen
──────────────────────────────────
Work as…                                  ▸
Connect to backend…
Manage backends…
```

Opening the menu calls `window.taskflow.listBackends()` and sends a discovery
probe, so the list is fresh rather than up to one announce interval old. The
button's icon shows the aggregate state: normal when everything attached is
healthy, a spinner while any machine is attaching, a destructive tone when an
attached machine is offline. Master Workspace keeps today's accent colour on the
icon; remote-ness is a small corner dot, so the two signals do not compete.

- [ ] **Step 3: Write the dialogs**

`ConnectBackendDialog` takes host, and optional backend port, ssh user and ssh
port, calling `addBackend`. Leaving the port blank resolves it from the port file
over ssh. `ManageBackendsDialog` lists saved records with rename, edit-user,
edit-ssh-port and remove. `TrustHostKeyDialog` mounts off a pending-trust state,
shows host, key type and SHA256 fingerprint from `getHostFingerprint`, and calls
`trustBackendHost` on approval; a **changed** key is never offered a trust
dialog, only ssh's own message and the offending line.

- [ ] **Step 4: Verify and commit**

Run: `bun test && bun run typecheck`
Expected: PASS

```bash
git add packages/ui/src/components/sidebar/MachinesMenu.tsx packages/ui/src/components/sidebar/ConnectBackendDialog.tsx packages/ui/src/components/sidebar/ManageBackendsDialog.tsx packages/ui/src/components/sidebar/TrustHostKeyDialog.tsx packages/ui/src/components/sidebar/MachinesMenu.test.tsx packages/ui/src/components/sidebar/TaskSidebar.tsx
git commit -m "feat(ui): add the machines menu

A checkbox per machine attaches or detaches it live. Hard switching is a
separate, visually distinct entry, because a menu where attaching and switching
look alike will have them confused for each other."
```

---
### Task 18: Routing for sidebar rows and background work

The most dangerous gap in the design if left implicit. "Route from the active workspace" covers panes; it does not cover work started from a sidebar row for a project that is not open.

`ProjectGroup` builds a run menu for **any** project row (`ProjectGroup.tsx:94`), passing only `projectId` and `projectPath`. `useRunMenu` fetches scripts and agent commands with unrouted requests carrying that path (`useRunMenu.ts:92,100`) and can start a shell session or a flow from the result. Unrouted, right-clicking a desktop project lists **this** machine's scripts for the desktop's path and runs one here. If the path does not exist locally it errors, which is survivable. If the same repository is checked out at the same path on both machines — the case this whole feature exists for — it succeeds against the wrong checkout on the wrong machine, with no visible difference.

**Files:**
- Modify: `packages/ui/src/hooks/useRunMenu.ts`
- Modify: `packages/ui/src/components/sidebar/ProjectGroup.tsx:94`
- Modify: `packages/ui/src/components/sidebar/TaskCard.tsx`
- Modify: `packages/ui/src/components/sidebar/hooks/useSidebarData.ts`
- Modify: `packages/ui/src/lib/attribute-api.ts`
- Modify: `packages/ui/src/components/sidebar/NotificationPopover.tsx`
- Create: `packages/ui/src/hooks/useRunMenu.routing.test.ts`

**Interfaces:**
- Consumes: Tasks 11, 12, 14.
- Produces: `useRunMenu({ backendId, projectId, projectPath, … })`; `attribute-api` functions each taking a `backendId` first.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/hooks/useRunMenu.routing.test.ts`. With two fake
backends attached (the `test-ws-server` helper from Task 11), render the run
menu for a project owned by `"b"` and assert that `SCRIPTS_LIST` and
`AGENT_COMMANDS_LIST` arrive at `b`'s server and that `a`'s server received
nothing at all. Asserting the negative is the point: the bug is a request going
to the wrong machine, not a missing one.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui/src/hooks/useRunMenu.routing.test.ts`
Expected: FAIL — both requests arrive at primary, which is `a`.

- [ ] **Step 3: Route the run menu**

`useRunMenu` takes `backendId` and passes it to both `sendRequest` calls and to
`filterByProject` from Task 12. Its script and agent-command caches come from
Task 14's `createPerBackendCache`. Every caller supplies the record's own
`backendId`: `ProjectGroup` from `project.backendId`, `TaskCard` from the task's,
`Workspace` from `useWorkspaceBackend()`.

- [ ] **Step 4: Route the rest of the background work**

None of these has an active workspace to inherit from, so each carries its
target explicitly:

- The worktree/PR refresh in `useSidebarData` — per backend, for each attached machine.
- Notification click-through: the payload carries `backendId` from Task 20, and navigation resolves the project and task within that machine's slice.
- Debounced attribute saves in `lib/attribute-api.ts` — each function takes a `backendId`, supplied by the owning record.
- `MASTER_SESSIONS_LIST` — primary only.

- [ ] **Step 5: Run tests and commit**

Run: `bun test && bun run typecheck`
Expected: PASS

```bash
git add packages/ui/src/hooks/useRunMenu.ts packages/ui/src/hooks/useRunMenu.routing.test.ts packages/ui/src/components/sidebar/ProjectGroup.tsx packages/ui/src/components/sidebar/TaskCard.tsx packages/ui/src/components/sidebar/hooks/useSidebarData.ts packages/ui/src/lib/attribute-api.ts packages/ui/src/components/sidebar/NotificationPopover.tsx
git commit -m "feat(ui): route sidebar row actions to the row's machine

A run menu opened from a project row had no active workspace to inherit a target
from, so it listed this machine's scripts for another machine's path and ran
them here. Where the same repository is checked out at the same path on both
machines that succeeds silently against the wrong checkout.

Every project-row and task-row operation now carries the record's own backend,
as does the background work that runs outside a workspace."
```

---

### Task 19: Primary-only managers, gating, and removing the shim

Settles which surfaces address primary, gates the local-path affordances per target, and deletes the compatibility shim from Task 8 — after which an unrouted call is a compile error.

**Files:**
- Create: `packages/ui/src/hooks/useIsLocalBackend.ts`
- Modify: `packages/ui/src/components/settings/SettingsModal.tsx:149-160`
- Modify: `packages/ui/src/components/flows/FlowManagementDialog.tsx:31,43,49,85-105`
- Modify: `packages/ui/src/components/schedules/ScheduleManagementDialog.tsx`
- Modify: `packages/ui/src/components/settings/appearance/ImportTab.tsx:28`
- Modify: `packages/ui/src/components/sidebar/NewProjectDialog.tsx:46`, `MissingLocationDialog.tsx:40`
- Modify: `packages/ui/src/components/flows/FlowInputDialog.tsx:34`
- Modify: `packages/ui/src/components/workspace/Workspace.tsx:251,391`
- Modify: `packages/ui/src/components/panes/TerminalPane.tsx:457-470`, `:474-486`
- Modify: `packages/ui/src/components/panes/FileContextMenu.tsx:107`
- Delete: `packages/ui/src/hooks/useWebSocket.ts`
- Modify: `packages/ui/src/stores/store-reset.test.ts`

- [ ] **Step 1: Add the gating hook**

Create `packages/ui/src/hooks/useIsLocalBackend.ts`:

```ts
import { useBackendStore } from "@/stores/backend-store";

/**
 * Is this backend this machine? Gates every affordance that assumes the
 * backend's filesystem is the one the native file dialogs see.
 */
export function useIsLocalBackend(backendId: string | null): boolean {
    const machines = useBackendStore((s) => s.machines);
    if (!backendId) return false;
    return machines.some((m) => m.id === backendId && m.isLocal);
}
```

- [ ] **Step 2: Gate the local-path affordances**

Each site is **disabled, visible, with a tooltip naming the machine** — never
hidden. The predicate is `useIsLocalBackend(useWorkspaceBackend())` except where
noted: `selectProjectDirectory`, `selectThemeFile`, `selectFile`,
`openExternalFile`, `showItemInFolder`, `runInShell`, and both native file-drop
paths in `TerminalPane.tsx`. Dropping from Taskflow's own file explorer
(`TerminalPane.tsx:451-456`) stays enabled — those are already backend paths.
`openExternalUrl` stays enabled; it opens URLs, not paths.

- [ ] **Step 3: Gate the data directory on primary, not on the workspace**

`SettingsModal.tsx:150` picks a data directory with the **client's** native
picker and sends it through `SETTINGS_UPDATE_DATA_DIR`
(`settings-store.ts:53`), which makes the backend move its data dir
(`handlers/settings.ts:49,103`). In hard-switch mode primary is remote, so that
hands a laptop path to a desktop backend.

The predicate here is `useIsLocalBackend(primaryId)` — a different question from
the workspace gating above. Disable the whole data-directory section when
primary is remote, with a tooltip saying so.

- [ ] **Step 4: Point the app-level managers at primary**

The settings modal, the appearance tab, the global Flow and Action manager and
the global Schedule view all read and write primary's data. `FlowManagementDialog`
keeps its `all` / `global` filters with no machine dimension and addresses
primary; a new global definition lands on primary. There is deliberately no
machine picker: changing another machine's means hard-switching to it.

Anything opened **from a project or task row** is a different case and already
carries a target from Task 18 — creating a project-scoped flow, action or
schedule on a desktop project creates it on the desktop, where its runner and
scheduler live.

- [ ] **Step 5: Delete the shim**

Delete `packages/ui/src/hooks/useWebSocket.ts` and fix every remaining import.
Each one is a call site that was never routed; resolve it with the record's own
backend or the workspace's, never with `getPrimary()` unless the surface is an
app-level manager.

Run: `bun run typecheck`
Expected: no errors. A remaining unrouted call cannot compile, which is the point
of the deletion.

- [ ] **Step 6: Turn on the enumeration test**

In `store-reset.test.ts`, change the third case from `test.todo` to `test`.

Run: `bun test packages/ui/src/stores/store-reset.test.ts`
Expected: PASS. A failure names the store that holds per-backend state without
registering a reset.

- [ ] **Step 7: Verify and commit**

Run: `bun test && bun run typecheck`
Expected: PASS

```bash
git add -A packages/ui/src
git commit -m "feat(ui): gate local-path affordances per target and drop the shim

Affordances that assume the backend's filesystem is this one are disabled per
workspace machine. The data directory is gated on primary instead, because its
picker is client-side and in hard-switch mode primary is remote.

App-level managers address primary and have no machine picker. Deleting the
compatibility shim makes any remaining unrouted call a compile error."
```

---

### Task 20: Electron main across several backends

**Files:**
- Modify: `electron/src/notification-poller.ts:9`, `:27`, `:54-59`
- Modify: `electron/src/tray-manager.ts:161`, `:186`
- Modify: `electron/src/ipc-handlers.ts:115`
- Modify: `packages/backend/src/api/routes/flow-routes.ts`
- Create: `electron/src/notification-poller.test.ts`

- [ ] **Step 1: Write the failing watermark test**

Create `electron/src/notification-poller.test.ts` asserting the sequence that
loses a notification today: backend B emits at `10:00:01`; backend A emits at
`10:00:10`; B emits at `10:00:05`. With one shared watermark the third is never
delivered. Assert all three reach the notifier, and that each carries its
originating `backendId`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test electron/src/notification-poller.test.ts`
Expected: FAIL — `lastNotificationCheck` (`notification-poller.ts:9`) is a single
string shared by every origin.

- [ ] **Step 3: Give each backend its own watermark**

Replace the singleton with `Map<string, string>`, advanced only by that backend's
own responses, and poll every attached origin rather than one. Add `backendId` to
the `notification-clicked` payload (`:54-59`) — `projectId`, `sessionId` and
`taskId` no longer say which machine to navigate on.

- [ ] **Step 4: Aggregate the tray**

`tray-manager.ts:161,186` polls every attached origin and merges the results.
`window-manager.ts:29,132` stays on local, unchanged: window geometry is a
property of this screen, and routing it to whichever machine is primary would
have a laptop's window position overwrite a desktop's.

- [ ] **Step 5: Serve flow artifacts over the owning backend**

`saveArtifact` (`ipc-handlers.ts:115`) `copyFile`s a backend-supplied absolute
path using the **client's** filesystem, which with a remote backend either fails
or copies an unrelated local file that happens to share the path.

It cannot move to `/api/file/raw`: that endpoint requires the resolved path to
sit inside a known project or worktree root
(`packages/backend/src/utils/path-validation.ts:50`), while a flow artifact's
path is an arbitrary string an agent handed the CLI
(`packages/backend/src/services/taskflow-cli-bin.ts:565`). An artifact written to
`/tmp` would start returning 403 — a regression for local use.

Add `GET /api/flow/artifact/:ownerId/:flowId/:type/raw` to
`flow-routes.ts`, following the shape of the artifact routes already there. It
looks the artifact up in the run record and serves the bytes at the path **it**
recorded; the authorisation is "this path was registered as an artifact of this
run", not "this path is inside a workspace". The client fetches it from the
owning backend's origin and the save dialog stays on the client, because that is
where the file is going. Local and remote take the same path, so there is no
branch that only runs on one of them.

- [ ] **Step 6: Verify and commit**

Run: `bun test && bun run typecheck`
Expected: PASS

```bash
git add electron/src/notification-poller.ts electron/src/notification-poller.test.ts electron/src/tray-manager.ts electron/src/ipc-handlers.ts packages/backend/src/api/routes/flow-routes.ts
git commit -m "feat: poll notifications and serve artifacts per backend

One shared watermark dropped a machine's notification whenever a newer one
arrived from another machine, and click payloads did not say which machine to
navigate on.

Flow artifacts get their own endpoint, authorised by 'this path was registered
as an artifact of this run' rather than by workspace containment, because an
artifact path is arbitrary and may sit outside any project root."
```

---

### Task 21: The hard switch

Replaces **Task 10** of the superseded plan. The ordering matters and the obvious ordering is wrong: "validate the target, detach everything, attach the target" destroys the current set before the target is usable, and if the target was **already attached** — the common case, since you would switch to a machine you are already looking at — the detach kills the connection that was just validated.

**Files:**
- Modify: `packages/ui/src/stores/backend-store.ts`
- Modify: `packages/ui/src/components/AppShell.tsx`
- Modify: `packages/ui/src/components/sidebar/MachinesMenu.tsx`
- Create: `packages/ui/src/stores/hard-switch.test.ts`

**Interfaces:**
- Consumes: Tasks 10, 15.
- Produces: `useBackendStore.workAs(id): Promise<{ ok: true } | { ok: false; reason: "dirty"; files: string[] } | { ok: false; reason: "unreachable"; failure: TunnelFailure }>` and `returnToLocal()`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/stores/hard-switch.test.ts` covering the three target
states plus the dirty refusal:

- Target **already attached**: after `workAs("b")`, `b`'s connection is the same
  object it was before — it must not have been torn down and rebuilt — and `a` is
  detached.
- Target **not attached**: `workAs("b")` attaches it, then detaches `a`.
- Target **dies after validation**: the attach succeeds and the handshake then
  fails; the attached set is unchanged and `a` is still connected.
- A **dirty editor** refuses the switch, returns the file list, and leaves every
  connection intact.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui/src/stores/hard-switch.test.ts`
Expected: FAIL — `workAs` does not exist.

- [ ] **Step 3: Implement the switch**

```ts
    async workAs(id) {
        // 1. Local is about to be detached, so this is the one place unsaved
        //    work can be lost. In aggregate mode nothing refuses anything,
        //    because models are keyed per machine.
        const dirty = dirtyFilePaths();
        if (dirty.length > 0) return { ok: false, reason: "dirty", files: dirty };

        // 2. Prepare the target first and never tear it down. Reuse it as-is if
        //    it is already attached, which is the likely case.
        const already = get().machines.find((m) => m.id === id && m.state === "attached");
        if (!already) {
            await get().attach(id);
            const after = get().machines.find((m) => m.id === id);
            if (after?.state !== "attached") {
                return { ok: false, reason: "unreachable", failure: unknownFailure("Target did not attach") };
            }
        }

        // 3. Detach everything EXCEPT the target.
        for (const machine of get().machines) {
            if (machine.id === id) continue;
            closeConnection(machine.id, "switch");
            resetBackend(machine.id);
            await window.taskflow!.detachBackend(machine.id);
        }

        // 4. Promote, then 5. remount.
        setPrimaryBackend(id);
        bumpShellKey();
        return { ok: true };
    },
```

Nothing is destroyed until the target is already usable as primary, which is the
non-destructive property the superseded design had.

- [ ] **Step 4: Remount the shell on a primary change**

`AppShell` takes a `key` from a counter in `backend-store`. The remount is not
insurance against a leaky detach — aggregate mode has no remount and detach must
be complete on its own. It is here because primary changing means theme, master
workspace, settings and connectivity all re-root.

- [ ] **Step 5: Show the mode**

While hard-switched, a persistent toolbar indicator names the machine and offers
"Return to local", which is `workAs("local")`. A mode you can enter and forget is
a bad mode.

- [ ] **Step 6: Verify and commit**

Run: `bun test && bun run typecheck`
Expected: PASS

```bash
git add packages/ui/src/stores/backend-store.ts packages/ui/src/stores/hard-switch.test.ts packages/ui/src/components/AppShell.tsx packages/ui/src/components/sidebar/MachinesMenu.tsx
git commit -m "feat(ui): add the hard switch

The target is prepared and validated first and is never torn down, so switching
to a machine that is already attached does not kill the connection that was just
proved healthy, and a failure leaves the attached set untouched.

A dirty editor refuses the switch, because local is detached too and unsaved
local buffers would go with it."
```

---

### Task 22: End-to-end verification on two machines

Replaces **Task 14** of the superseded plan, most of which verifies single-active-backend switching. Nothing here is automated; it needs two machines on one network and a person.

- [ ] **Step 1: Attach and see**

With Taskflow running on both machines, open the machines menu on the laptop,
check the desktop, and confirm its projects appear in their own section in the
laptop's own project order, with diff badges and behind counts on its rows.

- [ ] **Step 2: Work remotely**

Open a desktop task from the laptop. Confirm the New Task dialog offers the
**desktop's** agents and default model, that a session starts on the desktop,
that its terminal streams, and that the file explorer and editor show the
desktop's files.

- [ ] **Step 3: Two clients, one backend**

With the desktop's own app open on the same project, confirm both see file
changes. Then detach the desktop from the laptop and confirm the desktop's own
app **still** sees file changes — the Task 2 regression.

- [ ] **Step 4: Duplicate checkout**

With the same repo at the same absolute path on both machines, open the same
file from both, type in one without saving, and confirm the other shows the file
from disk. Then right-click the desktop project row, run a package script, and
confirm it runs on the desktop.

- [ ] **Step 5: Sleep, wake, drop**

Sleep the desktop. Confirm its section goes offline with a named reason, local
work continues, and the app does not hang. Wake it and confirm the beacon
reappearing reattaches it without a manual retry.

- [ ] **Step 6: Aliases**

Attach the desktop by hostname, then attempt to add it again by IP. Confirm one
machine in the menu, one section in the sidebar, and no duplicated projects.

- [ ] **Step 7: Notifications**

Start a long agent run on the desktop, work locally, and confirm its completion
notification arrives badged with the desktop and clicking it navigates there.

- [ ] **Step 8: Hard switch**

"Work as…" the desktop with a dirty editor open and confirm the refusal names
the file. Save, switch, and confirm the desktop's theme, settings and master
workspace. Return to local.

- [ ] **Step 9: Quit**

Quit with the desktop attached. Confirm the ssh child is gone
(`pgrep -fl 'ssh -N -L'`) and that the desktop's sessions kept running.

- [ ] **Step 10: Record what was checked**

Write the results into the handoff document, including anything deferred.

---

## Notes for the executor

**The uncommitted repro.** `packages/ui/src/stores/aggregate-prune.repro.test.ts`
demonstrates the Task 13 pruning hazard on pre-change code. Delete it when Task
13 lands; `session-sync.backend.test.ts` replaces it and asserts the fixed
behaviour instead.

**Order matters in three places.** Task 2 before Task 10, or detach breaks the
other client's file watches. Task 8 before any store task, since they all need
routed requests. Task 15 before anyone opens the same path on two machines.

**Two things this plan cannot settle on paper**, carried from the spec: whether
per-backend detach is genuinely clean without a remount (the enumeration test
proves every store is *registered*, never that any reset is *complete*), and
whether several simultaneous ssh tunnels plus multicast behave on a real flaky
Wi-Fi link. If detach leaks, the fallback is narrow — Task 21 already implements
detach-all-plus-remount, so a leaky aggregate detach degrades to forcing a
remount without new machinery.
