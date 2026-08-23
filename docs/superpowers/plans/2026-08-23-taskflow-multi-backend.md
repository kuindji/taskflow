# Multi-Backend Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Taskflow desktop client connect to Taskflow backends running on other machines, switching between them from a dropdown in the sidebar's bottom-left corner.

**Architecture:** Every backend advertises itself on the LAN with a UDP multicast beacon. Electron main listens, keeps a registry of known backends, and opens an app-managed SSH tunnel to whichever one the user picks. Exactly one backend is connected at a time: the renderer opens a second socket, verifies protocol compatibility, and only then promotes it, resets all client state and remounts the shell.

**Tech Stack:** Bun, TypeScript, React 19, zustand, Electron, `node:dgram`, OpenSSH. Tests are `bun test` (`bun:test` API).

**Spec:** `docs/superpowers/specs/2026-08-23-taskflow-multi-backend-design.md`

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
- `PROTOCOL_VERSION` starts at `1`. Equal connects; anything else refuses.
- Backend binds `127.0.0.1` from Task 1 onward. Nothing in this plan may reintroduce a routable bind.

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `packages/shared/src/types/backend.ts` | `BeaconAnnounce`, `BeaconProbe`, `DiscoveredBackend`, `BackendRecord`, `TunnelFailure` |
| `packages/shared/src/discovery/beacon.ts` | Pure datagram codec and staleness. No I/O |
| `packages/shared/src/discovery/socket.ts` | Advertiser and listener over `node:dgram` |
| `packages/shared/src/discovery/index.ts` | Barrel for the `./discovery` package export |
| `electron/src/backend-records.ts` | Pure record list operations. No Electron, no fs |
| `electron/src/backend-registry.ts` | Persistence of records + active id; discovery listener |
| `electron/src/tunnel-args.ts` | Pure `buildTunnelArgs` and `classifyTunnelFailure` |
| `electron/src/tunnel-manager.ts` | Spawns and supervises `ssh`; readiness probe; known_hosts |
| `packages/ui/src/stores/store-reset.ts` | Registry of reset callbacks |
| `packages/ui/src/stores/backend-store.ts` | Renderer mirror of the registry; orchestrates the switch |
| `packages/ui/src/hooks/useBackendIsLocal.ts` | One hook the gating sites read |
| `packages/ui/src/components/sidebar/BackendMenu.tsx` | The dropdown |
| `packages/ui/src/components/sidebar/ConnectBackendDialog.tsx` | Manual host entry |
| `packages/ui/src/components/sidebar/ManageBackendsDialog.tsx` | Rename / edit / remove |

**Modified files**

| Path | Change |
|---|---|
| `packages/backend/src/ws/server.ts` | Bind `127.0.0.1` |
| `packages/backend/src/config.ts` | Add `instancePortFile`; reduce `instanceId` to one safe label |
| `packages/backend/src/index.ts` | Write/remove the instance port file; `protocolVersion` on `SYSTEM_INFO`; start the advertiser |
| `packages/shared/src/constants.ts` | `PROTOCOL_VERSION`, discovery constants |
| `packages/backend/src/handlers/settings.ts` | Notify on settings update, so the beacon follows the setting |
| `packages/ui/src/components/settings/sections/GeneralSection.tsx` | Discoverable switch and network name |
| `packages/shared/src/types/system.ts` | `protocolVersion` on `SystemInfo` |
| `packages/shared/src/types/settings.ts` | `NetworkSettings` |
| `packages/backend/src/services/settings-store.ts` | `network` defaults and merge |
| `packages/shared/package.json` | `exports` map with `.` and `./discovery` |
| `electron/package.json` | Depend on `@taskflow/shared` |
| `electron/src/main.ts` | Wire registry and tunnel manager |
| `electron/src/ipc-handlers.ts` | Backend IPC channels; `saveArtifact` rework |
| `electron/src/preload.ts`, `packages/ui/src/env.d.ts` | Bridge the new channels |
| `electron/src/notification-poller.ts`, `electron/src/tray-manager.ts` | Use the active origin |
| `packages/ui/src/hooks/useWebSocket.ts` | Generations, pending socket, `connectTo` |
| `packages/ui/src/lib/backend-url.ts` | Origin instead of port |
| `packages/ui/src/providers/WebSocketProvider.tsx` | Connect through the registry |
| `packages/ui/src/components/sidebar/TaskSidebar.tsx` | Replace the `Monitor` button |
| `packages/backend/src/api/routes/flow-routes.ts` | `/:type/raw` artifact bytes |

---

### Task 1: Backend prerequisites — loopback bind, protocol version, stable port file

Nothing else in this plan is safe until the backend stops listening on every interface. This task also adds the two values discovery and the handshake depend on.

**Files:**
- Modify: `packages/backend/src/ws/server.ts:41-43`
- Modify: `packages/backend/src/config.ts:69-79`
- Modify: `packages/backend/src/index.ts:470` and the `shutdown` handler at `packages/backend/src/index.ts:499`
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/types/system.ts:15-18`
- Modify: `packages/backend/src/index.ts:416`
- Test: `packages/backend/tests/ws/server-bind.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PROTOCOL_VERSION: number` exported from `@taskflow/shared`; `config.instancePortFile: string`; `SystemInfo.protocolVersion: number`.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/ws/server-bind.test.ts`:

```ts
import { afterEach, describe, expect, it } from "bun:test";
import { Router } from "../../src/ws/router";
import { createServer } from "../../src/ws/server";

let stop: (() => void) | null = null;

afterEach(() => {
    stop?.();
    stop = null;
});

describe("createServer", () => {
    it("binds loopback only, so the LAN cannot reach the backend", async () => {
        const started = await createServer(new Router(), 0).start();
        stop = started.stop;

        const loopback = await fetch(`http://127.0.0.1:${started.port}/`);
        expect(await loopback.text()).toBe("Taskflow backend");

        // A non-loopback local address must refuse the connection.
        const { networkInterfaces } = await import("os");
        const external = Object.values(networkInterfaces())
            .flatMap((entries) => entries ?? [])
            .find((entry) => entry.family === "IPv4" && !entry.internal);
        if (!external) return; // No LAN interface on this machine; nothing to assert.

        await expect(fetch(`http://${external.address}:${started.port}/`)).rejects.toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/backend/tests/ws/server-bind.test.ts`
Expected: FAIL — the fetch to the external address succeeds instead of rejecting.

- [ ] **Step 3: Bind loopback**

In `packages/backend/src/ws/server.ts`, add `hostname` to the `Bun.serve` call:

```ts
        server = Bun.serve({
            port,
            hostname: "127.0.0.1",
            async fetch(req, server) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/backend/tests/ws/server-bind.test.ts`
Expected: PASS

- [ ] **Step 5: Add the protocol version constant**

At the top of `packages/shared/src/constants.ts`, above `export const MSG = {`:

```ts
/**
 * Bumped only when a protocol change is NOT backward compatible. Clients refuse
 * to connect to a backend reporting a different value, so a bump breaks
 * cross-machine connections until both sides update. Do not bump for additive
 * changes.
 */
export const PROTOCOL_VERSION = 1;
```

- [ ] **Step 6: Report it from SYSTEM_INFO**

In `packages/shared/src/types/system.ts`, extend the interface:

```ts
export interface SystemInfo {
    editors: EditorInfo[];
    homedir: string;
    /** Absent on a backend older than the multi-backend feature. Treat as incompatible. */
    protocolVersion?: number;
}
```

In `packages/backend/src/index.ts`, change the `SYSTEM_INFO` registration at line 416:

```ts
        router.register(MSG.SYSTEM_INFO, async () => ({
            editors,
            homedir: homedir(),
            protocolVersion: PROTOCOL_VERSION,
        }));
```

Add `PROTOCOL_VERSION` to the existing `@taskflow/shared` import in that file.

- [ ] **Step 7: Constrain the instance id at its source**

`instanceId` is about to become three things at once: a filename, a value
announced on the network, and part of a command run over ssh on another machine.
Task 2's codec refuses a label outside `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, and
today's derivation can produce one that fails it — `TASKFLOW_DEV_BRANCH` is
taken verbatim (`config.ts:45-47`) and the git fallback only replaces `/`
(`config.ts:55-56`), so `dev-feature/x`, `dev-JIRA-9@thing` or an 80-character
branch all get through. A backend whose id the codec rejects is silently
undiscoverable: it announces, every listener drops the datagram, and nothing
logs anything.

Constrain it once, here, rather than sanitising differently in each consumer —
the port file name, the beacon and the ssh path have to agree exactly or the
manual-connect fallback reads a file that does not exist.

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
branch name contained something outside the set gets a new `instanceId`, and
`buildDataPaths(initialDataDir, instanceId)` (`config.ts:74`) therefore points it
at a new data directory. That is a dev sandbox moving, not user data — but say
so in the commit message.

- [ ] **Step 8: Add the stable instance port file**

In `packages/backend/src/config.ts`, inside the `config` object next to `portFile`:

```ts
    portFile: process.env.TASKFLOW_PORT_FILE ?? join(tmpdir(), `.taskflow-port-${process.pid}`),
    /** Stable, spawner-independent port file. Read over ssh when multicast is unavailable. */
    instancePortFile: join(BASE_DIR, `${instanceId}.port`),
```

`instanceId` is declared at `config.ts:67`, above the `config` object, so this resolves.

In `packages/backend/src/index.ts`, immediately after the existing `writeFile(config.portFile, ...)` at line 470:

```ts
        await writeFile(config.instancePortFile, String(startedServer.port));
```

In the `shutdown` handler (line 499), before the process exits, add:

```ts
            await rm(config.instancePortFile, { force: true });
```

Import `rm` from `fs/promises` alongside the existing `writeFile` import.

- [ ] **Step 9: Verify the whole suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add packages/backend/src/ws/server.ts packages/backend/src/config.ts packages/backend/src/index.ts packages/shared/src/constants.ts packages/shared/src/types/system.ts packages/backend/tests/ws/server-bind.test.ts
git commit -m "feat(backend): bind loopback, report protocol version, write a stable port file

The instance id is now reduced to [A-Za-z0-9._-], capped at 64 characters, so it
is safe as a filename, as a beacon field and inside a command run over ssh. A dev
instance whose branch name contained anything outside that set moves to a new
data directory.""
```

---

### Task 2: Shared discovery types and the pure beacon codec

The codec is pure so it can be tested without a network, and so a malformed datagram from anywhere on the LAN cannot crash either side.

**Files:**
- Create: `packages/shared/src/types/backend.ts`
- Create: `packages/shared/src/discovery/beacon.ts`
- Create: `packages/shared/src/discovery/beacon.test.ts`
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `PROTOCOL_VERSION` from Task 1.
- Produces: `encodeAnnounce(a: BeaconAnnounce): Uint8Array`, `encodeProbe(): Uint8Array`, `parseDatagram(bytes: Uint8Array): BeaconAnnounce | BeaconProbe | null`, `isStale(lastSeenAt: number, now: number): boolean`, `isSafeLabel(value: string): boolean`, `backendIdFor(hostname: string, instanceId: string): string`, and the types in `types/backend.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/discovery/beacon.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION } from "../constants";
import type { BeaconAnnounce } from "../types/backend";
import { backendIdFor, encodeAnnounce, encodeProbe, isStale, parseDatagram } from "./beacon";

const announce: BeaconAnnounce = {
    v: 1,
    protocolVersion: PROTOCOL_VERSION,
    instanceId: "main",
    hostname: "desktop",
    displayName: "desktop",
    port: 54892,
    appVersion: "0.14.0",
    os: "darwin",
};

describe("parseDatagram", () => {
    test("round-trips an announcement", () => {
        expect(parseDatagram(encodeAnnounce(announce))).toEqual(announce);
    });

    test("round-trips a probe", () => {
        expect(parseDatagram(encodeProbe())).toEqual({ v: 1, probe: true });
    });

    test("returns null for a truncated datagram", () => {
        const bytes = encodeAnnounce(announce).slice(0, 12);
        expect(parseDatagram(bytes)).toBeNull();
    });

    test("returns null for a future protocol envelope", () => {
        const bytes = new TextEncoder().encode(JSON.stringify({ ...announce, v: 2 }));
        expect(parseDatagram(bytes)).toBeNull();
    });

    test("returns null when a required field has the wrong type", () => {
        const bytes = new TextEncoder().encode(JSON.stringify({ ...announce, port: "54892" }));
        expect(parseDatagram(bytes)).toBeNull();
    });

    test("returns null for an instanceId that is not a plain identifier", () => {
        // `instanceId` reaches a remote shell in Task 6's port lookup and is
        // part of the persisted record id. Anyone on the LAN can send one, so
        // the codec is where the character set is decided.
        for (const instanceId of ["main; rm -rf ~", "a b", "../../etc", "$(id)", ""]) {
            const bytes = new TextEncoder().encode(JSON.stringify({ ...announce, instanceId }));
            expect(parseDatagram(bytes)).toBeNull();
        }
    });

    test("returns null for a hostname that is not a plain hostname", () => {
        const bytes = new TextEncoder().encode(
            JSON.stringify({ ...announce, hostname: "desk top;rm" }),
        );
        expect(parseDatagram(bytes)).toBeNull();
    });

    test("returns null for a datagram larger than the cap", () => {
        const bytes = new TextEncoder().encode(
            JSON.stringify({ ...announce, displayName: "x".repeat(2000) }),
        );
        expect(parseDatagram(bytes)).toBeNull();
    });
});

describe("isStale", () => {
    test("is false inside the window and true outside it", () => {
        expect(isStale(1_000, 15_999)).toBe(false);
        expect(isStale(1_000, 16_001)).toBe(true);
    });
});

describe("backendIdFor", () => {
    test("separates instances on one host", () => {
        expect(backendIdFor("desktop", "main")).not.toBe(backendIdFor("desktop", "dev-x"));
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/shared/src/discovery/beacon.test.ts`
Expected: FAIL — `Cannot find module './beacon'`.

- [ ] **Step 3: Add the discovery constants**

In `packages/shared/src/constants.ts`, below `PROTOCOL_VERSION`:

```ts
/** LAN discovery. TTL 1 keeps announcements on the local subnet. */
export const DISCOVERY_GROUP = "239.255.42.98";
export const DISCOVERY_PORT = 47654;
export const DISCOVERY_TTL = 1;
export const ANNOUNCE_INTERVAL_MS = 5_000;
export const DISCOVERY_STALE_AFTER_MS = 15_000;
/** Datagrams larger than this are rejected without parsing. */
export const DISCOVERY_MAX_DATAGRAM_BYTES = 1_024;
```

- [ ] **Step 4: Add the types**

Create `packages/shared/src/types/backend.ts`:

```ts
/** One backend announcing itself on the local network. */
export interface BeaconAnnounce {
    v: 1;
    protocolVersion: number;
    instanceId: string;
    hostname: string;
    displayName: string;
    port: number;
    appVersion: string;
    os: string;
}

/** Sent by a client to ask every backend to announce immediately. */
export interface BeaconProbe {
    v: 1;
    probe: true;
}

/** An announcement plus what the receiver knows about it. */
export interface DiscoveredBackend extends BeaconAnnounce {
    /** Source address of the datagram, which is what we ssh to. */
    address: string;
    lastSeenAt: number;
}

/** A backend the user has connected to or added by hand. Persisted by Electron main. */
export interface BackendRecord {
    /** `${host}:${instanceId}` — stable across restarts, unlike the port. */
    id: string;
    host: string;
    instanceId: string;
    displayName: string;
    /** SSH login user. Defaults to the local username at add time. */
    user: string;
    sshPort: number;
    /** The backend's own port, refreshed from the beacon. Null until first resolved. */
    lastKnownPort: number | null;
    addedAt: string;
}

export type TunnelFailureKind =
    | "unknown-host-key"
    | "changed-host-key"
    | "auth-refused"
    | "no-route"
    | "local-bind-failed"
    | "no-backend"
    | "no-ssh-binary"
    | "unknown";

export interface TunnelFailure {
    kind: TunnelFailureKind;
    /** Shown to the user. */
    message: string;
    /** Always retained, whatever the classification, so a misclassification stays diagnosable. */
    stderr: string;
}

/**
 * What the backend menu renders. Built in Electron main, sent over IPC, read by
 * the renderer, so it lives here rather than in either process.
 * `local` carries no record — it is always this machine.
 */
export type MenuEntry =
    | { kind: "local" }
    | { kind: "live"; record: BackendRecord; protocolVersion: number }
    | { kind: "unseen"; record: BackendRecord };
```

- [ ] **Step 5: Write the codec**

Create `packages/shared/src/discovery/beacon.ts`:

```ts
import { DISCOVERY_MAX_DATAGRAM_BYTES, DISCOVERY_STALE_AFTER_MS } from "../constants";
import type { BeaconAnnounce, BeaconProbe } from "../types/backend";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function backendIdFor(hostname: string, instanceId: string): string {
    return `${hostname}:${instanceId}`;
}

function encodeAnnounce(announce: BeaconAnnounce): Uint8Array {
    return encoder.encode(JSON.stringify(announce));
}

function encodeProbe(): Uint8Array {
    const probe: BeaconProbe = { v: 1, probe: true };
    return encoder.encode(JSON.stringify(probe));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * `instanceId` and `hostname` are the two announced strings that leave the
 * codec: they form the record id, and `instanceId` is interpolated into a
 * command run over ssh on the remote machine (Task 6). Anything outside this
 * character set is refused here rather than quoted later, because there is one
 * parser and many consumers.
 */
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function isSafeLabel(value: string): boolean {
    return SAFE_LABEL.test(value);
}

/**
 * Anything on the LAN can send us bytes, so every field is checked and any
 * surprise returns null rather than throwing.
 */
function parseDatagram(bytes: Uint8Array): BeaconAnnounce | BeaconProbe | null {
    if (bytes.byteLength > DISCOVERY_MAX_DATAGRAM_BYTES) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(decoder.decode(bytes));
    } catch {
        return null;
    }
    if (!isRecord(parsed) || parsed.v !== 1) return null;

    if (parsed.probe === true) return { v: 1, probe: true };

    const { protocolVersion, instanceId, hostname, displayName, port, appVersion, os } = parsed;
    if (typeof protocolVersion !== "number") return null;
    if (typeof instanceId !== "string" || !SAFE_LABEL.test(instanceId)) return null;
    if (typeof hostname !== "string" || !SAFE_LABEL.test(hostname)) return null;
    if (typeof displayName !== "string" || displayName.length === 0) return null;
    if (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > 65535) {
        return null;
    }
    if (typeof appVersion !== "string") return null;
    if (typeof os !== "string") return null;

    return {
        v: 1,
        protocolVersion,
        instanceId,
        hostname,
        displayName,
        port,
        appVersion,
        os,
    };
}

function isStale(lastSeenAt: number, now: number): boolean {
    return now - lastSeenAt > DISCOVERY_STALE_AFTER_MS;
}

export { backendIdFor, encodeAnnounce, encodeProbe, isSafeLabel, isStale, parseDatagram };
```

- [ ] **Step 6: Export the types from the barrel**

In `packages/shared/src/index.ts`, add alongside the other type exports:

```ts
export * from "./types/backend";
```

Do **not** export anything from `./discovery` here. `beacon.ts` is pure and would be safe, but `socket.ts` (Task 3) imports `node:dgram` and the barrel is bundled into the browser.

- [ ] **Step 7: Run test to verify it passes**

Run: `bun test packages/shared/src/discovery/beacon.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types/backend.ts packages/shared/src/discovery packages/shared/src/constants.ts packages/shared/src/index.ts
git commit -m "feat(shared): add backend discovery types and beacon codec"
```

---

### Task 3: The advertiser and listener, and the backend that runs one

The socket layer is where multicast's platform quirks live: one membership per interface, `reuseAddr` so a dev and a production backend can share the port, and a join failure on one interface that must not take down the others.

**Files:**
- Create: `packages/shared/src/discovery/socket.ts`
- Create: `packages/shared/src/discovery/index.ts`
- Create: `packages/shared/src/discovery/socket.test.ts`
- Modify: `packages/shared/package.json`
- Modify: `packages/shared/src/types/settings.ts`
- Modify: `packages/backend/src/services/settings-store.ts:95` and `:118` and `:278`
- Modify: `packages/backend/src/handlers/settings.ts:16-19,36-39`
- Modify: `packages/backend/src/index.ts`
- Modify: `packages/ui/src/components/settings/sections/GeneralSection.tsx`
- Modify: `packages/ui/src/components/settings/SettingsModal.tsx:454-464`

**Interfaces:**
- Consumes: the codec from Task 2.
- Produces: `createAdvertiser(opts: { payload: () => BeaconAnnounce }): DiscoveryHandle`, `createListener(opts: { onChange: (entries: DiscoveredBackend[]) => void }): DiscoveryListener`, where `DiscoveryHandle = { start(): Promise<void>; stop(): void }` (both idempotent) and `DiscoveryListener = DiscoveryHandle & { probe(): void; entries(): DiscoveredBackend[] }`. Also `AppSettings.network: NetworkSettings` with `discoverable: boolean` and `displayName: string`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/discovery/socket.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { networkInterfaces } from "node:os";
import { PROTOCOL_VERSION } from "../constants";
import type { BeaconAnnounce } from "../types/backend";
import { createAdvertiser, createListener } from "./socket";

const stops: Array<() => void> = [];

afterEach(() => {
    while (stops.length > 0) stops.pop()?.();
});

function announce(port: number): BeaconAnnounce {
    return {
        v: 1,
        protocolVersion: PROTOCOL_VERSION,
        instanceId: "main",
        hostname: "test-host",
        displayName: "test-host",
        port,
        appVersion: "0.0.0",
        os: process.platform,
    };
}

/**
 * Multicast needs a real interface. On a machine with none — a CI container, a
 * laptop with the network off — the test is skipped rather than left to time
 * out, which reads as a failure and tells you nothing.
 */
const hasLan = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .some((entry) => entry.family === "IPv4" && !entry.internal);

function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const tick = () => {
            if (predicate()) return resolve();
            if (Date.now() - startedAt > timeoutMs) return reject(new Error("timed out"));
            setTimeout(tick, 25);
        };
        tick();
    });
}

describe("discovery over the loopback multicast group", () => {
    test.skipIf(!hasLan)("a listener sees an advertiser and can force an announcement with a probe", async () => {
        const listener = createListener({ onChange: () => {} });
        stops.push(() => listener.stop());
        await listener.start();

        const advertiser = createAdvertiser({ payload: () => announce(54892) });
        stops.push(() => advertiser.stop());
        await advertiser.start();

        listener.probe();
        await waitFor(() => listener.entries().some((e) => e.port === 54892));

        const entry = listener.entries().find((e) => e.port === 54892);
        expect(entry?.instanceId).toBe("main");
        expect(entry?.address.length).toBeGreaterThan(0);
    });

    test.skipIf(!hasLan)("stopping the advertiser stops new announcements", async () => {
        const listener = createListener({ onChange: () => {} });
        stops.push(() => listener.stop());
        await listener.start();

        const advertiser = createAdvertiser({ payload: () => announce(54893) });
        await advertiser.start();
        listener.probe();
        await waitFor(() => listener.entries().some((e) => e.port === 54893));

        advertiser.stop();
        const seenAt = listener.entries().find((e) => e.port === 54893)?.lastSeenAt ?? 0;
        listener.probe();
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(listener.entries().find((e) => e.port === 54893)?.lastSeenAt).toBe(seenAt);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/shared/src/discovery/socket.test.ts`
Expected: FAIL — `Cannot find module './socket'`.

- [ ] **Step 3: Write the socket layer**

Create `packages/shared/src/discovery/socket.ts`:

```ts
import dgram from "node:dgram";
import { networkInterfaces } from "node:os";
import {
    ANNOUNCE_INTERVAL_MS,
    DISCOVERY_GROUP,
    DISCOVERY_PORT,
    DISCOVERY_TTL,
} from "../constants";
import type { BeaconAnnounce, DiscoveredBackend } from "../types/backend";
import { backendIdFor, encodeAnnounce, encodeProbe, isStale, parseDatagram } from "./beacon";

interface DiscoveryHandle {
    start(): Promise<void>;
    stop(): void;
}

interface DiscoveryListener extends DiscoveryHandle {
    probe(): void;
    entries(): DiscoveredBackend[];
}

/**
 * Every non-internal IPv4 address on this machine. `addMembership` joins one
 * OS-chosen interface when given no address, which on a laptop with Wi-Fi, a
 * VPN and a Docker bridge is regularly the wrong one.
 */
function localIPv4Addresses(): string[] {
    return Object.values(networkInterfaces())
        .flatMap((entries) => entries ?? [])
        .filter((entry) => entry.family === "IPv4" && !entry.internal)
        .map((entry) => entry.address);
}

function joinAllInterfaces(socket: dgram.Socket): void {
    const addresses = localIPv4Addresses();
    if (addresses.length === 0) {
        try {
            socket.addMembership(DISCOVERY_GROUP);
        } catch {
            // No usable interface. Discovery is unavailable; manual connect still works.
        }
        return;
    }
    for (const address of addresses) {
        try {
            socket.addMembership(DISCOVERY_GROUP, address);
        } catch {
            // One interface refusing the join must not take down the others.
        }
    }
}

function bindDiscoverySocket(onMessage: (bytes: Uint8Array, address: string) => void) {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    socket.on("message", (message, rinfo) => onMessage(message, rinfo.address));
    socket.on("error", () => {
        // A socket-level error leaves discovery dead but must never crash the host process.
    });
    return socket;
}

function sendToGroup(socket: dgram.Socket, bytes: Uint8Array): void {
    for (const address of localIPv4Addresses()) {
        try {
            socket.setMulticastInterface(address);
            socket.send(bytes, DISCOVERY_PORT, DISCOVERY_GROUP);
        } catch {
            // Interface disappeared between enumeration and send.
        }
    }
}

function createAdvertiser(opts: { payload: () => BeaconAnnounce }): DiscoveryHandle {
    let socket: dgram.Socket | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    function announceNow(): void {
        if (!socket) return;
        sendToGroup(socket, encodeAnnounce(opts.payload()));
    }

    return {
        start() {
            // Idempotent: the discoverable setting can be toggled at runtime and
            // the caller should not have to track whether it already started.
            if (socket) return Promise.resolve();
            return new Promise((resolve) => {
                const bound = bindDiscoverySocket((bytes) => {
                    const message = parseDatagram(bytes);
                    if (message && "probe" in message) announceNow();
                });
                socket = bound;
                bound.bind(DISCOVERY_PORT, () => {
                    bound.setMulticastTTL(DISCOVERY_TTL);
                    joinAllInterfaces(bound);
                    announceNow();
                    timer = setInterval(announceNow, ANNOUNCE_INTERVAL_MS);
                    resolve();
                });
            });
        },
        stop() {
            if (timer) clearInterval(timer);
            timer = null;
            try {
                socket?.close();
            } catch {
                // `close` on a socket that never finished binding throws
                // ERR_SOCKET_DGRAM_NOT_RUNNING. Stopping is still the answer.
            }
            socket = null;
        },
    };
}

function createListener(opts: {
    onChange: (entries: DiscoveredBackend[]) => void;
}): DiscoveryListener {
    const seen = new Map<string, DiscoveredBackend>();
    let socket: dgram.Socket | null = null;
    let sweepTimer: ReturnType<typeof setInterval> | null = null;

    function live(): DiscoveredBackend[] {
        return [...seen.values()];
    }

    function sweep(): void {
        const now = Date.now();
        let removed = false;
        for (const [id, entry] of seen) {
            if (isStale(entry.lastSeenAt, now)) {
                seen.delete(id);
                removed = true;
            }
        }
        if (removed) opts.onChange(live());
    }

    return {
        start() {
            return new Promise((resolve) => {
                const bound = bindDiscoverySocket((bytes, address) => {
                    const message = parseDatagram(bytes);
                    if (!message || "probe" in message) return;
                    seen.set(backendIdFor(message.hostname, message.instanceId), {
                        ...message,
                        address,
                        lastSeenAt: Date.now(),
                    });
                    opts.onChange(live());
                });
                socket = bound;
                bound.bind(DISCOVERY_PORT, () => {
                    bound.setMulticastTTL(DISCOVERY_TTL);
                    joinAllInterfaces(bound);
                    sweepTimer = setInterval(sweep, ANNOUNCE_INTERVAL_MS);
                    resolve();
                });
            });
        },
        stop() {
            if (sweepTimer) clearInterval(sweepTimer);
            sweepTimer = null;
            socket?.close();
            socket = null;
            seen.clear();
        },
        probe() {
            if (socket) sendToGroup(socket, encodeProbe());
        },
        entries() {
            return live();
        },
    };
}

export { createAdvertiser, createListener };
export type { DiscoveryHandle, DiscoveryListener };
```

Create `packages/shared/src/discovery/index.ts`:

```ts
export * from "./beacon";
export * from "./socket";
```

- [ ] **Step 3b: Note what the socket layer does not guarantee**

Two things were verified on macOS with `node:dgram` before this plan was
written, and both matter to anyone debugging it later. Put them in a comment
above `bindDiscoverySocket`:

```ts
/**
 * Two sockets on one machine can both bind DISCOVERY_PORT thanks to reuseAddr,
 * and both receive every datagram in the group — including their own. Verified
 * on macOS: one send produced two receipts per socket, because the packet
 * arrives over both the loopback and the interface path.
 *
 * So: delivery is at-least-once, never exactly-once. Everything downstream must
 * be idempotent. The listener keys entries by host and instance, so a duplicate
 * is a no-op; the advertiser answering a probe twice costs one extra datagram.
 * Do not write a test that asserts a datagram arrives exactly once.
 */
```

- [ ] **Step 4: Add the package export map**

In `packages/shared/package.json`, replace the `"main"` / `"types"` pair with an `exports` map, keeping both fields for tools that ignore `exports`:

```json
    "main": "src/index.ts",
    "types": "src/index.ts",
    "exports": {
        ".": "./src/index.ts",
        "./discovery": "./src/discovery/index.ts"
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/shared/src/discovery/socket.test.ts`
Expected: PASS, or both tests reported as skipped on a machine with no
non-internal IPv4 interface. A skip there is correct: there is no multicast to
test. A *timeout* would mean `hasLan` is wrong.

- [ ] **Step 6: Verify the export map did not break any build**

Run: `bun run typecheck && bun run build:ui`
Expected: both succeed. Then confirm `node:dgram` did not reach the browser bundle:

Run: `grep -rl "node:dgram" packages/ui/dist/assets || echo "clean"`
Expected: `clean`

- [ ] **Step 7: Declare the macOS local-network permission**

Multicast is local-network traffic. Without a usage description, macOS shows no
prompt and silently drops the datagrams, which is indistinguishable from an
empty network. In `electron/package.json`, under `build.mac`, add:

```json
            "extendInfo": {
                "NSLocalNetworkUsageDescription": "Taskflow finds other Taskflow backends on your local network so you can connect to them."
            },
```

Create the `mac` block if it does not exist. Rebuild with `bun run package` and
launch the packaged app once to confirm the prompt appears — it does not appear
in `bun run dev:electron`, which runs under the Electron binary's own identity.

- [ ] **Step 8: Add the discoverable setting**

In `packages/shared/src/types/settings.ts`, add the interface next to `AppearanceSettings` and the field on `AppSettings` and `SettingsUpdatePayload`:

```ts
export interface NetworkSettings {
    /** Advertise this backend on the local network so other clients can find it. */
    discoverable: boolean;
    /** What other machines call this backend. Empty means use the hostname. */
    displayName: string;
}
```

```ts
export interface AppSettings {
    // ...existing fields...
    remoteAgent: RemoteAgentSettings;
    network: NetworkSettings;
}
```

```ts
export interface SettingsUpdatePayload {
    // ...existing fields...
    remoteAgent?: NullablePartial<RemoteAgentSettings>;
    network?: NullablePartial<NetworkSettings>;
}
```

In `packages/backend/src/services/settings-store.ts`, add to `DEFAULTS` (next to `remoteAgent` at line 95):

```ts
    network: {
        discoverable: true,
        displayName: "",
    },
```

Add to the clone at line 118:

```ts
        network: { ...DEFAULTS.network },
```

Add to the merge at line 278:

```ts
                network: { ...defaults.network, ...parsed.network },
```

- [ ] **Step 9: Start the advertiser in the backend**

In `packages/backend/src/index.ts`, after the port files are written, add:

```ts
        let network = (await settingsStore.get()).network;

        const advertiser = createAdvertiser({
            payload: () => ({
                v: 1 as const,
                protocolVersion: PROTOCOL_VERSION,
                instanceId: config.instanceId,
                hostname: hostname(),
                displayName: network.displayName.trim() || hostname(),
                port: startedServer.port,
                appVersion: APP_VERSION,
                os: process.platform,
            }),
        });

        // The setting is a switch, not a boot flag: toggling it in Settings has
        // to start or stop the beacon without a restart, and the next announce
        // has to pick up a renamed backend. `payload` is called per announce,
        // so keeping `network` current is all the rename needs.
        async function applyNetworkSettings(next: NetworkSettings): Promise<void> {
            network = next;
            if (next.discoverable) await advertiser.start();
            else advertiser.stop();
        }

        await applyNetworkSettings(network);
```

`settingsStore` is whatever the settings store instance is already called in the
enclosing scope of `index.ts` — read the surrounding lines and use that name
rather than constructing a second one.

Import `createAdvertiser` from `@taskflow/shared/discovery`, the `NetworkSettings` type from `@taskflow/shared`, and `hostname` from `os` (the file already imports `homedir` from `os`). `APP_VERSION` does not exist yet. Define it in `packages/backend/src/index.ts`, not in `packages/shared/src/constants.ts` — the shared barrel is bundled into the browser, and this reads a file the renderer has no business importing:

```ts
import appPackage from "../../../electron/package.json";

/** Informational only; compatibility is decided by PROTOCOL_VERSION. Read from
 *  the file electron-builder ships, because that is the only version bumped per
 *  release — a literal here silently drifts. Verified: `bun build --compile`
 *  inlines a JSON import, so this survives into the packaged binary. */
const APP_VERSION: string = appPackage.version;
```

`resolveJsonModule` is already on in `tsconfig.base.json:9`.

In the `shutdown` handler, before the port file removal:

```ts
            advertiser.stop();
```

- [ ] **Step 9b: Let the setting actually reach the advertiser**

`applyNetworkSettings` is useless without something calling it on a settings
update. In `packages/backend/src/handlers/settings.ts`, add an optional callback
to `SettingsHandlerDeps` and fire it after a successful update:

```ts
interface SettingsHandlerDeps {
    router: Router;
    settingsStore: SettingsStore;
    taskStore: TaskStore;
    onSettingsUpdated?: (settings: AppSettings) => void;
}
```

```ts
    router.register(MSG.SETTINGS_UPDATE, async (payload) => {
        const update = payload as SettingsUpdatePayload;
        const settings = await settingsStore.update(update);
        deps.onSettingsUpdated?.(settings);
        return settings;
    });
```

In `index.ts`, pass `onSettingsUpdated: (settings) => void applyNetworkSettings(settings.network)`
where `registerSettingsHandlers` is already called.

- [ ] **Step 9c: Expose both fields in Settings**

Without this the two fields are reachable only by hand-editing
`~/.config/taskflow/settings.json`, and the spec describes `discoverable` as
something a user turns off (`specs/2026-08-23-taskflow-multi-backend-design.md:167-169`)
and `displayName` as something they override (`:162`).

Add two rows to `packages/ui/src/components/settings/sections/GeneralSection.tsx`,
following the `Ask before exit` row already there (`GeneralSection.tsx:84-95`):

```tsx
            <SettingRow
                label="Discoverable on this network"
                hint="Let other machines running Taskflow find this backend."
                className="px-3 py-2">
                <Switch
                    id="network-discoverable"
                    checked={discoverable}
                    onCheckedChange={onDiscoverableChange}
                />
            </SettingRow>

            <SettingRow
                label="Name on the network"
                hint="How this machine appears in other clients' backend menu. Blank uses the hostname."
                className="px-3 py-2">
                <Input
                    id="network-display-name"
                    value={displayName}
                    placeholder={hostname}
                    onChange={(event) => onDisplayNameChange(event.target.value)}
                />
            </SettingRow>
```

Add the props to `GeneralSectionProps` and pass them from
`SettingsModal.tsx:454-464` the way `confirmBeforeExit` is passed, calling
`updateSettings({ network: { … } })`. `hostname` comes from the `SYSTEM_INFO`
the renderer already fetches — reuse it rather than adding a request.

Two rows in General rather than a new nav section: one switch and one text field
do not carry a section of their own, and `SectionKey` is a closed union that
would have to grow for it.

- [ ] **Step 10: Verify and commit**

Run: `bun test && bun run typecheck`
Expected: PASS

```bash
git add packages/shared packages/backend/src/index.ts packages/backend/src/services/settings-store.ts
git commit -m "feat(discovery): advertise backends on the LAN and listen for peers"
```

---

### Task 4: The backend record list

Pure list operations, separated from persistence so they can be tested without Electron.

**Files:**
- Create: `electron/src/backend-records.ts`
- Create: `electron/src/backend-records.test.ts`
- Modify: `electron/package.json`

**Interfaces:**
- Consumes: `BackendRecord`, `DiscoveredBackend`, `backendIdFor` from `@taskflow/shared`.
- Produces: `upsertRecord`, `removeRecord`, `renameRecord`, `recordFromDiscovered`, `matchesDiscovered`, `mergeForMenu`, and the `MenuEntry` type.

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
import type { BackendRecord, DiscoveredBackend, MenuEntry } from "@taskflow/shared";
import {
    mergeForMenu,
    recordFromDiscovered,
    removeRecord,
    renameRecord,
    upsertRecord,
} from "./backend-records";

/** Narrows a menu entry to one that carries a record, so the assertions below
 *  do not have to cast their way past the `local` member of the union. */
function recordAt(entries: MenuEntry[], index: number): BackendRecord {
    const entry = entries[index];
    if (entry === undefined || entry.kind === "local") {
        throw new Error(`Expected a backend record at index ${index}`);
    }
    return entry.record;
}

const discovered: DiscoveredBackend = {
    v: 1,
    protocolVersion: 1,
    instanceId: "main",
    hostname: "desktop",
    displayName: "desktop",
    port: 54892,
    appVersion: "0.14.0",
    os: "darwin",
    address: "192.168.1.20",
    lastSeenAt: 1_000,
};

const saved: BackendRecord = {
    id: "desktop:main",
    host: "192.168.1.20",
    instanceId: "main",
    displayName: "desktop",
    user: "kuindji",
    sshPort: 22,
    lastKnownPort: 54892,
    addedAt: "2026-08-23T00:00:00.000Z",
};

describe("recordFromDiscovered", () => {
    test("uses the datagram's source address, not its hostname", () => {
        const record = recordFromDiscovered(discovered, "kuindji", "2026-08-23T00:00:00.000Z");
        expect(record.host).toBe("192.168.1.20");
        expect(record.id).toBe("desktop:main");
        expect(record.sshPort).toBe(22);
    });
});

describe("upsertRecord", () => {
    test("replaces by id instead of appending a duplicate", () => {
        const updated = upsertRecord([saved], { ...saved, lastKnownPort: 60000 });
        expect(updated).toHaveLength(1);
        expect(updated[0].lastKnownPort).toBe(60000);
    });

    test("appends an unknown id", () => {
        const other = { ...saved, id: "laptop:main", host: "192.168.1.30" };
        expect(upsertRecord([saved], other)).toHaveLength(2);
    });
});

describe("renameRecord and removeRecord", () => {
    test("rename changes only the display name of the matching record", () => {
        const updated = renameRecord([saved], "desktop:main", "Big Machine");
        expect(updated[0].displayName).toBe("Big Machine");
        expect(updated[0].host).toBe(saved.host);
    });

    test("remove drops the matching record", () => {
        expect(removeRecord([saved], "desktop:main")).toHaveLength(0);
    });
});

describe("mergeForMenu", () => {
    test("orders local first, then live entries, then saved-but-unseen", () => {
        const unseen = { ...saved, id: "laptop:main", host: "192.168.1.30", displayName: "laptop" };
        const entries = mergeForMenu([saved, unseen], [discovered], 1_500, [], "kuindji");
        expect(entries.map((e) => e.kind)).toEqual(["local", "live", "unseen"]);
        expect(recordAt(entries, 1).id).toBe("desktop:main");
        expect(recordAt(entries, 2).id).toBe("laptop:main");
    });

    test("refreshes a saved record's port from the live beacon", () => {
        const stale = { ...saved, lastKnownPort: 1 };
        const entries = mergeForMenu([stale], [discovered], 1_500, [], "kuindji");
        expect(recordAt(entries, 1).lastKnownPort).toBe(54892);
    });

    test("a discovered backend that is not saved still appears", () => {
        const entries = mergeForMenu([], [discovered], 1_500, [], "kuindji");
        expect(entries.map((e) => e.kind)).toEqual(["local", "live"]);
    });

    test("an unsaved live entry carries an ssh user, because it is about to be sshed to", () => {
        // Without this the first connect to a discovered backend builds
        // `@192.168.1.20` as the ssh destination, and ssh answers with its
        // usage banner and exit 255 — which classifies as "unknown".
        const entries = mergeForMenu([], [discovered], 1_500, [], "kuindji");
        expect(recordAt(entries, 1).user).toBe("kuindji");
    });

    test("a record added by host string is the same machine as its own beacon", () => {
        // `addBackend` keys by the host the user typed; a beacon keys by the
        // hostname the machine announces. Matching on id alone lists one
        // machine twice and leaves the saved row's port stale forever.
        const byHost: BackendRecord = { ...saved, id: "192.168.1.20:main", displayName: "desktop" };
        const entries = mergeForMenu([byHost], [discovered], 1_500, [], "kuindji");
        expect(entries.map((e) => e.kind)).toEqual(["local", "live"]);
        expect(recordAt(entries, 1).id).toBe("192.168.1.20:main");
        expect(recordAt(entries, 1).lastKnownPort).toBe(54892);
    });

    test("a stale beacon does not count as live", () => {
        const entries = mergeForMenu([saved], [discovered], 30_000, [], "kuindji");
        expect(entries.map((e) => e.kind)).toEqual(["local", "unseen"]);
    });

    test("this machine's own beacon is not listed as a remote backend", () => {
        // Every backend hears its own multicast, so without the address filter
        // the local backend shows up twice.
        const entries = mergeForMenu([], [discovered], 1_500, ["192.168.1.20"], "kuindji");
        expect(entries.map((e) => e.kind)).toEqual(["local"]);
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test electron/src/backend-records.test.ts`
Expected: FAIL — `Cannot find module './backend-records'`.

- [ ] **Step 4: Write the module**

Create `electron/src/backend-records.ts`:

```ts
import { backendIdFor, isStale } from "@taskflow/shared/discovery";
import type { BackendRecord, DiscoveredBackend, MenuEntry } from "@taskflow/shared";

function recordFromDiscovered(
    discovered: DiscoveredBackend,
    user: string,
    addedAt: string,
): BackendRecord {
    return {
        id: backendIdFor(discovered.hostname, discovered.instanceId),
        // The source address, because a hostname announced by another machine
        // is not necessarily resolvable from here.
        host: discovered.address,
        instanceId: discovered.instanceId,
        displayName: discovered.displayName,
        user,
        sshPort: 22,
        lastKnownPort: discovered.port,
        addedAt,
    };
}

function upsertRecord(records: BackendRecord[], record: BackendRecord): BackendRecord[] {
    const index = records.findIndex((existing) => existing.id === record.id);
    if (index === -1) return [...records, record];
    const next = [...records];
    next[index] = record;
    return next;
}

function removeRecord(records: BackendRecord[], id: string): BackendRecord[] {
    return records.filter((record) => record.id !== id);
}

function renameRecord(records: BackendRecord[], id: string, displayName: string): BackendRecord[] {
    return records.map((record) => (record.id === id ? { ...record, displayName } : record));
}

/**
 * Whether a saved record and a live beacon are the same backend. Two ids
 * describe one machine: `addBackend` keys by the host string the user typed,
 * a beacon keys by the hostname the machine announces. Matching on the record
 * id alone shows that machine twice — once live, once unseen — and the saved
 * row never picks up the port from the beacon.
 */
function matchesDiscovered(record: BackendRecord, entry: DiscoveredBackend): boolean {
    return (
        record.id === backendIdFor(entry.hostname, entry.instanceId) ||
        (record.host === entry.address && record.instanceId === entry.instanceId)
    );
}

/**
 * The menu list: this machine, then backends currently announcing, then saved
 * backends that are not. A saved record's port is refreshed from the beacon,
 * because the backend picks a new port every start.
 *
 * `defaultUser` is the ssh login for a backend that has been discovered but
 * never saved. It cannot be blank: this record goes straight to `openTunnel`
 * the moment the user clicks the entry, and ssh rejects a bare `@host` with a
 * usage banner and exit 255.
 */
function mergeForMenu(
    records: BackendRecord[],
    discovered: DiscoveredBackend[],
    now: number,
    localAddresses: string[],
    defaultUser: string,
): MenuEntry[] {
    // This machine's own backend hears its own multicast — verified: two
    // sockets on one host in one group both receive every datagram, including
    // their own. Without this filter the local backend appears twice, once as
    // "This machine" and once as a remote host you would ssh to yourself.
    const local = new Set(localAddresses);
    const live = discovered.filter(
        (entry) => !isStale(entry.lastSeenAt, now) && !local.has(entry.address),
    );
    // The listener already keys by host and instance, but dedupe again rather
    // than trust it: one duplicate here is one duplicate row in the menu.
    const liveById = new Map(
        live.map((entry) => [backendIdFor(entry.hostname, entry.instanceId), entry]),
    );

    const matched = new Set<string>();
    const entries: MenuEntry[] = [{ kind: "local" }];

    for (const entry of liveById.values()) {
        const saved = records.find((record) => matchesDiscovered(record, entry));
        if (saved) matched.add(saved.id);
        // A matched record keeps its own id. That id is what is persisted, what
        // the menu marks as active, and what `activateBackend` looks up.
        const record = saved
            ? { ...saved, host: entry.address, lastKnownPort: entry.port }
            : recordFromDiscovered(entry, defaultUser, new Date(entry.lastSeenAt).toISOString());
        entries.push({ kind: "live", record, protocolVersion: entry.protocolVersion });
    }

    for (const record of records) {
        if (matched.has(record.id)) continue;
        entries.push({ kind: "unseen", record });
    }

    return entries;
}

export {
    matchesDiscovered,
    mergeForMenu,
    recordFromDiscovered,
    removeRecord,
    renameRecord,
    upsertRecord,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test electron/src/backend-records.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add electron/package.json electron/src/backend-records.ts electron/src/backend-records.test.ts bun.lock
git commit -m "feat(electron): add pure backend record list operations"
```

---

### Task 5: SSH argument construction and failure classification

Both are pure functions over strings, which is the only way to test ssh behaviour without an ssh server.

**Files:**
- Create: `electron/src/tunnel-args.ts`
- Create: `electron/src/tunnel-args.test.ts`

**Interfaces:**
- Consumes: `BackendRecord`, `TunnelFailure` from `@taskflow/shared`.
- Produces: `buildTunnelArgs(record: BackendRecord, localPort: number, backendPort: number): string[]`, `buildKeyscanArgs(record: BackendRecord): string[]`, `knownHostsKey(record: BackendRecord): string`, `classifyTunnelFailure(stderr: string, exitCode: number | null): TunnelFailure`.

The spec reaches for `ssh-keygen -F` to tell an unknown host key from a changed
one. That turns out to be unnecessary: ssh prints a distinct
`REMOTE HOST IDENTIFICATION HAS CHANGED` banner for the changed case, so the
classifier separates them from stderr alone. The concern behind the spec's
choice — that hashed `known_hosts` files cannot be grepped — does not apply,
because nothing here parses `known_hosts`. `knownHostsKey` is still needed, for
the bracket form `ssh-keyscan -p` emits.

- [ ] **Step 1: Write the failing test**

Create `electron/src/tunnel-args.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { BackendRecord } from "@taskflow/shared";
import { buildKeyscanArgs, buildTunnelArgs, classifyTunnelFailure, knownHostsKey } from "./tunnel-args";

const record: BackendRecord = {
    id: "desktop:main",
    host: "192.168.1.20",
    instanceId: "main",
    displayName: "desktop",
    user: "kuindji",
    sshPort: 22,
    lastKnownPort: 54892,
    addedAt: "2026-08-23T00:00:00.000Z",
};

describe("buildTunnelArgs", () => {
    test("forwards a local port to loopback on the remote host", () => {
        expect(buildTunnelArgs(record, 7777, 54892)).toEqual([
            "-N",
            "-L",
            // The bind address is explicit. `man ssh`: "By default, the local
            // port is bound in accordance with the GatewayPorts setting" — a
            // user with `GatewayPorts yes` in ~/.ssh/config would otherwise
            // republish the remote backend to their own LAN.
            "127.0.0.1:7777:127.0.0.1:54892",
            "-p",
            "22",
            "-o",
            "BatchMode=yes",
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=3",
            "kuindji@192.168.1.20",
        ]);
    });

    test("carries a non-default ssh port", () => {
        const args = buildTunnelArgs({ ...record, sshPort: 2222 }, 7777, 54892);
        expect(args).toContain("2222");
    });
});

describe("known hosts helpers", () => {
    test("a default port is queried bare", () => {
        expect(knownHostsKey(record)).toBe("192.168.1.20");
        expect(buildKeyscanArgs(record)).toEqual(["-T", "5", "-p", "22", "192.168.1.20"]);
    });

    test("a non-default port uses bracket form, which is what keyscan emits", () => {
        expect(knownHostsKey({ ...record, sshPort: 2222 })).toBe("[192.168.1.20]:2222");
    });
});

describe("classifyTunnelFailure", () => {
    test("unknown host key", () => {
        const failure = classifyTunnelFailure(
            "Host key verification failed.\r\n",
            255,
        );
        expect(failure.kind).toBe("unknown-host-key");
    });

    test("changed host key is not the same as an unknown one", () => {
        const failure = classifyTunnelFailure(
            "@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed.",
            255,
        );
        expect(failure.kind).toBe("changed-host-key");
    });

    test("auth refused", () => {
        expect(classifyTunnelFailure("kuindji@host: Permission denied (publickey).", 255).kind).toBe(
            "auth-refused",
        );
    });

    test("no route", () => {
        expect(classifyTunnelFailure("ssh: Could not resolve hostname desktop", 255).kind).toBe(
            "no-route",
        );
        expect(classifyTunnelFailure("ssh: connect to host 1.2.3.4 port 22: Connection refused", 255).kind).toBe(
            "no-route",
        );
    });

    test("local bind failure, which is retried rather than shown", () => {
        const failure = classifyTunnelFailure(
            "bind [127.0.0.1]:7777: Address already in use\nCould not request local forwarding.",
            255,
        );
        expect(failure.kind).toBe("local-bind-failed");
    });

    test("missing ssh binary", () => {
        expect(classifyTunnelFailure("spawn ssh ENOENT", null).kind).toBe("no-ssh-binary");
    });

    test("an unrecognised failure keeps the raw stderr", () => {
        const failure = classifyTunnelFailure("something nobody predicted", 1);
        expect(failure.kind).toBe("unknown");
        expect(failure.stderr).toBe("something nobody predicted");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test electron/src/tunnel-args.test.ts`
Expected: FAIL — `Cannot find module './tunnel-args'`.

- [ ] **Step 3: Write the module**

Create `electron/src/tunnel-args.ts`:

```ts
import type { BackendRecord, TunnelFailure } from "@taskflow/shared";

/**
 * `-L` forwards a local port to loopback on the remote host, which is the only
 * address the backend binds. The *local* bind address is spelled out too:
 * without it ssh follows GatewayPorts, so a user who set `GatewayPorts yes`
 * would expose the remote backend on their own LAN through this client, which
 * is exactly what Task 1 closed on the backend side.
 * BatchMode keeps ssh from ever blocking on a prompt — it exits and we read
 * stderr instead. ExitOnForwardFailure turns a failed local bind into an exit
 * rather than a tunnel that is up but useless.
 */
function buildTunnelArgs(
    record: BackendRecord,
    localPort: number,
    backendPort: number,
): string[] {
    return [
        "-N",
        "-L",
        `127.0.0.1:${localPort}:127.0.0.1:${backendPort}`,
        "-p",
        String(record.sshPort),
        "-o",
        "BatchMode=yes",
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
        `${record.user}@${record.host}`,
    ];
}

/** `known_hosts` records a non-default port in bracket form. */
function knownHostsKey(record: BackendRecord): string {
    return record.sshPort === 22 ? record.host : `[${record.host}]:${record.sshPort}`;
}

function buildKeyscanArgs(record: BackendRecord): string[] {
    return ["-T", "5", "-p", String(record.sshPort), record.host];
}

function classifyTunnelFailure(stderr: string, exitCode: number | null): TunnelFailure {
    const failure = (kind: TunnelFailure["kind"], message: string): TunnelFailure => ({
        kind,
        message,
        stderr,
    });

    if (stderr.includes("ENOENT")) {
        return failure("no-ssh-binary", "OpenSSH client not found on this machine.");
    }
    if (stderr.includes("REMOTE HOST IDENTIFICATION HAS CHANGED")) {
        return failure(
            "changed-host-key",
            "The host key changed. Resolve this yourself before connecting again.",
        );
    }
    if (stderr.includes("Host key verification failed")) {
        return failure("unknown-host-key", "This host has not been trusted yet.");
    }
    if (stderr.includes("Address already in use") || stderr.includes("Could not request local forwarding")) {
        return failure("local-bind-failed", "The local port was taken.");
    }
    if (stderr.includes("Permission denied")) {
        return failure(
            "auth-refused",
            "SSH refused the connection. Run `ssh <host>` once in a terminal to check your key.",
        );
    }
    if (
        stderr.includes("Could not resolve") ||
        stderr.includes("Connection refused") ||
        stderr.includes("Connection timed out") ||
        stderr.includes("No route to host")
    ) {
        return failure("no-route", "That host is not reachable from here.");
    }
    return failure("unknown", `SSH exited with code ${exitCode ?? "unknown"}.`);
}

export { buildKeyscanArgs, buildTunnelArgs, classifyTunnelFailure, knownHostsKey };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test electron/src/tunnel-args.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/src/tunnel-args.ts electron/src/tunnel-args.test.ts
git commit -m "feat(electron): build ssh tunnel arguments and classify ssh failures"
```

---

### Task 6: The tunnel manager

The process side: spawn ssh, prove the *backend* is there rather than just ssh, retry the local port race, and handle first-contact host keys.

**Files:**
- Create: `electron/src/tunnel-manager.ts`

**Interfaces:**
- Consumes: everything from Task 5.
- Produces: `openTunnel(record: BackendRecord, backendPort: number): Promise<TunnelResult>` where `TunnelResult = { ok: true; localPort: number } | { ok: false; failure: TunnelFailure }`; `closeTunnel(id: string): void`; `closeAllTunnels(): void`; `trustHostKey(record: BackendRecord): Promise<void>`; `fetchHostKeyFingerprint(record: BackendRecord): Promise<string>`; `readRemotePort(record: BackendRecord): Promise<{ port: number } | { failure: TunnelFailure }>`; `onTunnelExit(handler: (id: string, failure: TunnelFailure) => void): void`.

- [ ] **Step 1: Write the module**

There is no test in this task: every branch is a real `ssh` process, and the parts that can be tested without one were extracted into Task 5. Task 5's tests are this module's tests.

Create `electron/src/tunnel-manager.ts`:

```ts
import { spawn, type ChildProcess } from "child_process";
import { execFile } from "child_process";
import { createServer } from "net";
import { appendFile, chmod, mkdir, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { isSafeLabel } from "@taskflow/shared/discovery";
import type { BackendRecord, TunnelFailure } from "@taskflow/shared";
import { buildKeyscanArgs, buildTunnelArgs, classifyTunnelFailure } from "./tunnel-args";

interface ActiveTunnel {
    child: ChildProcess;
    localPort: number;
}

type TunnelResult = { ok: true; localPort: number } | { ok: false; failure: TunnelFailure };

const tunnels = new Map<string, ActiveTunnel>();
let exitHandler: ((id: string, failure: TunnelFailure) => void) | null = null;

const READINESS_TIMEOUT_MS = 10_000;
const LOCAL_PORT_ATTEMPTS = 3;

function onTunnelExit(handler: (id: string, failure: TunnelFailure) => void): void {
    exitHandler = handler;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bind 0, read the port, release it. Something else can take the port before
 * ssh binds it; ExitOnForwardFailure turns that into a clean exit we retry.
 */
function allocateLocalPort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address === null || typeof address === "string") {
                server.close();
                reject(new Error("Could not allocate a local port"));
                return;
            }
            const { port } = address;
            server.close(() => resolve(port));
        });
    });
}

/**
 * `ssh -L` accepts connections whether or not anything is listening on the far
 * side, so a TCP connect proves nothing. The backend answers `GET /` with
 * "Taskflow backend", which proves it is actually there.
 */
async function waitForBackend(localPort: number): Promise<boolean> {
    const deadline = Date.now() + READINESS_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${localPort}/`, {
                signal: AbortSignal.timeout(1_000),
            });
            if (response.ok) return true;
        } catch {
            // Not up yet.
        }
        await delay(200);
    }
    return false;
}

function runSsh(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve) => {
        execFile("ssh", args, { timeout: 15_000 }, (error, stdout, stderr) => {
            // A non-numeric `code` means the spawn itself failed — ENOENT for a
            // missing ssh binary — so it must not be flattened to 0, which reads
            // as success.
            const code =
                error && "code" in error && typeof error.code === "number" ? error.code : null;
            resolve({ stdout, stderr: stderr + (error ? String(error.message) : ""), code });
        });
    });
}

/**
 * The manual-connect fallback for hosts multicast cannot reach. Returns the
 * classified failure rather than a bare null: a missing ssh binary reported as
 * "could not work out which port" sends the user looking at the wrong machine.
 *
 * The path mirrors `config.instancePortFile` from Task 1, which is
 * `join(getConfigBaseDir(), `${instanceId}.port`)` — on macOS and Linux that is
 * `~/.config/taskflow`, NOT `~/.taskflow` (`packages/backend/src/services/platform.ts:12-18`).
 * A Windows backend keeps it under %APPDATA% and cannot be read this way; that
 * host needs discovery or an explicit port in the connect dialog.
 */
async function readRemotePort(
    record: BackendRecord,
): Promise<{ port: number } | { failure: TunnelFailure }> {
    // The record can come from the connect dialog rather than the beacon codec,
    // so the one value that reaches a remote shell is re-checked here.
    if (!isSafeLabel(record.instanceId)) {
        return {
            failure: {
                kind: "unknown",
                message: `"${record.instanceId}" is not a valid instance name.`,
                stderr: "",
            },
        };
    }
    // Single-quoted so the remote shell treats it as one literal word, and
    // `~` rather than `$HOME` so expansion still happens outside the quotes.
    // `isSafeLabel` above already excludes a quote character; this is the second
    // lock on the same door.
    const remotePath = `~/.config/taskflow/'${record.instanceId}.port'`;
    const { stdout, stderr, code } = await runSsh([
        "-p",
        String(record.sshPort),
        "-o",
        "BatchMode=yes",
        `${record.user}@${record.host}`,
        `cat ${remotePath}`,
    ]);
    const port = Number.parseInt(stdout.trim(), 10);
    if (Number.isInteger(port) && port > 0) return { port };
    return { failure: classifyTunnelFailure(stderr, code) };
}

function spawnTunnel(record: BackendRecord, localPort: number, backendPort: number) {
    const child = spawn("ssh", buildTunnelArgs(record, localPort, backendPort), {
        stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
    });
    child.on("error", (error) => {
        stderr += String(error.message);
    });
    return {
        child,
        readStderr: () => stderr,
    };
}

async function attemptTunnel(
    record: BackendRecord,
    backendPort: number,
): Promise<TunnelResult> {
    const localPort = await allocateLocalPort();
    const { child, readStderr } = spawnTunnel(record, localPort, backendPort);

    // `close` rather than `exit`: a spawn failure (no ssh binary) emits
    // `error` and `close` but never `exit`, so racing `exit` alone would let
    // ENOENT fall through to the readiness timeout and be reported as
    // "Taskflow is not running" ten seconds later.
    // One listener for the child's whole life, not one per phase: before
    // readiness it settles the race, after it notifies the renderer. Two
    // listeners on one `close` would double-fire.
    let established = false;
    const exited = new Promise<TunnelFailure>((resolve) => {
        child.once("close", (code) => {
            const failure = classifyTunnelFailure(readStderr(), code);
            if (established) {
                tunnels.delete(record.id);
                exitHandler?.(record.id, failure);
                return;
            }
            resolve(failure);
        });
    });
    const ready = waitForBackend(localPort).then((ok) => (ok ? null : "not-ready"));

    const outcome = await Promise.race([exited, ready]);

    if (outcome === null) {
        established = true;
        tunnels.set(record.id, { child, localPort });
        return { ok: true, localPort };
    }

    child.kill();
    if (outcome === "not-ready") {
        return {
            ok: false,
            failure: {
                kind: "no-backend",
                message: `Taskflow is not running on ${record.displayName}.`,
                stderr: readStderr(),
            },
        };
    }
    return { ok: false, failure: outcome };
}

async function openTunnel(record: BackendRecord, backendPort: number): Promise<TunnelResult> {
    closeTunnel(record.id);
    let last: TunnelResult = {
        ok: false,
        failure: { kind: "unknown", message: "Tunnel never started.", stderr: "" },
    };
    for (let attempt = 0; attempt < LOCAL_PORT_ATTEMPTS; attempt++) {
        last = await attemptTunnel(record, backendPort);
        if (last.ok) return last;
        // Only a lost local port is worth retrying; everything else is terminal.
        if (last.failure.kind !== "local-bind-failed") return last;
    }
    return last;
}

function closeTunnel(id: string): void {
    const tunnel = tunnels.get(id);
    if (!tunnel) return;
    tunnels.delete(id);
    // Drops the single lifetime listener, so a deliberate close is not reported
    // to the renderer as a dropped tunnel.
    tunnel.child.removeAllListeners("close");
    tunnel.child.kill();
}

function closeAllTunnels(): void {
    for (const id of [...tunnels.keys()]) closeTunnel(id);
}

async function fetchHostKeyFingerprint(record: BackendRecord): Promise<string> {
    const scanned = await new Promise<string>((resolve) => {
        execFile("ssh-keyscan", buildKeyscanArgs(record), { timeout: 10_000 }, (_e, stdout) =>
            resolve(stdout),
        );
    });
    if (scanned.trim().length === 0) throw new Error(`No host key returned by ${record.host}`);
    const fingerprint = await new Promise<string>((resolve) => {
        const child = execFile("ssh-keygen", ["-lf", "-"], (_e, stdout) => resolve(stdout));
        child.stdin?.end(scanned);
    });
    return fingerprint.trim();
}

/**
 * Only ever called after the user approved the fingerprint, and only for an
 * `unknown-host-key` failure. A CHANGED key is classified separately and never
 * reaches here — that case is the user's to resolve outside the app.
 */
async function trustHostKey(record: BackendRecord): Promise<void> {
    const sshDir = join(homedir(), ".ssh");
    const knownHosts = join(sshDir, "known_hosts");
    await mkdir(sshDir, { recursive: true, mode: 0o700 });

    const scanned = await new Promise<string>((resolve) => {
        execFile("ssh-keyscan", buildKeyscanArgs(record), { timeout: 10_000 }, (_e, stdout) =>
            resolve(stdout),
        );
    });
    if (scanned.trim().length === 0) throw new Error(`No host key returned by ${record.host}`);

    let existing = "";
    try {
        existing = await readFile(knownHosts, "utf-8");
    } catch {
        // File does not exist yet.
    }
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await appendFile(knownHosts, `${prefix}${scanned.trimEnd()}\n`, { mode: 0o600 });
    await chmod(knownHosts, 0o600);
}

export {
    closeAllTunnels,
    closeTunnel,
    fetchHostKeyFingerprint,
    onTunnelExit,
    openTunnel,
    readRemotePort,
    trustHostKey,
};
export type { TunnelResult };
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add electron/src/tunnel-manager.ts
git commit -m "feat(electron): supervise ssh tunnels with a backend readiness probe"
```

---

### Task 7: The registry, the IPC surface, and main-process rewiring

**Files:**
- Create: `electron/src/backend-registry.ts`
- Modify: `electron/src/ipc-handlers.ts`
- Modify: `electron/src/preload.ts`
- Modify: `packages/ui/src/env.d.ts`
- Modify: `electron/src/main.ts:90-140`
- Modify: `electron/src/notification-poller.ts:5-30`
- Modify: `electron/src/tray-manager.ts:6-10,161,186`

**Interfaces:**
- Consumes: Tasks 4, 5, 6.
- Produces: on `window.taskflow` — `listBackends(): Promise<MenuEntry[]>`, `getActiveBackend(): Promise<{ id: string; origin: string | null; isLocal: boolean }>`, `activateBackend(id: string): Promise<{ ok: true; origin: string } | { ok: false; failure: TunnelFailure }>`, `cancelActivation(id: string): Promise<void>`, `addBackend(input: { host: string; user?: string; sshPort?: number; port?: number }): Promise<BackendRecord>`, `renameBackend(id, displayName): Promise<void>`, `removeBackend(id): Promise<void>`, `trustBackendHost(id): Promise<void>`, `getHostFingerprint(id): Promise<string>`, `onBackendsChanged(cb: () => void): () => void`, `onBackendDropped(cb: (failure: TunnelFailure) => void): () => void`.

- [ ] **Step 1: Write the registry**

Create `electron/src/backend-registry.ts`:

```ts
import { app } from "electron";
import { readFile, writeFile } from "fs/promises";
import { networkInterfaces, userInfo } from "os";
import { join } from "path";
import { backendIdFor, isSafeLabel } from "@taskflow/shared/discovery";
import { createListener, type DiscoveryListener } from "@taskflow/shared/discovery";
import type {
    BackendRecord,
    DiscoveredBackend,
    MenuEntry,
    TunnelFailure,
} from "@taskflow/shared";
import {
    matchesDiscovered,
    mergeForMenu,
    recordFromDiscovered,
    removeRecord,
    renameRecord,
    upsertRecord,
} from "./backend-records";
import { closeTunnel, openTunnel, readRemotePort } from "./tunnel-manager";

interface BackendRegistryDeps {
    /** The port of the backend Electron spawned for this window. */
    getLocalPort: () => number | null;
    onChanged: () => void;
}

const LOCAL_ID = "local";

let deps: BackendRegistryDeps;
let records: BackendRecord[] = [];
let discovered: DiscoveredBackend[] = [];
let listener: DiscoveryListener | null = null;
let activeId = LOCAL_ID;
let activeOrigin: string | null = null;
/** Read back from disk for menu ordering. Never auto-connected to on startup. */
let lastUsedId = LOCAL_ID;
/** The backend being switched away from, retired once the renderer promotes. */
let previousId = LOCAL_ID;

function storePath(): string {
    return join(app.getPath("userData"), "backends.json");
}

/**
 * `activeId` is persisted so the menu can show what you last used, but startup
 * always begins on the local backend: restoring a remote one would make app
 * launch wait on ssh, and fail when the other machine is asleep.
 */
async function load(): Promise<void> {
    try {
        const parsed: unknown = JSON.parse(await readFile(storePath(), "utf-8"));
        if (typeof parsed === "object" && parsed !== null && "records" in parsed) {
            const file = parsed as { records?: unknown; activeId?: unknown };
            records = Array.isArray(file.records) ? (file.records as BackendRecord[]) : [];
            lastUsedId = typeof file.activeId === "string" ? file.activeId : LOCAL_ID;
            return;
        }
        // A file written before activeId was persisted.
        if (Array.isArray(parsed)) records = parsed as BackendRecord[];
    } catch {
        records = [];
    }
}

async function persist(): Promise<void> {
    await writeFile(
        storePath(),
        JSON.stringify({ records, activeId }, null, 2),
        "utf-8",
    );
}

async function initBackendRegistry(d: BackendRegistryDeps): Promise<void> {
    deps = d;
    await load();
    listener = createListener({
        onChange: (entries) => {
            discovered = entries;
            deps.onChanged();
        },
    });
    await listener.start();
}

function localOrigin(): string | null {
    const port = deps.getLocalPort();
    return port === null ? null : `http://127.0.0.1:${port}`;
}

/** The active backend's HTTP origin. Main-process pollers use this. */
function getActiveOrigin(): string | null {
    return activeId === LOCAL_ID ? localOrigin() : activeOrigin;
}

function isLocalActive(): boolean {
    return activeId === LOCAL_ID;
}

function localAddresses(): string[] {
    return Object.values(networkInterfaces())
        .flatMap((entries) => entries ?? [])
        .filter((entry) => entry.family === "IPv4")
        .map((entry) => entry.address);
}

/** The ssh login a backend gets when it was discovered rather than added by
 *  hand. Blank is not an option: it reaches `buildTunnelArgs` unchanged. */
function defaultSshUser(): string {
    return userInfo().username;
}

function menu(): MenuEntry[] {
    return mergeForMenu(records, discovered, Date.now(), localAddresses(), defaultSshUser());
}

function listBackends(): MenuEntry[] {
    listener?.probe();
    return menu();
}

function findRecord(id: string): BackendRecord | null {
    const entry = menu().find(
        (candidate) => candidate.kind !== "local" && candidate.record.id === id,
    );
    return entry && entry.kind !== "local" ? entry.record : null;
}

async function resolveBackendPort(
    record: BackendRecord,
): Promise<{ port: number } | { failure: TunnelFailure }> {
    // `matchesDiscovered`, not an id comparison: a record added by host string
    // and its own beacon carry different ids for the same machine, and matching
    // on id alone sends a perfectly discoverable backend down the ssh fallback.
    const live = discovered.find((entry) => matchesDiscovered(record, entry));
    if (live) return { port: live.port };
    if (record.lastKnownPort !== null) return { port: record.lastKnownPort };
    return readRemotePort(record);
}

async function activateBackend(
    id: string,
): Promise<{ ok: true; origin: string } | { ok: false; failure: TunnelFailure }> {
    if (id === LOCAL_ID) {
        const origin = localOrigin();
        if (origin === null) {
            return {
                ok: false,
                failure: {
                    kind: "no-backend",
                    message: "The local backend is not running.",
                    stderr: "",
                },
            };
        }
        return { ok: true, origin };
    }

    const record = findRecord(id);
    if (record === null) {
        return {
            ok: false,
            failure: { kind: "unknown", message: "That backend is no longer known.", stderr: "" },
        };
    }

    const resolved = await resolveBackendPort(record);
    if ("failure" in resolved) return { ok: false, failure: resolved.failure };
    const backendPort = resolved.port;

    const result = await openTunnel(record, backendPort);
    if (!result.ok) return result;

    records = upsertRecord(records, { ...record, lastKnownPort: backendPort });
    await persist();
    return { ok: true, origin: `http://127.0.0.1:${result.localPort}` };
}

/**
 * Split in two on purpose. Recording the new active backend has to happen
 * BEFORE the renderer promotes its socket: if it happened after and the IPC or
 * the write failed, the renderer would be on the new backend while main still
 * polled and reported the old one, with no pending socket left to roll back.
 *
 * Retiring the old tunnel has to happen AFTER, because the renderer is still
 * talking through it until it promotes.
 */
async function setActive(id: string, origin: string): Promise<void> {
    previousId = activeId;
    activeId = id;
    lastUsedId = id;
    activeOrigin = id === LOCAL_ID ? null : origin;
    await persist();
    deps.onChanged();
}

/**
 * Undoes an activation the renderer decided not to promote — an incompatible
 * protocol version, or a throw anywhere between `activateBackend` and
 * `setActiveBackend`. Without it the ssh child opened for the rejected backend
 * stays alive until the app quits, because `retirePreviousTunnel` only ever
 * closes the backend that *was* active.
 */
function cancelActivation(id: string): void {
    if (id === LOCAL_ID || id === activeId) return;
    try {
        closeTunnel(id);
    } catch (error) {
        console.error("Failed to close a cancelled activation's tunnel:", error);
    }
}

/** Failure here leaks one ssh process. It is logged, never surfaced: the
 *  switch has already succeeded and there is nothing for the user to do. */
function retirePreviousTunnel(): void {
    if (previousId !== LOCAL_ID && previousId !== activeId) {
        try {
            closeTunnel(previousId);
        } catch (error) {
            console.error("Failed to close the previous tunnel:", error);
        }
    }
    previousId = LOCAL_ID;
}

/** The backend that was active when the app last quit. Menu ordering only. */
function getLastUsedId(): string {
    return lastUsedId;
}

async function addBackend(input: {
    host: string;
    user?: string;
    sshPort?: number;
    port?: number;
    instanceId?: string;
    displayName?: string;
}): Promise<BackendRecord> {
    const instanceId = input.instanceId ?? "main";
    // The same character set the beacon codec enforces. This value ends up in
    // the record id and, on the manual-connect path, in a command run over ssh.
    if (!isSafeLabel(instanceId)) throw new Error(`"${instanceId}" is not a valid instance name.`);
    const record: BackendRecord = {
        id: backendIdFor(input.host, instanceId),
        host: input.host,
        instanceId,
        displayName: input.displayName ?? input.host,
        user: input.user && input.user.length > 0 ? input.user : userInfo().username,
        sshPort: input.sshPort ?? 22,
        lastKnownPort: input.port ?? null,
        addedAt: new Date().toISOString(),
    };
    records = upsertRecord(records, record);
    await persist();
    deps.onChanged();
    return record;
}

/** Saves a discovered backend the first time the user connects to it. */
async function rememberDiscovered(id: string): Promise<void> {
    if (records.some((record) => record.id === id)) return;
    const entry = discovered.find(
        (candidate) => backendIdFor(candidate.hostname, candidate.instanceId) === id,
    );
    if (!entry) return;
    records = upsertRecord(
        records,
        recordFromDiscovered(entry, userInfo().username, new Date().toISOString()),
    );
    await persist();
}

async function renameBackend(id: string, displayName: string): Promise<void> {
    records = renameRecord(records, id, displayName);
    await persist();
    deps.onChanged();
}

async function removeBackend(id: string): Promise<void> {
    records = removeRecord(records, id);
    await persist();
    deps.onChanged();
}

function stopBackendRegistry(): void {
    listener?.stop();
    listener = null;
}

export {
    LOCAL_ID,
    activateBackend,
    addBackend,
    cancelActivation,
    findRecord,
    getActiveOrigin,
    getLastUsedId,
    initBackendRegistry,
    retirePreviousTunnel,
    setActive,
    isLocalActive,
    listBackends,
    rememberDiscovered,
    removeBackend,
    renameBackend,
    stopBackendRegistry,
};
```

- [ ] **Step 2: Register the IPC handlers**

In `electron/src/ipc-handlers.ts`, add near the existing `get-backend-port` handler:

```ts
    ipcMain.handle("backend-list", () => listBackends());

    ipcMain.handle("backend-active", () => ({
        id: isLocalActive() ? LOCAL_ID : activeBackendId(),
        origin: getActiveOrigin(),
        isLocal: isLocalActive(),
    }));

    ipcMain.handle("backend-activate", async (_event, id: string) => {
        const result = await activateBackend(id);
        if (result.ok) await rememberDiscovered(id);
        return result;
    });

    ipcMain.handle("backend-set-active", async (_event, id: string, origin: string) => {
        await setActive(id, origin);
    });

    ipcMain.handle("backend-retire-previous", () => {
        retirePreviousTunnel();
    });

    ipcMain.handle("backend-cancel-activation", (_event, id: string) => {
        cancelActivation(id);
    });

    ipcMain.handle(
        "backend-add",
        async (_event, input: { host: string; user?: string; sshPort?: number; port?: number }) =>
            addBackend(input),
    );

    ipcMain.handle("backend-rename", async (_event, id: string, displayName: string) => {
        await renameBackend(id, displayName);
    });

    ipcMain.handle("backend-remove", async (_event, id: string) => {
        await removeBackend(id);
    });

    ipcMain.handle("backend-fingerprint", async (_event, id: string) => {
        const record = findRecord(id);
        if (!record) throw new Error("Unknown backend");
        return fetchHostKeyFingerprint(record);
    });

    ipcMain.handle("backend-trust-host", async (_event, id: string) => {
        const record = findRecord(id);
        if (!record) throw new Error("Unknown backend");
        await trustHostKey(record);
    });
```

`activeBackendId()` does not exist yet — add it to `backend-registry.ts` next to `isLocalActive`:

```ts
function activeBackendId(): string {
    return activeId;
}
```

and export it. Import the registry and tunnel functions at the top of `ipc-handlers.ts`.

- [ ] **Step 3: Bridge them in preload**

In `electron/src/preload.ts`, inside `contextBridge.exposeInMainWorld("taskflow", {`:

```ts
    listBackends: () => ipcRenderer.invoke("backend-list"),
    getActiveBackend: () => ipcRenderer.invoke("backend-active"),
    activateBackend: (id: string) => ipcRenderer.invoke("backend-activate", id),
    setActiveBackend: (id: string, origin: string) =>
        ipcRenderer.invoke("backend-set-active", id, origin),
    retirePreviousTunnel: () => ipcRenderer.invoke("backend-retire-previous"),
    cancelActivation: (id: string) => ipcRenderer.invoke("backend-cancel-activation", id),
    addBackend: (input: { host: string; user?: string; sshPort?: number; port?: number }) =>
        ipcRenderer.invoke("backend-add", input),
    renameBackend: (id: string, displayName: string) =>
        ipcRenderer.invoke("backend-rename", id, displayName),
    removeBackend: (id: string) => ipcRenderer.invoke("backend-remove", id),
    getHostFingerprint: (id: string) => ipcRenderer.invoke("backend-fingerprint", id),
    trustBackendHost: (id: string) => ipcRenderer.invoke("backend-trust-host", id),
    onBackendsChanged: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("backends-changed", listener);
        return () => {
            ipcRenderer.removeListener("backends-changed", listener);
        };
    },
    onBackendDropped: (callback: (failure: TunnelFailure) => void) => {
        const listener = (_e: unknown, failure: TunnelFailure) => callback(failure);
        ipcRenderer.on("backend-dropped", listener);
        return () => {
            ipcRenderer.removeListener("backend-dropped", listener);
        };
    },
```

Import the types at the top: `import type { MenuEntry, TunnelFailure } from "@taskflow/shared";`

- [ ] **Step 4: Declare the bridge for the renderer**

In `packages/ui/src/env.d.ts`, add to `interface TaskflowBridge`:

```ts
    listBackends(): Promise<MenuEntry[]>;
    getActiveBackend(): Promise<{ id: string; origin: string | null; isLocal: boolean }>;
    activateBackend(
        id: string,
    ): Promise<{ ok: true; origin: string } | { ok: false; failure: TunnelFailure }>;
    setActiveBackend(id: string, origin: string): Promise<void>;
    retirePreviousTunnel(): Promise<void>;
    cancelActivation(id: string): Promise<void>;
    addBackend(input: {
        host: string;
        user?: string;
        sshPort?: number;
        port?: number;
    }): Promise<BackendRecord>;
    renameBackend(id: string, displayName: string): Promise<void>;
    removeBackend(id: string): Promise<void>;
    getHostFingerprint(id: string): Promise<string>;
    trustBackendHost(id: string): Promise<void>;
    onBackendsChanged(callback: () => void): () => void;
    onBackendDropped(callback: (failure: TunnelFailure) => void): () => void;
```

Add at the top of the file: `import type { BackendRecord, MenuEntry, TunnelFailure } from "@taskflow/shared";`

- [ ] **Step 5: Wire main and repoint the pollers**

In `electron/src/main.ts`, after `initNotificationPoller`:

```ts
void initBackendRegistry({
    getLocalPort: getBackendPort,
    onChanged: () => getMainWindow()?.webContents.send("backends-changed"),
});

onTunnelExit((_id, failure) => {
    getMainWindow()?.webContents.send("backend-dropped", failure);
});

app.on("will-quit", () => {
    closeAllTunnels();
    stopBackendRegistry();
});
```

Change `initTrayManager` and `initNotificationPoller` to take the active origin instead of the local port:

```ts
initTrayManager({
    getMainWindow,
    getActiveOrigin,
    showMainWindow,
    getDevBranch: () => devBranch,
    quit: () => app.quit(),
});

initNotificationPoller({
    getMainWindow,
    getActiveOrigin,
});
```

Leave `initWindowManager({ getBackendPort, ... })` alone. Window geometry belongs to this screen, not to the machine being viewed; routing it to the active backend would have a laptop's window position overwrite a desktop's on every switch.

- [ ] **Step 6: Update the two pollers**

In `electron/src/notification-poller.ts`, change the deps interface and the fetch:

```ts
interface NotificationPollerDeps {
    getMainWindow: () => BrowserWindow | null;
    getActiveOrigin: () => string | null;
}
```

```ts
    const origin = deps.getActiveOrigin();
    if (!origin) return;

    try {
        const response = await fetch(`${origin}/api/notifications`, {
            signal: AbortSignal.timeout(2000),
        });
```

Apply the same change in `electron/src/tray-manager.ts` — the deps interface at line 6-10, and both `deps.getBackendPort()` call sites (161, 186), using `${origin}/api/tray-state`.

- [ ] **Step 7: Verify**

Run: `bun test && bun run typecheck && bun run build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add electron/src packages/ui/src/env.d.ts packages/shared/src/types/backend.ts
git commit -m "feat(electron): add the backend registry and its IPC surface"
```

---

### Task 8: Make the WebSocket client hold two sockets

The module today is a set of globals with one socket. Opening the new socket before closing the old one — which is what makes a failed switch non-destructive — means both would write the same globals.

**Files:**
- Modify: `packages/ui/src/hooks/useWebSocket.ts`
- Modify: `packages/ui/src/lib/backend-url.ts`
- Modify: `packages/ui/src/providers/WebSocketProvider.tsx:20-40`
- Create: `packages/ui/src/hooks/useWebSocket.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `connectTo(origin: string): Promise<void>` (opens a *pending* socket, does not promote), `promoteConnection(): void`, `abortPending(): void`, `getBackendOrigin(): string | null`, `BACKEND_SWITCHED` error message constant. The reconnect backoff defers while a socket is pending, so it never cancels a switch. `sendRequest`, `sendFireAndForget`, `onEvent`, `onStatusChange` keep their signatures.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/hooks/useWebSocket.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import {
    BACKEND_SWITCHED,
    abortPending,
    connectTo,
    getBackendOrigin,
    onEvent,
    onStatusChange,
    promoteConnection,
    sendRequest,
} from "./useWebSocket";

interface FakeServer {
    origin: string;
    stop(): void;
    /** Sockets the client opened to this server. */
    connections: number;
    closed: number;
}

function startServer(): FakeServer {
    let connections = 0;
    let closed = 0;
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req, server) {
            if (server.upgrade(req)) return;
            return new Response("Taskflow backend");
        },
        websocket: {
            open() {
                connections++;
            },
            close() {
                closed++;
            },
            message(ws, raw) {
                const request = JSON.parse(String(raw)) as {
                    correlationId?: string;
                    type: string;
                };
                // Every request also triggers one broadcast, which is what the
                // duplicate-subscription test counts.
                ws.send(JSON.stringify({ type: "task:updated", payload: {} }));
                // system:info is answered so the handshake tests have something
                // to await. Everything else is left hanging on purpose, which is
                // what makes the switch and abort tests meaningful.
                if (request.type === "system:info" && request.correlationId) {
                    ws.send(
                        JSON.stringify({
                            correlationId: request.correlationId,
                            type: request.type,
                            payload: { editors: [], homedir: "/h", protocolVersion: 1 },
                        }),
                    );
                }
            },
        },
    });
    return {
        origin: `ws://127.0.0.1:${server.port}`,
        stop: () => server.stop(true),
        get connections() {
            return connections;
        },
        get closed() {
            return closed;
        },
    };
}

const servers: FakeServer[] = [];

afterEach(() => {
    abortPending();
    while (servers.length > 0) servers.pop()?.stop();
});

function track(server: FakeServer): FakeServer {
    servers.push(server);
    return server;
}

describe("switching connections", () => {
    test("the old socket stays open until the new one is promoted", async () => {
        const a = track(startServer());
        const b = track(startServer());

        await connectTo(a.origin);
        promoteConnection();
        expect(getBackendOrigin()).toBe(a.origin);

        await connectTo(b.origin);
        expect(a.closed).toBe(0); // still serving while the handshake would run

        promoteConnection();
        await Bun.sleep(50);
        expect(a.closed).toBe(1);
        expect(getBackendOrigin()).toBe(b.origin);
    });

    test("aborting a pending connection leaves the current one untouched", async () => {
        const a = track(startServer());
        const b = track(startServer());

        await connectTo(a.origin);
        promoteConnection();

        await connectTo(b.origin);
        abortPending();
        await Bun.sleep(50);

        expect(getBackendOrigin()).toBe(a.origin);
        expect(a.closed).toBe(0);
        expect(b.closed).toBe(1);
    });

    test("requests in flight across a switch reject as switched, not as a timeout", async () => {
        const a = track(startServer());
        const b = track(startServer());

        await connectTo(a.origin);
        promoteConnection();

        const inFlight = sendRequest("project:list");

        await connectTo(b.origin);
        promoteConnection();

        await expect(inFlight).rejects.toThrow(BACKEND_SWITCHED);
    });

    test("switching does not duplicate event subscriptions", async () => {
        const a = track(startServer());
        const b = track(startServer());

        await connectTo(a.origin);
        promoteConnection();

        let received = 0;
        const unsubscribe = onEvent("task:updated", () => {
            received++;
        });

        await connectTo(b.origin);
        promoteConnection();
        await Bun.sleep(50);

        // eventListeners is keyed by message type, not by socket, and is
        // deliberately not cleared on a switch — that is what lets subscriptions
        // survive one. The risk is the opposite: a re-registration per switch
        // would silently duplicate every terminal chunk.
        void sendRequest("task:list").catch(() => {});
        await Bun.sleep(100);

        unsubscribe();
        expect(received).toBe(1);
    });

    test("a request can be sent over the pending socket before promotion", async () => {
        // This is what the compatibility handshake does. If pending sockets have
        // no message routing, the handshake times out and no switch completes.
        const a = track(startServer());
        const b = track(startServer());

        await connectTo(a.origin);
        promoteConnection();

        await connectTo(b.origin);
        await expect(
            sendRequest("system:info", {}, { usePending: true }),
        ).resolves.toBeDefined();
    });

    test("aborting rejects a request that was in flight on the pending socket", async () => {
        const a = track(startServer());
        const b = track(startServer());

        await connectTo(a.origin);
        promoteConnection();

        await connectTo(b.origin);
        const inFlight = sendRequest("system:info", {}, { usePending: true });
        abortPending();

        await expect(inFlight).rejects.toThrow(BACKEND_SWITCHED);
    });

    test("a failed reconnect schedules another attempt", async () => {
        const a = track(startServer());
        await connectTo(a.origin);
        promoteConnection();

        const statuses: Array<{ connected: boolean; reconnecting: boolean }> = [];
        const unsubscribe = onStatusChange((status) => statuses.push({ ...status }));

        a.stop(); // The backend goes away entirely, so every reconnect fails.
        await Bun.sleep(2_500);
        unsubscribe();

        // At least two reconnecting notifications: the first backoff, and the
        // one the failure of that attempt scheduled.
        expect(statuses.filter((s) => s.reconnecting).length).toBeGreaterThan(1);
    });

    test("a reconnect waits rather than killing a switch in flight", async () => {
        // The old backend dropping mid-handshake is exactly when this matters:
        // the reconnect backoff and the switch both want the pending slot.
        const a = track(startServer());
        const b = track(startServer());

        await connectTo(a.origin);
        promoteConnection();

        await connectTo(b.origin); // pending, not promoted — the handshake would run here
        a.stop(); // the old backend goes away while the handshake is in flight
        await Bun.sleep(1_500); // long enough for the first backoff to fire

        // The pending socket survived: a request over it still works, so the
        // switch can still complete.
        await expect(
            sendRequest("system:info", {}, { usePending: true }),
        ).resolves.toBeDefined();

        promoteConnection();
        expect(getBackendOrigin()).toBe(b.origin);
    });

    test("a superseded socket closing does not report the app as disconnected", async () => {
        const a = track(startServer());
        const b = track(startServer());

        await connectTo(a.origin);
        promoteConnection();

        const statuses: boolean[] = [];
        const unsubscribe = onStatusChange((status) => statuses.push(status.connected));

        await connectTo(b.origin);
        promoteConnection();
        await Bun.sleep(100);

        unsubscribe();
        expect(statuses.includes(false)).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui/src/hooks/useWebSocket.test.ts`
Expected: FAIL — `connectTo` is not exported.

- [ ] **Step 3: Rewrite the connection bookkeeping**

Replace the top of `packages/ui/src/hooks/useWebSocket.ts` (through `connectWebSocket`) with:

```ts
import type { WsRequest } from "@taskflow/shared";

/** Rejection message for requests that were in flight when the backend changed. */
const BACKEND_SWITCHED = "Backend switched";

interface Connection {
    socket: WebSocket;
    origin: string;
    generation: number;
}

let current: Connection | null = null;
let pending: Connection | null = null;
/** Settles the promise `connectTo` returned for the pending socket. */
let pendingSettle: { resolve: () => void; reject: (reason: unknown) => void } | null = null;
let generationCounter = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let connected = false;
let reconnecting = false;
const MAX_RECONNECT_DELAY = 10000;

interface ConnectionStatus {
    connected: boolean;
    reconnecting: boolean;
}

const pendingRequests = new Map<
    string,
    {
        generation: number;
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
        timeoutId: ReturnType<typeof setTimeout>;
    }
>();
const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
const statusListeners = new Set<(status: ConnectionStatus) => void>();

function notifyStatus(): void {
    const status = { connected, reconnecting };
    for (const listener of statusListeners) listener(status);
}

function getBackendOrigin(): string | null {
    return current?.origin ?? null;
}

function onStatusChange(handler: (status: ConnectionStatus) => void): () => void {
    statusListeners.add(handler);
    handler({ connected, reconnecting });
    return () => {
        statusListeners.delete(handler);
    };
}

function scheduleReconnect(): void {
    if (reconnectTimer || !current) return;
    const { origin } = current;
    reconnecting = true;
    notifyStatus();
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        // A switch may be mid-handshake on the pending socket. `connectTo`
        // begins by aborting whatever is pending, so reconnecting now would
        // kill a switch that was about to succeed and surface it as
        // "Backend switched". Defer instead: `promoteConnection` clears this
        // timer if the switch lands, and `abortPending` leaves the next tick
        // free to run.
        if (pending) {
            scheduleReconnect();
            return;
        }
        void connectTo(origin)
            .then(() => promoteConnection())
            .catch(() => {
                // A failed reconnect must schedule the next one. Without this the
                // backoff fires exactly once and the app never recovers on its own.
                scheduleReconnect();
            });
    }, delay);
}

function rejectGeneration(generation: number, reason: string): void {
    for (const [correlationId, request] of [...pendingRequests]) {
        if (request.generation !== generation) continue;
        clearTimeout(request.timeoutId);
        pendingRequests.delete(correlationId);
        request.reject(new Error(reason));
    }
}

/**
 * Handlers are attached when the socket is created, not when it is promoted:
 * the compatibility handshake runs a real request over the *pending* socket, so
 * its responses have to be routed before promotion.
 */
function attachHandlers(connection: Connection): void {
    const { socket, generation } = connection;

    socket.onmessage = (event) => {
        const isCurrent = current?.generation === generation;
        const isPending = pending?.generation === generation;
        // A superseded socket's traffic is not ours any more.
        if (!isCurrent && !isPending) return;

        const raw: unknown = JSON.parse(event.data as string);
        if (typeof raw !== "object" || raw === null) return;
        const data = raw as Record<string, unknown>;

        if (typeof data.correlationId === "string" && pendingRequests.has(data.correlationId)) {
            const request = pendingRequests.get(data.correlationId);
            if (!request) return;
            clearTimeout(request.timeoutId);
            pendingRequests.delete(data.correlationId);
            if (data.error)
                request.reject(
                    new Error(typeof data.error === "string" ? data.error : "Unknown error"),
                );
            else request.resolve(data.payload);
            return;
        }

        // Broadcasts from a socket that is not live yet belong to a backend the
        // stores have not been reset for. Dropping them is the point: delivering
        // one would mix the two backends' records.
        if (!isCurrent) return;
        if (typeof data.type === "string") {
            const listeners = eventListeners.get(data.type);
            if (listeners) for (const listener of listeners) listener(data.payload);
        }
    };

    socket.onclose = () => {
        if (pending?.generation === generation) {
            // A pending socket that died before promotion. Settle whoever is
            // waiting on connectTo, and reject anything sent over it.
            const settle = pendingSettle;
            pending = null;
            pendingSettle = null;
            rejectGeneration(generation, "WebSocket closed");
            settle?.reject(new Error("WebSocket closed before it was ready"));
            return;
        }
        // Only the live connection may report a disconnect or retry. Without
        // this, a socket we deliberately replaced would tear down its successor.
        if (current?.generation !== generation) return;
        rejectGeneration(generation, "WebSocket closed");
        connected = false;
        notifyStatus();
        scheduleReconnect();
    };
}

/**
 * Opens a socket to `origin` and resolves when it is open. The new socket is
 * held aside rather than installed, so `sendRequest` keeps addressing the live
 * connection until the caller promotes this one.
 */
function connectTo(origin: string): Promise<void> {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    abortPending();

    return new Promise((resolve, reject) => {
        const connection: Connection = {
            socket: new WebSocket(origin),
            origin,
            generation: ++generationCounter,
        };
        pending = connection;
        pendingSettle = { resolve, reject };
        attachHandlers(connection);
        connection.socket.onopen = () => {
            pendingSettle = null;
            resolve();
        };
        connection.socket.onerror = () => {
            if (pending === connection) {
                pending = null;
                pendingSettle = null;
            }
            reject(new Error("WebSocket connection error"));
        };
    });
}

/** Installs the pending socket and retires the previous one. */
function promoteConnection(): void {
    if (!pending) return;
    // A reconnect may have been armed while the handshake ran: the old backend
    // can drop mid-switch. Left alone, that timer would later reconnect to the
    // backend we just left and silently promote it, putting the renderer on one
    // backend and Electron main on another.
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    const previous = current;
    current = pending;
    pending = null;
    pendingSettle = null;

    if (previous) {
        rejectGeneration(previous.generation, BACKEND_SWITCHED);
        previous.socket.onclose = null;
        previous.socket.onmessage = null;
        previous.socket.close();
    }

    reconnectAttempt = 0;
    connected = true;
    reconnecting = false;
    notifyStatus();
}

/**
 * Throws away a socket opened by `connectTo` that will not be promoted —
 * a failed handshake, or the user cancelling mid-switch. Settles the
 * `connectTo` promise and rejects anything already sent over that socket, so
 * no caller is left waiting on a connection that no longer exists.
 */
function abortPending(): void {
    if (!pending) return;
    const { socket, generation } = pending;
    const settle = pendingSettle;
    pending = null;
    pendingSettle = null;
    socket.onopen = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.onmessage = null;
    socket.close();
    rejectGeneration(generation, BACKEND_SWITCHED);
    settle?.reject(new Error(BACKEND_SWITCHED));
}
```

Then update `sendRequest`, `sendFireAndForget` and the exports at the bottom of the file:

```ts
/**
 * `usePending` addresses the socket that is open but not yet promoted. Only the
 * compatibility handshake uses it: everything else must go to the live backend.
 */
function sendRequest<T = unknown>(
    type: string,
    payload: unknown = {},
    opts?: { usePending?: boolean },
): Promise<T> {
    return new Promise((resolve, reject) => {
        const connection = opts?.usePending ? pending : current;
        if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
            reject(new Error("WebSocket not connected"));
            return;
        }
        const correlationId = crypto.randomUUID();
        const timeoutId = setTimeout(() => {
            if (pendingRequests.has(correlationId)) {
                pendingRequests.delete(correlationId);
                reject(new Error(`Request timeout: ${type}`));
            }
        }, 30000);
        pendingRequests.set(correlationId, {
            generation: connection.generation,
            resolve: resolve as (value: unknown) => void,
            reject,
            timeoutId,
        });
        const request: WsRequest = { correlationId, type, payload };
        connection.socket.send(JSON.stringify(request));
    });
}

function sendFireAndForget(type: string, payload: unknown = {}): void {
    if (!current || current.socket.readyState !== WebSocket.OPEN) return;
    current.socket.send(JSON.stringify({ type, payload }));
}

export {
    BACKEND_SWITCHED,
    abortPending,
    connectTo,
    getBackendOrigin,
    onEvent,
    onStatusChange,
    promoteConnection,
    sendFireAndForget,
    sendRequest,
};
```

`onEvent` keeps its current body. Delete `connectWebSocket`, `getBackendPort` and `wsPort`.

- [ ] **Step 4: Update the two consumers of the old API**

`packages/ui/src/lib/backend-url.ts` becomes:

```ts
import { getBackendOrigin } from "@/hooks/useWebSocket";

/** URL for the raw bytes of an absolute workspace path, or null before connect. */
function rawFileUrl(absolutePath: string): string | null {
    const origin = getBackendOrigin();
    if (origin === null) return null;
    // The WS origin and the HTTP origin are the same host and port.
    const httpOrigin = origin.replace(/^ws/, "http");
    return `${httpOrigin}/api/file/raw?path=${encodeURIComponent(absolutePath)}`;
}

export { rawFileUrl };
```

In `packages/ui/src/providers/WebSocketProvider.tsx`, replace the body of `connect()` so it uses an origin:

```ts
        async function connect() {
            try {
                setError(null);
                let origin: string;
                if (window.taskflow) {
                    const active = await window.taskflow.getActiveBackend();
                    if (active.origin === null) throw new Error("No backend is running");
                    origin = active.origin.replace(/^http/, "ws");
                } else {
                    const rawPort: string | undefined = import.meta.env.VITE_BACKEND_PORT as
                        | string
                        | undefined;
                    if (!rawPort) {
                        throw new Error(
                            "VITE_BACKEND_PORT must be set when running the renderer outside Electron",
                        );
                    }
                    origin = `ws://localhost:${parseInt(rawPort, 10)}`;
                }
                await connectTo(origin);
                promoteConnection();
                initConnectivity();
            } catch (err) {
                setError(err instanceof Error ? err.message : "Connection failed");
            }
        }
```

Update its imports to `connectTo, promoteConnection, onStatusChange`.

- [ ] **Step 5: Fix the three test files that stub `getBackendPort`**

`packages/ui/src/stores/wiki-store.test.ts:21`, `packages/ui/src/components/panes/MarkdownPaneImpl.anchors.test.tsx:33` and `MarkdownPaneImpl.checkbox.test.tsx:55` stub `getBackendPort: () => 7100`. Change each to `getBackendOrigin: () => "ws://localhost:7100"`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test packages/ui`
Expected: PASS, including the nine new connection tests.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/hooks/useWebSocket.ts packages/ui/src/hooks/useWebSocket.test.ts packages/ui/src/lib/backend-url.ts packages/ui/src/providers/WebSocketProvider.tsx packages/ui/src/stores/wiki-store.test.ts packages/ui/src/components/panes/MarkdownPaneImpl.anchors.test.tsx packages/ui/src/components/panes/MarkdownPaneImpl.checkbox.test.tsx
git commit -m "refactor(ui): let the ws client hold a pending connection alongside the live one"
```

---

### Task 9: Reset and re-bootstrap

A successful switch never goes through a disconnect, which is the whole point — and which is also why every cache that clears itself "on disconnect" would keep serving the previous machine's data.

**Files:**
- Create: `packages/ui/src/stores/store-reset.ts`
- Create: `packages/ui/src/stores/store-reset.test.ts`
- Modify: `packages/ui/src/hooks/useConnectivity.ts:8,31-45`
- Modify: `packages/ui/src/hooks/useAgentAvailability.ts:8-20`
- Modify: `packages/ui/src/hooks/useActiveWorkspace.ts:19-30`
- Modify: `packages/ui/src/lib/open-file.ts:10-27`
- Modify: `packages/ui/src/lib/monaco-import-navigation.ts:9-12`
- Modify: `packages/ui/src/components/settings/CodexModelSelect.tsx:16-17`
- Modify: `packages/ui/src/components/panes/editor-dirty-state.ts`
- Modify: every store module in `packages/ui/src/stores/`

**Interfaces:**
- Consumes: nothing.
- Produces: `registerReset(name: string, reset: () => void): void`, `resetAllState(): void`, `rebootstrap(): Promise<void>`, `registeredResetNames(): string[]`, and `clearAllEditorState(): void` from `editor-dirty-state.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/stores/store-reset.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { join } from "path";
import { registerReset, registeredResetNames, resetAllState } from "./store-reset";

describe("resetAllState", () => {
    test("runs every registered reset", () => {
        const calls: string[] = [];
        registerReset("test-a", () => calls.push("a"));
        registerReset("test-b", () => calls.push("b"));
        resetAllState();
        expect(calls).toEqual(["a", "b"]);
    });

    test("a reset that throws does not stop the others", () => {
        const calls: string[] = [];
        registerReset("test-throws", () => {
            throw new Error("boom");
        });
        registerReset("test-after", () => calls.push("after"));
        resetAllState();
        expect(calls).toContain("after");
    });
});

describe("reset coverage", () => {
    test("every store module registers a reset", async () => {
        const dir = join(import.meta.dir);
        const modules = readdirSync(dir).filter(
            (name) =>
                name.endsWith(".ts") &&
                !name.includes(".test.") &&
                name !== "store-reset.ts" &&
                name !== "rebootstrap.ts" &&
                name !== "session-subscriptions.ts" &&
                name !== "session-helpers.ts",
        );
        for (const module of modules) {
            await import(join(dir, module));
        }
        const registered = new Set(registeredResetNames());
        const missing = modules
            .map((name) => name.replace(/\.ts$/, ""))
            .filter((name) => !registered.has(name));
        expect(missing).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui/src/stores/store-reset.test.ts`
Expected: FAIL — `Cannot find module './store-reset'`.

- [ ] **Step 3: Write the registry**

Create `packages/ui/src/stores/store-reset.ts`:

```ts
/**
 * Switching backends keeps the app connected the whole way through, so nothing
 * observes a disconnect. Every piece of module-level state derived from backend
 * data therefore has to be cleared explicitly, or the new backend inherits the
 * previous machine's records.
 */
const resets = new Map<string, () => void>();

function registerReset(name: string, reset: () => void): void {
    resets.set(name, reset);
}

function registeredResetNames(): string[] {
    return [...resets.keys()];
}

function resetAllState(): void {
    for (const [name, reset] of resets) {
        try {
            reset();
        } catch (error) {
            console.error(`Reset failed for ${name}:`, error);
        }
    }
}

export { registerReset, registeredResetNames, resetAllState };
```

- [ ] **Step 4: Register a reset in every store**

For each module in `packages/ui/src/stores/` other than `store-reset.ts`, `rebootstrap.ts`, `session-subscriptions.ts` and `session-helpers.ts`, add at the bottom of the file, adapting the initial state to that store. For example, in `packages/ui/src/stores/project-store.ts`:

```ts
registerReset("project-store", () => {
    useProjectStore.setState({ projects: [], loading: false, error: null });
});
```

Import `registerReset` from `./store-reset` at the top of each. The initial state is already written at the `create(...)` call in each file — copy those values rather than inventing new ones.

**`setState` is not the whole store.** Several store modules also keep state at
module scope, which `setState` cannot touch and which the coverage test cannot
see. Walk each file for `let`/`const` declared outside `create(...)` and clear
those in the same callback. `file-store.ts:90-95` is the one that bites:

```ts
registerReset("file-store", () => {
    // A FILE_CHANGED event from the old backend can arm this 150 ms debounce
    // (file-store.ts:193) just before the switch. The callback closes over the
    // old machine's `watchedPath` and would run `fetchGitStatus` on it against
    // the new backend.
    if (fileChangeRefreshTimer) clearTimeout(fileChangeRefreshTimer);
    fileChangeRefreshTimer = null;
    pendingChangedDirs.clear();
    diffStoreUnsubscribe?.();
    diffStoreUnsubscribe = null;
    // `fileChangeSubscriptionReady` deliberately stays true: the FILE_CHANGED
    // handler is registered with `onEvent`, which survives a switch by design
    // (Task 8). Resetting it would register a second handler and double every
    // refresh.
    useFileStore.setState({ /* the initial state from create(...) */ });
});
```

- [ ] **Step 5: Make the module-level caches resettable**

`packages/ui/src/hooks/useConnectivity.ts` — replace the guard reset:

```ts
registerReset("connectivity", () => {
    initialized = false;
    online = true;
});
```

`packages/ui/src/hooks/useAgentAvailability.ts` — the existing `clearAgentCache` is exactly the reset:

```ts
registerReset("agent-availability", clearAgentCache);
```

`packages/ui/src/hooks/useActiveWorkspace.ts`:

```ts
registerReset("homedir", () => {
    cachedHomedir = null;
});
```

`packages/ui/src/lib/open-file.ts`:

```ts
registerReset("editors", () => {
    cachedEditors = [];
    fetchPromise = null;
});
```

`packages/ui/src/lib/monaco-import-navigation.ts`:

```ts
registerReset("tsconfig-cache", () => {
    dirTsconfigCache.clear();
    activeTsconfigPath = undefined;
});
```

`packages/ui/src/components/settings/CodexModelSelect.tsx`:

```ts
registerReset("codex-models", () => {
    cachedModels = null;
    pendingModels = null;
});
```

- [ ] **Step 6: Add editor state clearing**

In `packages/ui/src/components/panes/editor-dirty-state.ts`, add and export:

```ts
/** Paths with unsaved edits. Keyed by absolute path only, which is why a
 *  backend switch must not carry them across: two machines routinely hold the
 *  same repository at the same path. */
function dirtyFilePaths(): string[] {
    return [...dirtyModels.entries()].filter(([, dirty]) => dirty).map(([path]) => path);
}

function clearAllEditorState(): void {
    dirtyModels.clear();
    viewStates.clear();
    pendingLines.clear();
}
```

Register it from `packages/ui/src/stores/store-reset.ts`'s consumers rather than in the pane file — add to `packages/ui/src/stores/file-store.ts`, which already owns file concerns:

```ts
registerReset("editor-state", clearAllEditorState);
```

- [ ] **Step 7: Write the re-bootstrap in its own module**

It cannot live in `store-reset.ts`: the hooks it calls import `registerReset`
from there, and importing them back would make the cycle
`store-reset → useConnectivity → store-reset`.

Create `packages/ui/src/stores/rebootstrap.ts`:

```ts
import { prefetchHomedir } from "@/hooks/useActiveWorkspace";
import { initConnectivity } from "@/hooks/useConnectivity";

/**
 * Re-runs the one-shot fetches that populate state at startup. A remount does
 * not do this: they run at module scope, which happens once per page load, so
 * without this the new backend inherits the previous one's connectivity state
 * and home directory.
 */
async function rebootstrap(): Promise<void> {
    initConnectivity();
    prefetchHomedir();
}

export { rebootstrap };
```

`store-reset.test.ts`'s coverage test skips `rebootstrap.ts` — add it to the
exclusion list alongside `store-reset.ts`, since it registers no reset of its
own.

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test packages/ui/src/stores/store-reset.test.ts`
Expected: PASS. The coverage test names any store you missed.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src
git commit -m "feat(ui): add a client state reset registry and re-bootstrap"
```

---

### Task 10: The switch itself

**Files:**
- Create: `packages/ui/src/stores/backend-store.ts`
- Create: `packages/ui/src/stores/backend-store.test.ts`
- Modify: `packages/ui/src/components/AppShell.tsx`

**Interfaces:**
- Consumes: Tasks 7, 8, 9.
- Produces: `useBackendStore` with `{ entries, activeId, isLocal, switching, error, refresh(), switchTo(id), dismissError() }`, and `checkProtocol(info: SystemInfo): { ok: boolean; reason?: string }`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/stores/backend-store.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION } from "@taskflow/shared";
import { checkProtocol } from "./backend-store";

describe("checkProtocol", () => {
    test("accepts an equal version", () => {
        expect(checkProtocol({ editors: [], homedir: "/h", protocolVersion: PROTOCOL_VERSION })).toEqual({
            ok: true,
        });
    });

    test("refuses a different version and names both sides", () => {
        const result = checkProtocol({
            editors: [],
            homedir: "/h",
            protocolVersion: PROTOCOL_VERSION + 1,
        });
        expect(result.ok).toBe(false);
        expect(result.reason).toContain(String(PROTOCOL_VERSION));
        expect(result.reason).toContain(String(PROTOCOL_VERSION + 1));
    });

    test("refuses a backend too old to report a version at all", () => {
        const result = checkProtocol({ editors: [], homedir: "/h" });
        expect(result.ok).toBe(false);
        expect(result.reason).toContain("too old");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui/src/stores/backend-store.test.ts`
Expected: FAIL — `Cannot find module './backend-store'`.

- [ ] **Step 3: Write the store**

Create `packages/ui/src/stores/backend-store.ts`:

```ts
import { create } from "zustand";
import { MSG, PROTOCOL_VERSION } from "@taskflow/shared";
import type { MenuEntry, SystemInfo } from "@taskflow/shared";
import { abortPending, connectTo, promoteConnection, sendRequest } from "@/hooks/useWebSocket";
import { dirtyFilePaths } from "@/components/panes/editor-dirty-state";
import { useFileStore } from "./file-store";
import { rebootstrap } from "./rebootstrap";
import { resetAllState } from "./store-reset";

const LOCAL_ID = "local";

function checkProtocol(info: SystemInfo): { ok: boolean; reason?: string } {
    if (info.protocolVersion === undefined) {
        return {
            ok: false,
            reason: "That backend is too old to report a protocol version. Update it first.",
        };
    }
    if (info.protocolVersion !== PROTOCOL_VERSION) {
        return {
            ok: false,
            reason: `Protocol mismatch: this client speaks ${PROTOCOL_VERSION}, that backend speaks ${info.protocolVersion}. Update the older side.`,
        };
    }
    return { ok: true };
}

interface BackendStore {
    entries: MenuEntry[];
    activeId: string;
    isLocal: boolean;
    /** Bumped on every completed switch. Drives the AppShell remount. */
    generation: number;
    switching: string | null;
    error: string | null;
    /** Set when the last failure was a host-key problem, so the connect dialog
     *  can offer to trust it. Consumed in Task 11. */
    pendingTrust: { id: string; kind: "unknown-host-key" | "changed-host-key" } | null;
    refresh: () => Promise<void>;
    switchTo: (id: string) => Promise<void>;
    dismissError: () => void;
}

const useBackendStore = create<BackendStore>((set, get) => ({
    entries: [{ kind: "local" }],
    activeId: LOCAL_ID,
    isLocal: true,
    generation: 0,
    switching: null,
    error: null,
    pendingTrust: null,

    async refresh() {
        const bridge = window.taskflow;
        if (!bridge) return;
        const [entries, active] = await Promise.all([
            bridge.listBackends(),
            bridge.getActiveBackend(),
        ]);
        set({ entries, activeId: active.id, isLocal: active.isLocal });
    },

    async switchTo(id: string) {
        const bridge = window.taskflow;
        if (!bridge || get().switching !== null || id === get().activeId) return;

        // Dirty models are keyed by absolute path alone and survive an unmount,
        // so carrying them across a switch can show — and then save — one
        // machine's unsaved buffer into the other machine's file.
        const dirty = dirtyFilePaths();
        if (dirty.length > 0) {
            set({
                error: `Save or discard ${dirty.length} unsaved file${dirty.length === 1 ? "" : "s"} before switching backends.`,
            });
            return;
        }

        set({ switching: id, error: null });
        try {
            const activation = await bridge.activateBackend(id);
            if (!activation.ok) {
                const { kind, message } = activation.failure;
                set({
                    switching: null,
                    error: message,
                    pendingTrust:
                        kind === "unknown-host-key" || kind === "changed-host-key"
                            ? { id, kind }
                            : null,
                });
                return;
            }

            const wsOrigin = activation.origin.replace(/^http/, "ws");
            await connectTo(wsOrigin);

            // A WebSocket open proves a server is listening, not that it is a
            // compatible Taskflow. Refuse before anything is torn down.
            const info = await sendRequest<SystemInfo>(MSG.SYSTEM_INFO, {}, { usePending: true });
            const compatible = checkProtocol(info);
            if (!compatible.ok) {
                abortPending();
                // `activateBackend` already opened an ssh tunnel for this id.
                // Nothing is going to promote it, and `retirePreviousTunnel`
                // only ever closes the backend that *was* active, so without
                // this the ssh child lives until the app quits.
                await bridge.cancelActivation(id);
                set({ switching: null, error: compatible.reason ?? "Incompatible backend" });
                return;
            }

            // The backend keeps one chokidar watcher per watched path and drops
            // it only on an explicit unwatch, so this has to go out while the
            // old socket is still open.
            await useFileStore.getState().unwatchAll();

            // Main is told first: everything up to here is still rollback-able
            // by aborting the pending socket, and nothing after promotion is.
            await bridge.setActiveBackend(id, activation.origin);

            promoteConnection();
            resetAllState();
            // Bumping the generation in the SAME synchronous block as the reset
            // is not cosmetic. Every `await` between them yields to the event
            // loop, React renders, and the still-mounted old tree paints itself
            // against stores that were just emptied — a workspace whose task no
            // longer exists, a terminal whose session is gone. Remount first,
            // then do the slow parts.
            set((state) => ({
                switching: null,
                activeId: id,
                isLocal: id === LOCAL_ID,
                generation: state.generation + 1,
            }));
            await rebootstrap();
            // The old tunnel is only safe to kill now that nothing is using it.
            await bridge.retirePreviousTunnel();
            await get().refresh();
        } catch (error) {
            abortPending();
            // Same reasoning as the incompatible-protocol branch: everything
            // that can throw between `activateBackend` and `promoteConnection`
            // leaves a tunnel nobody owns. Swallow a failure to close it — the
            // switch already failed and there is nothing else to report.
            await bridge.cancelActivation(id).catch(() => {});
            set({
                switching: null,
                error: error instanceof Error ? error.message : "Could not switch backend",
            });
        }
    },

    dismissError() {
        set({ error: null, pendingTrust: null });
    },
}));

registerReset("backend-store", () => {
    // The backend list itself must survive a switch — it is what you switched
    // with. Only the transient fields reset.
    useBackendStore.setState({ switching: null, error: null, pendingTrust: null });
});

export { LOCAL_ID, checkProtocol, useBackendStore };
```

That registration is not optional: Task 9's coverage test walks
`packages/ui/src/stores/*.ts` and fails on any module that registers nothing.
Import `registerReset` from `./store-reset` at the top.

- [ ] **Step 4: Add the capability the store assumes**

`file-store` needs `unwatchAll`. In `packages/ui/src/stores/file-store.ts`, add to the store next to `watchPath`:

```ts
    async unwatchAll() {
        const path = get().watchedPath;
        if (!path) return;
        await sendRequest(MSG.FILE_UNWATCH, { path });
        set({ watchedPath: null });
    },
```

Declare it on the store's interface as `unwatchAll(): Promise<void>`.

- [ ] **Step 5: Remount the shell on a completed switch**

In `packages/ui/src/components/AppShell.tsx`, find where the app tree is rendered and wrap it so a completed switch unmounts everything — every xterm, every Monaco model, every pane:

```tsx
const backendGeneration = useBackendStore((s) => s.generation);

return <div key={backendGeneration}>{/* existing tree */}</div>;
```

If `AppShell` already returns a fragment, put the `key` on the outermost real element it renders.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test packages/ui && bun run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/stores/backend-store.ts packages/ui/src/stores/backend-store.test.ts packages/ui/src/stores/file-store.ts packages/ui/src/hooks/useWebSocket.ts packages/ui/src/components/AppShell.tsx
git commit -m "feat(ui): switch the active backend behind a compatibility handshake"
```

---

### Task 11: The menu

**Files:**
- Create: `packages/ui/src/components/sidebar/BackendMenu.tsx`
- Create: `packages/ui/src/components/sidebar/ConnectBackendDialog.tsx`
- Create: `packages/ui/src/components/sidebar/ManageBackendsDialog.tsx`
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx:381-395`

**Interfaces:**
- Consumes: Task 10's `useBackendStore`.
- Produces: `<BackendMenu masterWorkspaceActive onMasterWorkspace />`.

- [ ] **Step 1: Build the menu**

Create `packages/ui/src/components/sidebar/BackendMenu.tsx`. Follow the dropdown pattern already used by `packages/ui/src/components/workspace/AgentDropdownMenu.tsx` — read that file first and reuse its primitives rather than introducing a second menu idiom.

```tsx
import { useEffect, useState } from "react";
import { Loader2, Monitor, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LOCAL_ID, useBackendStore } from "@/stores/backend-store";
import { ConnectBackendDialog } from "./ConnectBackendDialog";
import { ManageBackendsDialog } from "./ManageBackendsDialog";

interface BackendMenuProps {
    masterWorkspaceActive: boolean;
    onMasterWorkspace: () => void;
}

function BackendMenu({ masterWorkspaceActive, onMasterWorkspace }: BackendMenuProps) {
    const entries = useBackendStore((s) => s.entries);
    const activeId = useBackendStore((s) => s.activeId);
    const isLocal = useBackendStore((s) => s.isLocal);
    const switching = useBackendStore((s) => s.switching);
    const refresh = useBackendStore((s) => s.refresh);
    const switchTo = useBackendStore((s) => s.switchTo);
    const [open, setOpen] = useState(false);
    const [connectOpen, setConnectOpen] = useState(false);
    const [manageOpen, setManageOpen] = useState(false);

    // Opening the menu probes, so the list is current rather than up to five
    // seconds old.
    useEffect(() => {
        if (open) void refresh();
    }, [open, refresh]);

    useEffect(() => {
        return window.taskflow?.onBackendsChanged(() => void refresh());
    }, [refresh]);

    const activeEntry = entries.find(
        (entry) => entry.kind !== "local" && entry.record.id === activeId,
    );
    const activeLabel =
        activeEntry === undefined || activeEntry.kind === "local"
            ? "This machine"
            : activeEntry.record.displayName;

    return (
        <>
            <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setOpen((value) => !value)}
                aria-label={`Backend: ${activeLabel}`}
                tooltip={`Backend: ${activeLabel}`}
                tooltipSide="right"
                className={cn(
                    "relative [-webkit-app-region:no-drag]",
                    masterWorkspaceActive ? "text-accent" : "",
                )}>
                {switching !== null ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isLocal ? (
                    <Monitor className="h-3.5 w-3.5" />
                ) : (
                    <Server className="h-3.5 w-3.5" />
                )}
                {!isLocal && (
                    <span className="bg-accent absolute right-0 bottom-0 h-1.5 w-1.5 rounded-full" />
                )}
            </Button>
            {open && (
                <div role="menu" className="bg-popover absolute bottom-8 left-1 z-50 rounded-md border p-1 shadow-md">
                    <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={masterWorkspaceActive}
                        className="hover:bg-accent/20 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs"
                        onClick={() => {
                            onMasterWorkspace();
                            setOpen(false);
                        }}>
                        <span className="w-3">{masterWorkspaceActive ? "✓" : ""}</span>
                        Master Workspace
                    </button>
                    <div className="bg-border my-1 h-px" />
                    {entries.map((entry) => {
                        const id = entry.kind === "local" ? LOCAL_ID : entry.record.id;
                        const label =
                            entry.kind === "local" ? "This machine" : entry.record.displayName;
                        const badge =
                            entry.kind !== "local" && entry.record.instanceId !== "main"
                                ? entry.record.instanceId
                                : null;
                        return (
                            <button
                                key={id}
                                type="button"
                                role="menuitemradio"
                                aria-checked={id === activeId}
                                disabled={switching !== null}
                                className="hover:bg-accent/20 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs"
                                onClick={() => {
                                    void switchTo(id);
                                    setOpen(false);
                                }}>
                                <span className="w-3">{id === activeId ? "✓" : ""}</span>
                                <span className="flex-1 truncate">{label}</span>
                                {badge && (
                                    <span className="text-muted-foreground text-[10px]">{badge}</span>
                                )}
                                <span
                                    className={cn(
                                        "h-1.5 w-1.5 rounded-full",
                                        entry.kind === "unseen" ? "bg-muted-foreground/40" : "bg-green-500",
                                    )}
                                />
                            </button>
                        );
                    })}
                    <div className="bg-border my-1 h-px" />
                    <button
                        type="button"
                        role="menuitem"
                        className="hover:bg-accent/20 w-full rounded px-2 py-1 text-left text-xs"
                        onClick={() => {
                            setConnectOpen(true);
                            setOpen(false);
                        }}>
                        Connect to backend…
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className="hover:bg-accent/20 w-full rounded px-2 py-1 text-left text-xs"
                        onClick={() => {
                            setManageOpen(true);
                            setOpen(false);
                        }}>
                        Manage backends…
                    </button>
                </div>
            )}
            <ConnectBackendDialog open={connectOpen} onOpenChange={setConnectOpen} />
            <ManageBackendsDialog open={manageOpen} onOpenChange={setManageOpen} />
        </>
    );
}

export { BackendMenu };
```

- [ ] **Step 2: Build the connect dialog**

Task 10's store already sets `pendingTrust` when activation fails with a
host-key problem. This dialog is its only consumer.

Create `packages/ui/src/components/sidebar/ConnectBackendDialog.tsx`. Read
`packages/ui/src/components/sidebar/NewProjectDialog.tsx` first and reuse its
`Dialog` primitives and form layout rather than introducing a second idiom.

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useBackendStore } from "@/stores/backend-store";

interface ConnectBackendDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function ConnectBackendDialog({ open, onOpenChange }: ConnectBackendDialogProps) {
    const switchTo = useBackendStore((s) => s.switchTo);
    const refresh = useBackendStore((s) => s.refresh);
    const error = useBackendStore((s) => s.error);
    const pendingTrust = useBackendStore((s) => s.pendingTrust);

    const [host, setHost] = useState("");
    const [user, setUser] = useState("");
    const [sshPort, setSshPort] = useState("");
    const [port, setPort] = useState("");
    const [fingerprint, setFingerprint] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function handleSubmit(): Promise<void> {
        const bridge = window.taskflow;
        if (!bridge || host.trim().length === 0) return;
        setBusy(true);
        try {
            const record = await bridge.addBackend({
                host: host.trim(),
                user: user.trim() || undefined,
                sshPort: sshPort.trim() ? Number.parseInt(sshPort, 10) : undefined,
                port: port.trim() ? Number.parseInt(port, 10) : undefined,
            });
            await refresh();
            await switchTo(record.id);
            // switchTo may have set pendingTrust; only close on a clean switch.
            if (useBackendStore.getState().error === null) onOpenChange(false);
        } finally {
            setBusy(false);
        }
    }

    async function handleShowFingerprint(): Promise<void> {
        const bridge = window.taskflow;
        if (!bridge || !pendingTrust) return;
        setFingerprint(await bridge.getHostFingerprint(pendingTrust.id));
    }

    async function handleTrust(): Promise<void> {
        const bridge = window.taskflow;
        if (!bridge || pendingTrust?.kind !== "unknown-host-key") return;
        setBusy(true);
        try {
            await bridge.trustBackendHost(pendingTrust.id);
            await switchTo(pendingTrust.id);
            if (useBackendStore.getState().error === null) onOpenChange(false);
        } finally {
            setBusy(false);
        }
    }

    if (!open) return null;

    return (
        <div role="dialog" aria-label="Connect to backend" className="...">
            <label>
                Host
                <input value={host} onChange={(e) => setHost(e.target.value)} autoFocus />
            </label>
            <label>
                SSH user
                <input
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    placeholder="your local username"
                />
            </label>
            <label>
                SSH port
                <input value={sshPort} onChange={(e) => setSshPort(e.target.value)} placeholder="22" />
            </label>
            <label>
                Backend port
                <input
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder="resolved over ssh"
                />
            </label>

            {error && <p role="alert">{error}</p>}

            {pendingTrust?.kind === "unknown-host-key" && (
                <div>
                    {fingerprint === null ? (
                        <Button onClick={() => void handleShowFingerprint()}>
                            Show host key fingerprint
                        </Button>
                    ) : (
                        <>
                            <pre>{fingerprint}</pre>
                            <p>
                                Trust this host key? A first-use fingerprint is trusted, not
                                verified — check it against the machine itself if this host came
                                from network discovery.
                            </p>
                            <Button disabled={busy} onClick={() => void handleTrust()}>
                                Trust and connect
                            </Button>
                        </>
                    )}
                </div>
            )}

            {/* A changed host key is exactly what interception looks like, so no
                approval is offered — `error` already carries ssh's message. */}

            <Button disabled={busy || host.trim().length === 0} onClick={() => void handleSubmit()}>
                Connect
            </Button>
        </div>
    );
}

export { ConnectBackendDialog };
```

Replace the placeholder `className="..."` and the bare `label`/`input` elements
with the dialog, `Label` and `Input` components `NewProjectDialog.tsx` uses. The
logic above is the part that matters; the chrome must match the rest of the app.

- [ ] **Step 3: Build the manage dialog**

Create `packages/ui/src/components/sidebar/ManageBackendsDialog.tsx`: a list of saved records with an editable display name, an editable user, an editable ssh port, and a remove button per row, calling `renameBackend` / `addBackend` / `removeBackend` on the bridge and `refresh()` after each.

- [ ] **Step 4: Replace the Monitor button**

In `packages/ui/src/components/sidebar/TaskSidebar.tsx`, delete the `Button` at lines 381-395 and render instead:

```tsx
                    <BackendMenu
                        masterWorkspaceActive={masterWorkspaceActive}
                        onMasterWorkspace={handleMasterWorkspace}
                    />
```

Wrap the surrounding `<div className="flex items-center">` in `relative` so the menu positions against it. Remove the now-unused `Monitor` import.

- [ ] **Step 5: Consume the dropped-tunnel signal**

Task 7 sends `backend-dropped` from main when an ssh child exits on its own, and
nothing reads it yet. In `packages/ui/src/components/AppShell.tsx`, next to the
generation subscription:

```tsx
useEffect(() => {
    return window.taskflow?.onBackendDropped((failure) => {
        useBackendStore.setState({ error: failure.message });
    });
}, []);
```

Render `useBackendStore(s => s.error)` as a dismissible banner above the
workspace, wired to `dismissError()`. The same banner carries switch failures
and the unsaved-files refusal from Task 10, so there is one place errors about
backends appear rather than three.

- [ ] **Step 6: Explain an empty list on macOS**

A denied local-network permission is silent from inside the process: no error,
no datagrams, an empty list — identical to a network with nothing on it. That
makes it the one discovery failure a user cannot diagnose, so the menu says so.
When `entries` holds only the local entry and the platform is macOS, render
below the list:

```tsx
{entries.length === 1 && navigator.platform.startsWith("Mac") && (
    <p className="text-muted-foreground px-2 py-1 text-[10px]">
        No other backends found. If you expected one, check System Settings →
        Privacy &amp; Security → Local Network.
    </p>
)}
```

- [ ] **Step 7: Keep the non-Electron renderer working**

With no `window.taskflow`, `refresh()` returns early and `entries` stays
`[{ kind: "local" }]`. Disable "Connect to backend…" and "Manage backends…" in
that case so they are visible but inert:

```tsx
    const hasBridge = typeof window.taskflow !== "undefined";
```

and put `disabled={!hasBridge}` on both. Verify with `bun run dev:ui` against a
backend started by `bun run dev:backend`: the menu opens, shows one entry, and
nothing throws.

- [ ] **Step 8: Verify by hand**

Run: `bun run dev:backend` in one terminal and `bun run dev:electron` in another.
Expected: the bottom-left icon opens a menu listing Master Workspace and "This machine", both marked. A second machine on the LAN running Taskflow appears within five seconds of opening the menu.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/components/sidebar packages/ui/src/components/AppShell.tsx
git commit -m "feat(ui): replace the master workspace button with a backend menu"
```

---

### Task 12: Remote-mode gating

Everything that assumes the backend's filesystem is this machine's.

**Files:**
- Create: `packages/ui/src/hooks/useBackendIsLocal.ts`
- Create: `packages/ui/src/hooks/useBackendIsLocal.test.tsx`
- Modify: `packages/ui/src/components/sidebar/NewProjectDialog.tsx:24,46`
- Modify: `packages/ui/src/components/sidebar/MissingLocationDialog.tsx:40`
- Modify: `packages/ui/src/components/settings/SettingsModal.tsx:150`
- Modify: `packages/ui/src/components/appearance/ImportTab.tsx:28`
- Modify: `packages/ui/src/components/flows/FlowInputDialog.tsx:34`
- Modify: `packages/ui/src/components/panels/FileContextMenu.tsx:107`
- Modify: `packages/ui/src/components/panes/terminal/terminal-links.ts:64-72`
- Modify: `packages/ui/src/components/panes/TerminalPane.tsx:457-486`

**Interfaces:**
- Consumes: Task 10's `useBackendStore`.
- Produces: `useBackendIsLocal(): boolean`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/hooks/useBackendIsLocal.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test";
import { useBackendStore } from "@/stores/backend-store";
import { backendIsLocal } from "./useBackendIsLocal";

describe("backendIsLocal", () => {
    test("is true for the local backend and false for a remote one", () => {
        useBackendStore.setState({ isLocal: true });
        expect(backendIsLocal()).toBe(true);
        useBackendStore.setState({ isLocal: false });
        expect(backendIsLocal()).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui/src/hooks/useBackendIsLocal.test.tsx`
Expected: FAIL — `Cannot find module './useBackendIsLocal'`.

- [ ] **Step 3: Write the hook**

Create `packages/ui/src/hooks/useBackendIsLocal.ts`:

```ts
import { useBackendStore } from "@/stores/backend-store";

/**
 * False while a backend on another machine is active. Everything that resolves
 * a path on *this* machine and hands it to the backend, or that reveals a
 * backend path in this machine's file manager, is wrong when this is false.
 */
function useBackendIsLocal(): boolean {
    return useBackendStore((state) => state.isLocal);
}

/** Non-hook read, for event handlers outside React's render cycle. */
function backendIsLocal(): boolean {
    return useBackendStore.getState().isLocal;
}

export { backendIsLocal, useBackendIsLocal };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/ui/src/hooks/useBackendIsLocal.test.tsx`
Expected: PASS

- [ ] **Step 5: Gate the picker sites**

In each of `NewProjectDialog.tsx`, `MissingLocationDialog.tsx`, `SettingsModal.tsx`, `ImportTab.tsx` and `FlowInputDialog.tsx`, add `const isLocal = useBackendIsLocal();` and set `disabled={!isLocal}` plus `tooltip={isLocal ? undefined : "Only available on the machine running this backend"}` on the browse button. In `NewProjectDialog.tsx:24`, change the existing capability check:

```ts
    const isLocal = useBackendIsLocal();
    const hasElectronPicker =
        isLocal && typeof window.taskflow?.selectProjectDirectory === "function";
```

- [ ] **Step 6: Gate the reveal sites — and only those**

In `packages/ui/src/components/panels/FileContextMenu.tsx`, disable the "Open with…" and "Reveal in Finder" items when `!useBackendIsLocal()`. Both hand a path to *this* machine's file manager or editor.

**Do not gate `runInShell`.** `packages/ui/src/lib/run-in-shell.ts:27-45` asks the
active backend for its shells over the WebSocket and creates a backend session;
it resolves nothing on the client. Guarding its two call sites in
`Workspace.tsx` (`:250`, `:391`) would make shell actions and package scripts do
nothing at all on a remote backend — silently, since an early return has no UI.
The tell is that `handleRunAction`'s other branch (`Workspace.tsx:261`, plain
`createSession`) needs no guard either: same owner, same backend, same
filesystem. The rule for this whole task is narrower than "anything to do with
files": gate only what resolves or reveals a path on the *client* machine.

`packages/ui/src/components/panes/terminal/terminal-links.ts:64` is the same
problem in a place with no UI to disable: clicking a file path in terminal
output hands it to the *client's* external editor, and on a remote backend that
path is the other machine's. It is not a component, so it takes the non-hook
read:

```ts
function openExternalFile(filePath: string, opts?: { line?: number; col?: number }) {
    // The path came from the backend's output, so it is the backend's
    // filesystem. Opening it locally is only meaningful when they are the same.
    if (!backendIsLocal()) return;
```

`openExternalUrl` in the same file stays as it is — it opens URLs, not paths.

- [ ] **Step 7: Gate both terminal drop paths**

In `packages/ui/src/components/panes/TerminalPane.tsx`, inside the drop handler, immediately before the native-file branch at line 457:

```ts
            // Dropping from Taskflow's own explorer yields a backend path and
            // is fine. These two branches resolve a path on *this* machine,
            // which does not exist on a remote backend.
            if (!backendIsLocal()) return;
```

This single guard covers both the `getPathForFile` branch (457-470) and the `text/uri-list` fallback (474-486), because both sit after the in-app `taskflowPath` early return at 451-456. Verify that ordering before committing — if the uri-list branch ever moves above the in-app branch, the guard has to move with it.

- [ ] **Step 8: Verify and commit**

Run: `bun test && bun run typecheck`
Expected: PASS

```bash
git add packages/ui/src
git commit -m "feat(ui): disable local-filesystem affordances while a remote backend is active"
```

---

### Task 13: Artifact download over the active backend

The last place that reads a backend path with the client's filesystem.

**Files:**
- Modify: `packages/backend/src/api/routes/flow-routes.ts:168`
- Modify: `electron/src/ipc-handlers.ts:99-135`
- Modify: `packages/ui/src/components/flows/FlowPanel.tsx:298`
- Create: `packages/backend/tests/api/flow-artifact-raw.test.ts`

**Interfaces:**
- Consumes: Task 7's `getActiveOrigin`.
- Produces: `GET /api/flow/artifact/:ownerId/:flowId/:type/raw`; `saveArtifact(opts: { url?: string; text?: string; defaultName?: string })`.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/api/flow-artifact-raw.test.ts`. Model the setup on `packages/backend/tests/api/routes.test.ts`, which already builds an `ApiRouter` with fakes — read it first and reuse its `sharedTestDeps`.

```ts
import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("GET /api/flow/artifact/:ownerId/:flowId/:type/raw", () => {
    it("serves an artifact stored outside any workspace root", async () => {
        // /api/file/raw refuses paths outside a project or worktree, but a flow
        // artifact's path comes from an agent via the CLI and is routinely
        // somewhere like /tmp. Authorisation here is "this path was recorded as
        // an artifact of this run", not "this path is inside a workspace".
        const dir = await mkdtemp(join(tmpdir(), "artifact-"));
        const artifactPath = join(dir, "report.md");
        await writeFile(artifactPath, "hello");

        const { router, flowStore } = await buildTestRouter();
        await flowStore.saveFlowRun({
            projectId: "p1",
            flowId: "f1",
            status: "completed",
            currentActionIndex: 0,
            actions: [],
            artifacts: [{ type: "report", path: artifactPath, actionEntryId: "a1" }],
        });

        const response = await router.handle(
            new Request("http://x/api/flow/artifact/p1/f1/report/raw"),
        );
        expect(response?.status).toBe(200);
        expect(await response?.text()).toBe("hello");
    });

    it("404s for a type the run never produced", async () => {
        const { router, flowStore } = await buildTestRouter();
        await flowStore.saveFlowRun({
            projectId: "p1",
            flowId: "f1",
            status: "completed",
            currentActionIndex: 0,
            actions: [],
            artifacts: [],
        });
        const response = await router.handle(
            new Request("http://x/api/flow/artifact/p1/f1/report/raw"),
        );
        expect(response?.status).toBe(404);
    });
});
```

Write `buildTestRouter()` in the same file, following `routes.test.ts`'s construction of `ApiRouter` and `registerApiRoutes`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/backend/tests/api/flow-artifact-raw.test.ts`
Expected: FAIL — the route returns undefined or 404 for the first case.

- [ ] **Step 3: Add the route**

In `packages/backend/src/api/routes/flow-routes.ts`, after the existing `/:ownerId/:flowId/:type` registration at line 168:

```ts
    apiRouter.register(
        "GET",
        "/api/flow/artifact/:ownerId/:flowId/:type/raw",
        async (_req, params) => {
            const run = await flowStore.getFlowRun(params.ownerId, params.flowId);
            if (!run) return errorResponse("Flow run not found", 404);
            const artifacts = flowRunner.getArtifacts(run, params.type);
            const path = artifacts[0]?.path;
            if (!path) return errorResponse("Artifact not found", 404);
            const file = Bun.file(path);
            if (!(await file.exists())) return errorResponse("Artifact file is gone", 404);
            return new Response(file);
        },
    );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/backend/tests/api/flow-artifact-raw.test.ts`
Expected: PASS

- [ ] **Step 5: Rework saveArtifact**

In `electron/src/ipc-handlers.ts`, replace the `copyFile` branch of the `save-artifact` handler:

```ts
                if (typeof opts.url === "string") {
                    const origin = deps.getActiveOrigin();
                    if (!origin) return { success: false, error: "No backend is connected" };
                    const response = await fetch(`${origin}${opts.url}`);
                    if (!response.ok) {
                        return { success: false, error: `Backend returned ${response.status}` };
                    }
                    await writeFile(result.filePath, Buffer.from(await response.arrayBuffer()));
                } else if (typeof opts.text === "string") {
```

Delete the `opts.path` branch and its `startsWith("/")` check — the path never crosses the process boundary now. Add `getActiveOrigin` to `IpcHandlerDeps` and pass it from `main.ts`. Update the preload signature and `env.d.ts` to `saveArtifact(opts: { url?: string; text?: string; defaultName?: string })`.

- [ ] **Step 6: Point the UI at the new endpoint**

In `packages/ui/src/components/flows/FlowPanel.tsx`, at the download click handler (line 298 onward), build the URL from the run's owner and flow rather than passing a path:

```tsx
                                        void window.taskflow?.saveArtifact({
                                            url: `/api/flow/artifact/${ownerId}/${run.flowId}/${encodeURIComponent(a.type)}/raw`,
                                            defaultName,
                                        });
```

`ownerId` is whichever of `taskId`, `projectId` or `"master"` the run carries — the component already has the run in scope; derive it the same way the existing `/api/flow/artifact/:ownerId/:flowId` calls in this file do.

- [ ] **Step 7: Verify**

Run: `bun test && bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/backend packages/ui/src/components/flows/FlowPanel.tsx electron/src packages/ui/src/env.d.ts
git commit -m "feat: download flow artifacts through the active backend"
```

---

### Task 14: End-to-end verification

No new code. This is the pass that catches what unit tests cannot.

- [ ] **Step 1: Full suite**

Run: `bun test && bun run typecheck && bun run lint && bun run build`
Expected: all pass.

- [ ] **Step 2: Confirm the browser bundle is clean**

Run: `grep -rl "node:dgram\|child_process" packages/ui/dist/assets || echo "clean"`
Expected: `clean`. A hit means the shared barrel is re-exporting the discovery socket module.

- [ ] **Step 3: Confirm multicast survives `bun build --compile`**

`node:dgram` multicast is verified working under `bun run` on Bun 1.4.0, but the
backend ships as a compiled single binary and Bun documents `node:dgram` as
implemented without full Node test-suite coverage. This is the one unproven
assumption in the discovery design.

Run: `bun run build:backend:bin`
Then start `packages/backend/dist/taskflow-backend` directly and, from a second
terminal on the same machine, run the listener half:

```bash
bun -e 'import {createListener} from "@taskflow/shared/discovery";
const l = createListener({onChange: (e) => console.log(e.map(x => x.hostname + ":" + x.port))});
await l.start(); l.probe(); setTimeout(() => process.exit(0), 3000);'
```

Expected: the compiled backend appears within three seconds. If it does not, the
fallback named in the spec is moving the advertise side to a probe response over
the existing HTTP server — do not paper over it by shipping discovery that only
works in development.

- [ ] **Step 4: Confirm the backend is off the LAN**

With the app running, from another machine on the same network:

Run: `curl --max-time 3 http://<this-machine-ip>:<backend-port>/`
Expected: connection refused. A `Taskflow backend` response means Task 1 regressed and discovery is advertising an open door.

- [ ] **Step 5: Two-machine switch**

On machine B, run Taskflow. On machine A, open the backend menu: B appears within five seconds. Switch to it and confirm: B's projects and tasks appear, a session opens and streams, the theme becomes B's, "Add project" is disabled, and dropping a Finder file into a terminal does nothing. Switch back and confirm A's records return with no trace of B's.

- [ ] **Step 6: Confirm the failure paths**

- Switch to a host that is up but not running Taskflow → "Taskflow is not running on …".
- Switch to a host whose key is not in `known_hosts` → fingerprint dialog; approving connects.
- Open a file, type into it without saving, then try to switch → refused, naming the unsaved file.
- Pull the network while a remote backend is active → disconnected banner; restoring the network reconnects.
- Switch to a backend running an incompatible `PROTOCOL_VERSION` → refused with both
  numbers named, and `pgrep -fl "ssh -N -L"` shows no ssh child left behind. The
  leak this checks for is invisible from the UI, so check the process list.

- [ ] **Step 6b: Confirm what still works remotely**

The gating in Task 12 is deliberately narrow, and the failure mode of getting it
wrong is silence rather than an error. On a remote backend:

- Run a shell action and a package.json script from the workspace → both open a
  session on the *remote* machine. If either does nothing, a `runInShell` guard
  was added back.
- Click a file path in terminal output → nothing happens (correct: that path is
  the other machine's).
- Drag a Finder file onto a terminal → nothing happens.

- [ ] **Step 6c: Confirm discovery follows its setting**

- With machine B visible in A's menu, turn off Settings → General → "Discoverable
  on this network" on B. Within 15 seconds B's entry in A's menu goes grey
  (saved-but-unseen), with no restart of either side.
- Turn it back on → B goes green again within five seconds of A opening the menu.
- Set B's "Name on the network" to something else → A's menu shows the new name
  on the next announce.
- Connect to a backend discovered on the LAN that has never been saved before →
  it connects. A blank ssh user here is what makes ssh print its usage banner and
  exit 255, which the classifier can only report as "SSH exited with code 255".

- [ ] **Step 7: Confirm the caches actually cleared**

After a switch, open the new-session agent picker and the external-editor menu. Both must list what is installed on the machine you switched *to*. This is the check the unit tests approximate; the caches are the most likely thing to be quietly wrong.

- [ ] **Step 8: Commit any fixes**

```bash
git add -A
git commit -m "fix: address multi-backend end-to-end findings"
```

---

## Deferred

Out of scope for this plan, recorded so nobody adds them on the way past: showing several backends' records in one view; keeping non-active backends connected for notifications; per-client session viewports; creating or repairing projects on a remote host; the TUI adopting the discovery listener.
