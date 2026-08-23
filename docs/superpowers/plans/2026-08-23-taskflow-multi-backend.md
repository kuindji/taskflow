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

**Three judgment calls, settled 2026-08-23 — do not re-litigate them.**

- **A switch is refused while any editor is dirty** (Task 10). Dirty Monaco
  models are keyed by absolute path alone, so carrying them across would show,
  and then save, one machine's unsaved buffer into the other machine's file.
  Save-or-discard first is the accepted cost; no confirm dialog, no silent
  discard.
- **Startup always begins on the local backend.** `activeId` is persisted for
  menu ordering only. Auto-reconnecting would make app launch wait on ssh and
  fail whenever the other machine is asleep.
- **Task 6 ships with no unit tests.** Every branch there is a real `ssh`
  process; the testable parts were extracted into Task 5, which is tested, and
  Task 14 covers the rest by hand. Do not add a spawn-injection seam for it.

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `packages/shared/src/types/backend.ts` | `BeaconAnnounce`, `BeaconProbe`, `DiscoveredBackend`, `BackendRecord`, `TunnelFailure` |
| `packages/shared/src/discovery/beacon.ts` | Pure datagram codec and staleness. No I/O |
| `packages/shared/src/discovery/socket.ts` | Advertiser and listener over `node:dgram` |
| `packages/shared/src/discovery/index.ts` | Barrel for the `./discovery` package export |
| `electron/src/backend-records.ts` | Record list operations and the parser for `backends.json`. No Electron, no fs; `node:os` only, for a default ssh user |
| `electron/src/backend-registry.ts` | Persistence of records + active id; discovery listener |
| `electron/src/tunnel-args.ts` | Pure `buildTunnelArgs` and `classifyTunnelFailure` |
| `electron/src/tunnel-manager.ts` | Spawns and supervises `ssh`; readiness probe; known_hosts |
| `packages/ui/src/stores/store-reset.ts` | Registry of reset callbacks |
| `packages/ui/src/stores/backend-store.ts` | Renderer mirror of the registry; orchestrates the switch |
| `packages/ui/src/hooks/useBackendIsLocal.ts` | One hook the gating sites read |
| `packages/ui/src/components/sidebar/BackendMenu.tsx` | The dropdown |
| `packages/ui/src/components/sidebar/ConnectBackendDialog.tsx` | Manual host entry |
| `packages/ui/src/components/sidebar/ManageBackendsDialog.tsx` | Rename / edit / remove |
| `packages/ui/src/components/sidebar/TrustHostKeyDialog.tsx` | Host-key fingerprint and approval, mounted off `pendingTrust` |

**Modified files**

| Path | Change |
|---|---|
| `packages/backend/src/ws/server.ts` | Bind `127.0.0.1` |
| `packages/backend/src/config.ts` | Add `instancePortFile`; reduce `instanceId` to one safe label |
| `packages/backend/src/index.ts` | Write/remove the instance port file; `protocolVersion` on `SYSTEM_INFO`; start the advertiser |
| `packages/shared/src/constants.ts` | `PROTOCOL_VERSION`, discovery constants |
| `packages/ui/src/components/settings/sections/GeneralSection.tsx` | Discoverable switch and network name |
| `packages/shared/src/types/system.ts` | `hostname` and `protocolVersion` on `SystemInfo` |
| `packages/shared/src/types/settings.ts` | `NetworkSettings` |
| `packages/backend/src/services/settings-store.ts` | `network` defaults, merge, and an update notification so the beacon follows the setting |
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
    /** The backend machine's hostname. What the network name setting falls back
     *  to, and the only way the renderer can name the machine it is talking to. */
    hostname: string;
    /** Absent on a backend older than the multi-backend feature. Treat as incompatible. */
    protocolVersion?: number;
}
```

In `packages/backend/src/index.ts`, change the `SYSTEM_INFO` registration at line 416:

```ts
        router.register(MSG.SYSTEM_INFO, async () => ({
            editors,
            homedir: homedir(),
            hostname: hostname(),
            protocolVersion: PROTOCOL_VERSION,
        }));
```

Add `PROTOCOL_VERSION` to the existing `@taskflow/shared` import in that file, and `hostname` to the existing `os` import (the file already imports `homedir` from it).

`hostname` is required rather than optional: an older backend fails the protocol
check before anything reads it, so there is no version of the app that has to
cope with it missing.

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
`buildDataPaths(initialDataDir, instanceId)` (`config.ts:78`) therefore points it
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
data directory."
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
import {
    DISCOVERY_MAX_DATAGRAM_BYTES,
    DISCOVERY_MAX_DISPLAY_NAME,
    PROTOCOL_VERSION,
} from "../constants";
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

    // The test above says what happens to an oversized name; this one is what
    // stops a user producing one. `DISCOVERY_MAX_DISPLAY_NAME` bounds the field
    // and `DISCOVERY_MAX_DATAGRAM_BYTES` bounds the datagram, and nothing else
    // ties the two together — raise the first without checking the second and
    // the symptom is a machine that silently stops appearing in other clients'
    // menus. Multi-byte characters, because the cap counts bytes and the input
    // counts UTF-16 code units.
    test("the longest permitted display name still fits in a datagram", () => {
        const bytes = encodeAnnounce({
            ...announce,
            displayName: "é".repeat(DISCOVERY_MAX_DISPLAY_NAME),
        });
        expect(bytes.byteLength).toBeLessThanOrEqual(DISCOVERY_MAX_DATAGRAM_BYTES);
        expect(parseDatagram(bytes)).not.toBeNull();
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
/** How often multicast memberships are reconciled against the machine's
 *  interfaces. From the spec: cheap polling instead of per-platform link-state
 *  watching (`specs/2026-08-23-taskflow-multi-backend-design.md:186-188`). */
export const MEMBERSHIP_REFRESH_MS = 30_000;
/** Datagrams larger than this are rejected without parsing. */
export const DISCOVERY_MAX_DATAGRAM_BYTES = 1_024;
/**
 * Longest `network.displayName` that may reach a beacon.
 *
 * Without a bound this field is the one piece of an announcement a user can
 * make arbitrarily long, and `parseDatagram` drops anything over
 * `DISCOVERY_MAX_DATAGRAM_BYTES` **before** parsing — so a pasted paragraph in
 * Settings → "Name on the network" does not produce an error anywhere. The
 * backend keeps serving, keeps announcing, and simply stops being parseable:
 * the machine vanishes from every other client's menu with nothing logged on
 * either side. The codec test at Step 3 ("returns null for a datagram larger
 * than the cap") is that outcome, written down.
 *
 * 64 is well past any real machine name and leaves the rest of the payload —
 * hostname, instance id, app version, os, port — several hundred bytes of room
 * inside a 1 KiB datagram.
 */
export const DISCOVERY_MAX_DISPLAY_NAME = 64;
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
    /**
     * Who owns `host`. `"manual"` means the user typed it and nothing may
     * rewrite it; `"discovery"` means it is the source address of a beacon and
     * tracking the beacon is the point. See `mergeForMenu` for why this is not
     * optional: the merged record is what `findRecord` returns and what
     * `activateBackend` persists, so without it a beacon overwrites a typed
     * hostname on disk and there is no dialog that can put it back.
     */
    hostSource: "manual" | "discovery";
    /**
     * A backend port the user typed into the connect dialog. Authoritative and
     * never overwritten — the spec makes leaving the field blank the trigger
     * for port-file resolution, so a filled-in field means "do not resolve"
     * (`specs/2026-08-23-taskflow-multi-backend-design.md:534-536`). Kept apart
     * from `lastKnownPort` because the two have opposite trust levels and
     * merging them makes an override indistinguishable from a stale cache.
     */
    manualPort: number | null;
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
- Modify: `packages/backend/src/services/settings-store.ts:95`, `:118`, `:278`, and the `SettingsStore` class (an update notification, used by both the WS handler and `PATCH /api/settings`)
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
    MEMBERSHIP_REFRESH_MS,
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

/**
 * Keeps `socket`'s multicast memberships in step with the machine's interfaces,
 * and returns the timer that goes on doing so.
 *
 * A one-shot join at bind time is not enough, and the failure is invisible from
 * the inside. `addMembership` is per interface, and an interface that did not
 * exist when we bound is one we never joined: start Taskflow before the laptop
 * is on Wi-Fi — closing the lid, a VPN coming up, docking, a restart in a cafe
 * before the network is picked — and the listener stays joined to nothing.
 *
 * What makes it hard to diagnose is that it is one-directional. `sendToGroup`
 * re-enumerates `localIPv4Addresses()` on every call, so *announcing* starts
 * using a new interface immediately: this machine appears in everyone else's
 * backend menu while their machines never appear in its own, and probes sent
 * to wake them up are answered into a socket that is not listening on that
 * interface. The user sees a permanently empty list on the one machine, is
 * told by the macOS hint that it might be a local-network permission problem,
 * and restarting the app fixes it — which is the worst possible signal,
 * because it makes the bug look intermittent.
 *
 * `specs/2026-08-23-taskflow-multi-backend-design.md:186-188` calls for exactly
 * this and sets the interval: recompute when `os.networkInterfaces()` changes,
 * polled every 30 seconds rather than watching link state per platform.
 */
function keepMembershipsCurrent(socket: dgram.Socket): ReturnType<typeof setInterval> {
    // The addresses we have successfully joined. Not "the addresses that
    // existed last time we looked" — a join that throws must be retried on the
    // next tick, because the common reason is an interface that is up but not
    // yet configured, which resolves itself a second later.
    const joined = new Set<string>();

    function refresh(): void {
        const addresses = localIPv4Addresses();
        if (addresses.length === 0) {
            // No usable interface. Join the OS-chosen one so a loopback-only
            // machine still hears something, and leave `joined` empty so the
            // real interfaces are picked up the moment they appear.
            try {
                socket.addMembership(DISCOVERY_GROUP);
            } catch {
                // Discovery is unavailable; manual connect still works.
            }
            return;
        }
        for (const address of addresses) {
            if (joined.has(address)) continue;
            try {
                socket.addMembership(DISCOVERY_GROUP, address);
                joined.add(address);
            } catch {
                // One interface refusing the join must not take down the
                // others, and must not stop us retrying it next tick.
            }
        }
        for (const address of [...joined]) {
            if (addresses.includes(address)) continue;
            joined.delete(address);
            try {
                socket.dropMembership(DISCOVERY_GROUP, address);
            } catch {
                // The interface is already gone; the kernel dropped the
                // membership with it. Nothing to do, and nothing to report.
            }
        }
    }

    refresh();
    const timer = setInterval(refresh, MEMBERSHIP_REFRESH_MS);
    // `unref` so this timer alone never holds the backend process open.
    timer.unref?.();
    return timer;
}

/**
 * `onFailed` is not optional, and swallowing the error here was a bug rather
 * than a simplification. `bind(port, callback)` only calls back on success, so
 * a bind that fails emits `error` and the surrounding promise never settles.
 * The backend `await`s `advertiser.start()` during boot
 * (`applyNetworkSettings`), so a failed bind wedged startup **after** the HTTP
 * server was already listening: the app half-starts, nothing is logged, and the
 * spec's rule that discovery failure is non-fatal
 * (`specs/2026-08-23-taskflow-multi-backend-design.md:197`) is violated in the
 * worst available way.
 */
function bindDiscoverySocket(
    onMessage: (bytes: Uint8Array, address: string) => void,
    onFailed: (error: Error) => void,
) {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    socket.on("message", (message, rinfo) => onMessage(message, rinfo.address));
    socket.on("error", onFailed);
    return socket;
}

/**
 * Shared by both `start` implementations. Settles the promise once, drops the
 * socket reference so a later `start` retries rather than short-circuiting on
 * the idempotence guard, and says so out loud — a silently absent beacon is the
 * one discovery failure nobody can diagnose, which is why Task 11 has to
 * explain an empty menu to macOS users at all.
 *
 * Both call sites wrap this as `(error) => discoveryFailureHandler(bound, …)(error)`
 * rather than calling it directly in the argument list. That is deliberate and
 * not a simplification opportunity: `bound` is the `const` being initialised by
 * the very `bindDiscoverySocket` call this handler is an argument to, so
 * reading it eagerly is a temporal-dead-zone `ReferenceError`. The arrow defers
 * the read until the error actually fires, by which point `bound` is assigned.
 */
function discoveryFailureHandler(
    socket: dgram.Socket,
    clear: () => void,
    settle: () => void,
): (error: Error) => void {
    return (error) => {
        console.warn("Taskflow LAN discovery is unavailable:", error.message);
        clear();
        try {
            socket.close();
        } catch {
            // Throws when the socket never finished binding, which is the case
            // this handler exists for.
        }
        settle();
    };
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
    let membershipTimer: ReturnType<typeof setInterval> | null = null;
    /** The current `start()`'s resolver while its bind is still in flight. */
    let pendingSettle: (() => void) | null = null;

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
                // Settled at most once: a socket can fail its bind and then be
                // closed, and both would otherwise call through.
                let settled = false;
                const settle = () => {
                    if (settled) return;
                    settled = true;
                    resolve();
                };
                const bound: dgram.Socket = bindDiscoverySocket(
                    (bytes) => {
                        const message = parseDatagram(bytes);
                        if (message && "probe" in message) announceNow();
                    },
                    (error) =>
                        discoveryFailureHandler(
                            bound,
                            () => {
                                socket = null;
                                if (timer) clearInterval(timer);
                                timer = null;
                                if (membershipTimer) clearInterval(membershipTimer);
                                membershipTimer = null;
                            },
                            settle,
                        )(error),
                );
                socket = bound;
                pendingSettle = settle;
                bound.bind(DISCOVERY_PORT, () => {
                    // A `stop()` between the bind call and this callback has
                    // already closed and cleared the socket; binding a closed
                    // socket's handlers back up would resurrect it.
                    if (socket !== bound) return;
                    pendingSettle = null;
                    bound.setMulticastTTL(DISCOVERY_TTL);
                    membershipTimer = keepMembershipsCurrent(bound);
                    announceNow();
                    timer = setInterval(announceNow, ANNOUNCE_INTERVAL_MS);
                    settle();
                });
            });
        },
        stop() {
            if (timer) clearInterval(timer);
            timer = null;
            if (membershipTimer) clearInterval(membershipTimer);
            membershipTimer = null;
            try {
                socket?.close();
            } catch {
                // `close` on a socket that never finished binding throws
                // ERR_SOCKET_DGRAM_NOT_RUNNING. Stopping is still the answer.
            }
            socket = null;
            // A `stop()` while the bind is still pending would otherwise leave
            // `start()`'s promise unsettled forever. Verified on Node 22.14:
            // `bind(port, cb)` followed immediately by `close()` emits `close`
            // and **neither** the bind callback nor an `error`, so nothing else
            // in this function can settle it. The backend `await`s
            // `advertiser.start()` inside `applyNetworkSettings`, so an
            // unsettled promise there is the same wedged boot round 12 fixed
            // for the bind-failure case, reached from the other side.
            pendingSettle?.();
            pendingSettle = null;
        },
    };
}

function createListener(opts: {
    onChange: (entries: DiscoveredBackend[]) => void;
}): DiscoveryListener {
    const seen = new Map<string, DiscoveredBackend>();
    let socket: dgram.Socket | null = null;
    let sweepTimer: ReturnType<typeof setInterval> | null = null;
    let membershipTimer: ReturnType<typeof setInterval> | null = null;
    /** As in the advertiser: the current `start()`'s resolver while its bind is
     *  still in flight, so `stop()` can settle it. */
    let pendingSettle: (() => void) | null = null;

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
            // Same guard as the advertiser, for the same reason: `start` is
            // documented as idempotent, and without this a second call would
            // overwrite `socket` and leak the first one, still joined to the
            // group and still delivering into a map nothing reads.
            if (socket) return Promise.resolve();
            return new Promise((resolve) => {
                let settled = false;
                const settle = () => {
                    if (settled) return;
                    settled = true;
                    resolve();
                };
                const bound: dgram.Socket = bindDiscoverySocket((bytes, address) => {
                    const message = parseDatagram(bytes);
                    if (!message || "probe" in message) return;
                    const id = backendIdFor(message.hostname, message.instanceId);
                    const existing = seen.get(id);
                    // A datagram for a known id from a *different* address is
                    // one of two things, and they need opposite handling:
                    //
                    //   - one machine that changed address (DHCP, Wi-Fi to
                    //     Ethernet). The old address goes quiet, so the entry
                    //     should follow the new one immediately — otherwise the
                    //     menu keeps offering a dead ssh target until the entry
                    //     ages out.
                    //   - two machines answering to the same hostname and
                    //     instance. Both keep announcing, so letting the last
                    //     datagram win would make the entry's address flap every
                    //     five seconds and the tunnel would target whichever
                    //     announced most recently.
                    //
                    // Whether the incumbent is still announcing separates them.
                    // Two missed announcements is the threshold: one dropped
                    // datagram is normal on a multicast group.
                    if (
                        existing &&
                        existing.address !== address &&
                        Date.now() - existing.lastSeenAt < ANNOUNCE_INTERVAL_MS * 2
                    ) {
                        return;
                    }
                    seen.set(id, { ...message, address, lastSeenAt: Date.now() });
                    opts.onChange(live());
                },
                (error) =>
                    discoveryFailureHandler(
                        bound,
                        () => {
                            socket = null;
                            if (sweepTimer) clearInterval(sweepTimer);
                            sweepTimer = null;
                            if (membershipTimer) clearInterval(membershipTimer);
                            membershipTimer = null;
                            // The menu must not keep offering machines this
                            // listener can no longer hear from.
                            seen.clear();
                            opts.onChange(live());
                        },
                        settle,
                    )(error),
                );
                socket = bound;
                pendingSettle = settle;
                bound.bind(DISCOVERY_PORT, () => {
                    if (socket !== bound) return;
                    pendingSettle = null;
                    bound.setMulticastTTL(DISCOVERY_TTL);
                    membershipTimer = keepMembershipsCurrent(bound);
                    sweepTimer = setInterval(sweep, ANNOUNCE_INTERVAL_MS);
                    settle();
                });
            });
        },
        stop() {
            if (sweepTimer) clearInterval(sweepTimer);
            sweepTimer = null;
            if (membershipTimer) clearInterval(membershipTimer);
            membershipTimer = null;
            try {
                socket?.close();
            } catch {
                // As in the advertiser: `close` before the bind completes throws
                // ERR_SOCKET_DGRAM_NOT_RUNNING. `stopBackendRegistry` runs from
                // Electron's `will-quit`, where a throw is not worth taking the
                // quit down for.
            }
            socket = null;
            seen.clear();
            pendingSettle?.();
            pendingSettle = null;
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

In `packages/backend/src/index.ts`, after the port files are written, add
(importing `DISCOVERY_MAX_DISPLAY_NAME` from `@taskflow/shared` alongside
`PROTOCOL_VERSION`):

```ts
        let network = (await settingsStore.get()).network;

        const advertiser = createAdvertiser({
            payload: () => ({
                v: 1 as const,
                protocolVersion: PROTOCOL_VERSION,
                instanceId: config.instanceId,
                hostname: hostname(),
                // Clamped here as well as in the Settings input, because
                // `settings.json` is a file a user can edit and this is the
                // last point before the bytes go on the wire. Over the cap the
                // whole announcement becomes unparsable and this backend
                // silently disappears from every other machine's menu.
                displayName: (network.displayName.trim() || hostname()).slice(
                    0,
                    DISCOVERY_MAX_DISPLAY_NAME,
                ),
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

`resolveJsonModule` is already on in `tsconfig.base.json:10`.

In the `shutdown` handler, before the port file removal:

```ts
            advertiser.stop();
```

- [ ] **Step 9b: Let the setting actually reach the advertiser**

`applyNetworkSettings` is useless without something calling it on a settings
update. The hook goes on the store, not on a handler: settings are written from
two places — `MSG.SETTINGS_UPDATE`
(`packages/backend/src/handlers/settings.ts:36-39`) and `PATCH /api/settings`
(`packages/backend/src/api/routes/settings-routes.ts:59-67`) — and both call
`settingsStore.update`. Patching only the WebSocket handler leaves the beacon
running after the REST route turns `discoverable` off.

In `packages/backend/src/services/settings-store.ts`, inside the `SettingsStore`
class:

```ts
    private updateListeners = new Set<(settings: AppSettings) => void>();

    onUpdated(listener: (settings: AppSettings) => void): void {
        this.updateListeners.add(listener);
    }
```

and at the end of `update()`. Note that `update()` currently ends
`return this.get()` (`settings-store.ts:357-360`) — it re-reads so deleted keys
fall back to defaults. Listeners must get *that* object, not the pre-defaults
`current`:

```ts
        const settings = await this.get();
        for (const listener of this.updateListeners) listener(settings);
        return settings;
``` In
`index.ts`, next to the advertiser:

```ts
        settingsStore.onUpdated((settings) => void applyNetworkSettings(settings.network));
```

- [ ] **Step 9c: Expose both fields in Settings**

Without this the two fields are reachable only by hand-editing
`~/.config/taskflow/settings.json`, and the spec describes `discoverable` as
something a user turns off (`specs/2026-08-23-taskflow-multi-backend-design.md:167-169`)
and `displayName` as something they override (`:162`).

Add two rows to `packages/ui/src/components/settings/sections/GeneralSection.tsx`,
following the `Ask before exit` row already there (`GeneralSection.tsx:84-95`):

Import the cap at the top of the file:
`import { DISCOVERY_MAX_DISPLAY_NAME } from "@taskflow/shared";`

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
                    // Not cosmetic. Past this length the announcement exceeds
                    // `DISCOVERY_MAX_DATAGRAM_BYTES` and every listener drops
                    // it unparsed, so this machine quietly stops appearing in
                    // other clients' menus with no error anywhere. Stopping the
                    // keystroke is the only feedback that arrives in time; the
                    // advertiser clamps too, for names that got in by other
                    // routes.
                    maxLength={DISCOVERY_MAX_DISPLAY_NAME}
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
git add packages/shared packages/backend/src/index.ts packages/backend/src/services/settings-store.ts packages/ui/src/components/settings/sections/GeneralSection.tsx packages/ui/src/components/settings/SettingsModal.tsx
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
- Produces: `upsertRecord`, `removeRecord`, `recordFromDiscovered`, `matchesDiscovered`, `mergeForMenu`, `normalizeRecords`, and the `MenuEntry` type. `sameHost` stays module-private. There is deliberately no `renameRecord`: the Manage dialog edits three fields, and `upsertRecord` covers all of them at once without a second way to write a record.

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
    normalizeRecords,
    recordFromDiscovered,
    removeRecord,
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
    hostSource: "discovery",
    manualPort: null,
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

describe("removeRecord", () => {
    test("remove drops the matching record", () => {
        expect(removeRecord([saved], "desktop:main")).toHaveLength(0);
    });
});

describe("normalizeRecords", () => {
    test("a record written before manualPort existed does not resolve to an undefined port", () => {
        // `resolveBackendPort` tests `manualPort !== null`, so `undefined` here
        // short-circuits resolution and hands ssh `-L …:127.0.0.1:undefined`.
        const { manualPort: _gone, ...legacy } = saved;
        expect(normalizeRecords([legacy])[0]?.manualPort).toBeNull();
    });

    test("a missing hostSource is inferred from whether the id was derived from the host", () => {
        const { hostSource: _gone, ...legacy } = saved;
        // Discovered: id is keyed on the announced hostname, host is the address.
        expect(normalizeRecords([legacy])[0]?.hostSource).toBe("discovery");
        // Manual: `addBackend` builds the id out of the host that was typed.
        const typed = { ...legacy, id: "devbox:main", host: "devbox" };
        expect(normalizeRecords([typed])[0]?.hostSource).toBe("manual");
    });

    test("an explicit hostSource is kept and a record with no id is dropped", () => {
        expect(normalizeRecords([{ ...saved, hostSource: "manual" }])[0]?.hostSource).toBe("manual");
        const { id: _gone, ...headless } = saved;
        expect(normalizeRecords([headless])).toEqual([]);
        expect(normalizeRecords("not an array")).toEqual([]);
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

    test("a record added by name, with or without .local, is that same machine too", () => {
        for (const host of ["desktop", "desktop.local", "DESKTOP"]) {
            const byName: BackendRecord = { ...saved, id: `${host}:main`, host };
            const entries = mergeForMenu([byName], [discovered], 1_500, [], "kuindji");
            expect(entries.map((e) => e.kind)).toEqual(["local", "live"]);
        }
    });

    test("a different machine on the same subnet is not folded in", () => {
        const other: BackendRecord = { ...saved, id: "laptop:main", host: "laptop" };
        const entries = mergeForMenu([other], [discovered], 1_500, [], "kuindji");
        expect(entries.map((e) => e.kind)).toEqual(["local", "live", "unseen"]);
    });

    test("a stale beacon does not count as live", () => {
        const entries = mergeForMenu([saved], [discovered], 30_000, [], "kuindji");
        expect(entries.map((e) => e.kind)).toEqual(["local", "unseen"]);
    });

    test("a manual port survives the beacon refreshing the record", () => {
        // `manualPort` is an instruction, not a cache. The menu refresh rewrites
        // `lastKnownPort` from every announce, and a spread that dropped
        // `manualPort` on the way through would silently turn the user's
        // override back into port-file resolution on the next connect.
        const pinned = { ...saved, manualPort: 51000, lastKnownPort: null };
        const entries = mergeForMenu([pinned], [discovered], 1_500, [], "kuindji");
        expect(recordAt(entries, 1).manualPort).toBe(51000);
        expect(recordAt(entries, 1).lastKnownPort).toBe(54892);
    });

    test("a typed hostname is not rewritten to the beacon's address", () => {
        // The merged record is what `findRecord` returns and what
        // `activateBackend` persists, so a rewrite here reaches disk. A record
        // added by typing `desktop` matches its own beacon on id, and losing
        // the name it was added under breaks it everywhere the address does
        // not route — with no dialog that can put the name back.
        const typed = { ...saved, host: "desktop", hostSource: "manual" as const };
        const entries = mergeForMenu([typed], [discovered], 1_500, [], "kuindji");
        expect(recordAt(entries, 1).host).toBe("desktop");
        // The port still follows the beacon; only `host` is pinned.
        expect(recordAt(entries, 1).lastKnownPort).toBe(discovered.port);
    });

    test("a discovered record's host does follow the beacon", () => {
        // DHCP moved the machine. Nothing typed this address, so tracking it is
        // the whole point of keeping the record.
        const moved = { ...discovered, address: "192.168.1.44" };
        const entries = mergeForMenu([saved], [moved], 1_500, [], "kuindji");
        expect(recordAt(entries, 1).host).toBe("192.168.1.44");
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
import { userInfo } from "node:os";
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
        hostSource: "discovery",
        // Discovery is the opposite of a manual entry: nothing was typed.
        manualPort: null,
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

/**
 * Whether a saved record and a live beacon are the same backend. Two ids
 * describe one machine: `addBackend` keys by the host string the user typed,
 * a beacon keys by the hostname the machine announces. Matching on the record
 * id alone shows that machine twice — once live, once unseen — and the saved
 * row never picks up the port from the beacon.
 */
function matchesDiscovered(record: BackendRecord, entry: DiscoveredBackend): boolean {
    if (record.id === backendIdFor(entry.hostname, entry.instanceId)) return true;
    if (record.instanceId !== entry.instanceId) return false;
    return sameHost(record.host, entry);
}

/**
 * A record's host is whatever the user typed or the beacon's source address:
 * `192.168.1.20`, `desktop`, or `desktop.local`. A beacon carries both the
 * address it came from and the machine's own short hostname. Compare against
 * both, and treat the mDNS suffix as noise — otherwise a host added as
 * `desktop.local` sits in the menu as permanently unseen next to its own live
 * beacon.
 */
function sameHost(host: string, entry: DiscoveredBackend): boolean {
    if (host === entry.address) return true;
    const strip = (value: string) => value.toLowerCase().replace(/\.local\.?$/, "");
    return strip(host) === strip(entry.hostname);
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
        // `host` follows the beacon only for a record discovery owns. This is
        // not cosmetic: `findRecord` reads from this merged list, and
        // `activateBackend` writes what it gets back into `records` and
        // persists it. A record added by typing `desktop` matches its own
        // beacon (`matchesDiscovered` line 1, id equality), so without the
        // guard the first successful connect rewrites `host` to
        // `192.168.1.20` on disk. Off the LAN — VPN, another subnet — the
        // typed name is the only thing that resolves, and it is gone; the
        // Manage dialog does not own `host`, so the only way back is to remove
        // the record and add it again.
        const record = saved
            ? {
                  ...saved,
                  ...(saved.hostSource === "discovery" ? { host: entry.address } : {}),
                  lastKnownPort: entry.port,
              }
            : recordFromDiscovered(entry, defaultUser, new Date(entry.lastSeenAt).toISOString());
        entries.push({ kind: "live", record, protocolVersion: entry.protocolVersion });
    }

    for (const record of records) {
        if (matched.has(record.id)) continue;
        entries.push({ kind: "unseen", record });
    }

    return entries;
}

/**
 * Everything above assumes a `BackendRecord` really has the shape its type
 * claims. Nothing enforces that: the registry gets its records from
 * `JSON.parse` on a file under `userData` and asserts the type (Task 7's
 * `load`). Two of the fields are read with tests that only work on the exact
 * declared shape, so a record that is merely *plausible* is worse than one that
 * is obviously wrong:
 *
 * - `resolveBackendPort` short-circuits on `record.manualPort !== null`. A
 *   record written before that field existed has `undefined` there, `undefined
 *   !== null` is true, and the resolver returns `{ port: undefined }`. ssh is
 *   then handed `-L <local>:127.0.0.1:undefined` and the connect fails with a
 *   forwarding-spec error that names nothing the user recognises.
 * - `mergeForMenu` refreshes `host` only when `hostSource === "discovery"`. A
 *   record written before *that* field existed reads as manual, so a machine
 *   that was added by discovery stops following its own beacon and breaks for
 *   good the next time DHCP moves it.
 *
 * So parse rather than assert. This is also the only place that can repair a
 * hand-edited file — Task 14 tells the user to open `backends.json`, so assume
 * they will.
 */
function normalizeRecords(input: unknown): BackendRecord[] {
    if (!Array.isArray(input)) return [];
    const records: BackendRecord[] = [];
    for (const candidate of input) {
        const record = normalizeRecord(candidate);
        if (record) records.push(record);
    }
    return records;
}

function normalizeRecord(candidate: unknown): BackendRecord | null {
    if (typeof candidate !== "object" || candidate === null) return null;
    const value = candidate as Record<string, unknown>;
    const id = str(value.id);
    const host = str(value.host);
    const instanceId = str(value.instanceId);
    // No id, host or instance means nothing downstream can address it. Dropping
    // the row is the only honest outcome; keeping it would put a dead entry in
    // the menu that fails differently every time it is clicked.
    if (id === null || host === null || instanceId === null) return null;
    return {
        id,
        host,
        instanceId,
        displayName: str(value.displayName) ?? host,
        user: str(value.user) ?? userInfo().username,
        sshPort: port(value.sshPort) ?? 22,
        // Inferred, not defaulted. `addBackend` derives a manual record's id
        // from the host the user typed, so `id === backendIdFor(host, ...)` is
        // exactly the manual case; a discovered record is keyed on the
        // announced hostname while its host is the source address, so the two
        // do not match. Guessing "manual" for everything would freeze
        // discovered records; guessing "discovery" would clobber typed
        // hostnames — the bug the field exists to prevent.
        hostSource:
            value.hostSource === "manual" || value.hostSource === "discovery"
                ? value.hostSource
                : id === backendIdFor(host, instanceId)
                  ? "manual"
                  : "discovery",
        manualPort: port(value.manualPort) ?? null,
        lastKnownPort: port(value.lastKnownPort) ?? null,
        addedAt: str(value.addedAt) ?? new Date(0).toISOString(),
    };
}

function str(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function port(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535
        ? value
        : null;
}

export {
    matchesDiscovered,
    mergeForMenu,
    normalizeRecords,
    recordFromDiscovered,
    removeRecord,
    upsertRecord,
};
```

`backendIdFor` comes from `@taskflow/shared` (Task 2) and `userInfo` from
`node:os`. `node:os` is the one impurity in this otherwise I/O-free module, and
it is worth it: the alternative is a record with a blank ssh user, which is the
failure the discovered-backend flow already had once.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test electron/src/backend-records.test.ts`
Expected: PASS, 19 tests.

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
    hostSource: "discovery",
    manualPort: null,
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
- Produces: `openTunnel(record: BackendRecord, backendPort: number): Promise<TunnelResult>` where `TunnelResult = { ok: true; localPort: number } | { ok: false; failure: TunnelFailure }`; `closeTunnel(id: string): void`; `closeAllTunnels(): void`; `hasTunnel(id: string): boolean`; `trustHostKey(record: BackendRecord): Promise<void>`; `fetchHostKeyFingerprint(record: BackendRecord): Promise<string>`; `readRemotePort(record: BackendRecord): Promise<{ port: number } | { failure: TunnelFailure }>`; `onTunnelExit(handler: (id: string, failure: TunnelFailure) => void): void`.

`trustHostKey` is ordered, not standalone: it pins the key material that the
most recent `fetchHostKeyFingerprint` for that same record scanned, and rejects
when there is none. Calling it on its own is a programming error, not a
fallback.

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
    /** False until the readiness probe has answered. See `pending` below. */
    established: boolean;
}

type TunnelResult = { ok: true; localPort: number } | { ok: false; failure: TunnelFailure };

/**
 * Keyed by backend id, and holds the child from the moment it is spawned — not
 * from the moment it is ready. Readiness takes up to READINESS_TIMEOUT_MS, and
 * up to LOCAL_PORT_ATTEMPTS times that on a local-port retry; a child that is
 * only registered on success is invisible to `closeAllTunnels` for all of that
 * window. Quitting the app inside it leaves an orphan `ssh -N -L …` holding a
 * forwarded port: on POSIX a child is not killed when its parent exits, it is
 * reparented, so nothing else cleans it up either.
 *
 * One map rather than two, because both cases need the same thing done to them
 * — kill the child — and a second map is a second place to forget.
 */
const tunnels = new Map<string, ActiveTunnel>();
let exitHandler: ((id: string, failure: TunnelFailure) => void) | null = null;

const READINESS_TIMEOUT_MS = 10_000;
const LOCAL_PORT_ATTEMPTS = 3;

function onTunnelExit(handler: (id: string, failure: TunnelFailure) => void): void {
    exitHandler = handler;
}

/**
 * Whether an ssh child is currently registered for `id`. A child that exits on
 * its own deregisters itself (`deregister` in `attemptTunnel`), so this is a
 * true liveness check and not just "we started one once".
 *
 * `revertActiveBackend` is the caller. It restores `previousOrigin`, and a
 * forwarded local port is only an address for as long as the child holding it
 * is alive — see the comment there for the sequence that leaves main pointing
 * at a dead one.
 */
function hasTunnel(id: string): boolean {
    return tunnels.has(id);
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
 * "Taskflow backend" (`packages/backend/src/ws/server.ts:41-50` — `/` falls
 * past the API router to exactly that string), and the body is what gets
 * checked. A status check alone is not enough: the port being forwarded to can
 * be a *stale* one — `resolveBackendPort` falls back to a remembered port, and
 * the remote machine may have handed it to something else since — and any HTTP
 * server answering 200 there would pass. The failure then resurfaces much
 * later, as an unexplained WebSocket error against a promoted backend.
 */
async function waitForBackend(localPort: number): Promise<boolean> {
    const deadline = Date.now() + READINESS_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${localPort}/`, {
                signal: AbortSignal.timeout(1_000),
            });
            if (response.ok && (await response.text()).startsWith("Taskflow backend")) {
                return true;
            }
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

    // ssh reserves 255 for its own failures — auth, host keys, no route — and
    // otherwise exits with the *remote command's* status. So a code that is
    // neither 255 nor null means the connection worked and `cat` failed, which
    // is the single most likely outcome of a first manual connect: Taskflow is
    // not running over there, or it is running as a different user than the one
    // we logged in as, so `~` is a different home.
    //
    // `classifyTunnelFailure` has no pattern for that — it matches on ssh's own
    // stderr — so it falls through to its default and the user is told
    // **"SSH exited with code 1."** That names neither the cause nor the
    // remedy, and the remedy is the Backend port field one line above in the
    // dialog they are already looking at.
    if (code !== null && code !== 255) {
        return {
            failure: {
                kind: "no-backend",
                message: `Could not read Taskflow's port on ${record.host}. Check it is running there as ${record.user}, or enter its port in the connect dialog.`,
                stderr,
            },
        };
    }
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
    // Registered before the readiness probe runs, not after it succeeds, so
    // `closeAllTunnels` on quit can see it. See the comment on `tunnels`.
    const entry: ActiveTunnel = { child, localPort, established: false };
    tunnels.set(record.id, entry);

    /** Drops this attempt's registration without disturbing a later one. */
    const deregister = (): void => {
        if (tunnels.get(record.id) === entry) tunnels.delete(record.id);
    };

    // `close` rather than `exit`: a spawn failure (no ssh binary) emits
    // `error` and `close` but never `exit`, so racing `exit` alone would let
    // ENOENT fall through to the readiness timeout and be reported as
    // "Taskflow is not running" ten seconds later.
    // One listener for the child's whole life, not one per phase: before
    // readiness it settles the race, after it notifies the renderer. Two
    // listeners on one `close` would double-fire.
    const exited = new Promise<TunnelFailure>((resolve) => {
        child.once("close", (code) => {
            const failure = classifyTunnelFailure(readStderr(), code);
            deregister();
            if (entry.established) {
                exitHandler?.(record.id, failure);
                return;
            }
            resolve(failure);
        });
    });
    const ready = waitForBackend(localPort).then((ok) => (ok ? null : "not-ready"));

    const outcome = await Promise.race([exited, ready]);

    if (outcome === null) {
        // Safe to read the flag rather than a fresh map lookup: `ready` settles
        // as a microtask, and microtasks drain before the next macrotask, so no
        // `close` can have run between the race settling and this line.
        entry.established = true;
        return { ok: true, localPort };
    }

    deregister();
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

/** Kills whatever child is registered for `id`, established or still probing. */
function closeTunnel(id: string): void {
    const tunnel = tunnels.get(id);
    if (!tunnel) return;
    tunnels.delete(id);
    // Drops the single lifetime listener, so a deliberate close is not reported
    // to the renderer as a dropped tunnel. On a child that is still probing it
    // also strands that attempt's `exited` promise, which is intended: the
    // readiness loop finishes on its own timeout and returns a failure nobody
    // is waiting on any more.
    tunnel.child.removeAllListeners("close");
    tunnel.child.kill();
}

function closeAllTunnels(): void {
    for (const id of [...tunnels.keys()]) closeTunnel(id);
}

function scanHostKey(record: BackendRecord): Promise<string> {
    return new Promise((resolve) => {
        execFile("ssh-keyscan", buildKeyscanArgs(record), { timeout: 10_000 }, (_e, stdout) =>
            resolve(stdout),
        );
    });
}

/**
 * The exact bytes whose fingerprint was last shown to the user, per backend id.
 * `trustHostKey` writes from here and nowhere else.
 *
 * Scanning twice — once to show a fingerprint, once to write a key — would mean
 * the bytes the user approved and the bytes pinned in `known_hosts` came from
 * two different network round trips with nothing tying them together, and this
 * pair of calls is the entire trust-on-first-use anchor. Someone who answers
 * only the second scan gets pinned permanently; more mundanely, a host that
 * rotated keys between the two gets its new key pinned under the fingerprint
 * the user read. Keeping the material in main also keeps it off the IPC
 * channel, so the renderer never handles key bytes and the bridge is unchanged.
 *
 * The endpoint is stored beside the material, not just the id. An id is not a
 * stable address: for a discovered record `host` follows the beacon, so DHCP
 * moving the machine between the fingerprint and the approval would have
 * `trustHostKey` write the key it scanned from the old address under the new
 * address's `known_hosts` line. `forgetScannedHostKey` covers the edit and
 * remove paths (see `updateBackend`) but discovery does not go through them.
 */
interface ScannedHostKey {
    material: string;
    host: string;
    sshPort: number;
}

const scannedHostKeys = new Map<string, ScannedHostKey>();

/** Called by the registry when a record is edited or removed. See `updateBackend`. */
function forgetScannedHostKey(id: string): void {
    scannedHostKeys.delete(id);
}

async function fetchHostKeyFingerprint(record: BackendRecord): Promise<string> {
    const keyMaterial = await scanHostKey(record);
    if (keyMaterial.trim().length === 0) {
        throw new Error(`No host key returned by ${record.host}`);
    }
    const fingerprint = await new Promise<string>((resolve) => {
        const child = execFile("ssh-keygen", ["-lf", "-"], (_e, stdout) => resolve(stdout));
        child.stdin?.end(keyMaterial);
    });
    scannedHostKeys.set(record.id, {
        material: keyMaterial,
        host: record.host,
        sshPort: record.sshPort,
    });
    return fingerprint.trim();
}

/**
 * Only ever called after the user approved the fingerprint from
 * `fetchHostKeyFingerprint`, and only for an `unknown-host-key` failure. A
 * CHANGED key is classified separately and never reaches here — that case is
 * the user's to resolve outside the app.
 *
 * Refuses rather than re-scanning when there is nothing stashed. A trust dialog
 * that showed no fingerprint has approved nothing, so there is no key this is
 * entitled to pin.
 */
async function trustHostKey(record: BackendRecord): Promise<void> {
    const scanned = scannedHostKeys.get(record.id);
    if (scanned === undefined) {
        throw new Error("Re-check this host's fingerprint before trusting it.");
    }
    // The record moved under the dialog. Pinning now would write the key
    // scanned from the old endpoint against the new one, which is the one thing
    // trust-on-first-use must never do. Make them look again.
    if (scanned.host !== record.host || scanned.sshPort !== record.sshPort) {
        scannedHostKeys.delete(record.id);
        throw new Error("That backend's address changed. Re-check its fingerprint before trusting it.");
    }
    const keyMaterial = scanned.material;
    scannedHostKeys.delete(record.id);

    const sshDir = join(homedir(), ".ssh");
    const knownHosts = join(sshDir, "known_hosts");
    await mkdir(sshDir, { recursive: true, mode: 0o700 });

    let existing = "";
    try {
        existing = await readFile(knownHosts, "utf-8");
    } catch {
        // File does not exist yet.
    }
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await appendFile(knownHosts, `${prefix}${keyMaterial.trimEnd()}\n`, { mode: 0o600 });
    await chmod(knownHosts, 0o600);
}

export {
    closeAllTunnels,
    closeTunnel,
    fetchHostKeyFingerprint,
    forgetScannedHostKey,
    hasTunnel,
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
- Produces: on `window.taskflow` — `listBackends(): Promise<MenuEntry[]>`, `getActiveBackend(): Promise<{ id: string; origin: string | null; isLocal: boolean }>`, `activateBackend(id: string): Promise<{ ok: true; origin: string } | { ok: false; failure: TunnelFailure }>`, `cancelActivation(id: string): Promise<void>`, `addBackend(input: { host: string; user?: string; sshPort?: number; port?: number }): Promise<BackendRecord>`, `updateBackend(id, patch: { displayName?, user?, sshPort? }): Promise<{ ok: boolean; reason?: string }>`, `removeBackend(id): Promise<{ ok: boolean; reason?: string }>`, `revertActiveBackend(): Promise<void>`, `trustBackendHost(id): Promise<void>` (rejects unless `getHostFingerprint` ran for the same id first — see Task 6), `getHostFingerprint(id): Promise<string>`, `onBackendsChanged(cb: () => void): () => void`, `onBackendDropped(cb: (id: string, failure: TunnelFailure) => void): () => void`.

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
    normalizeRecords,
    recordFromDiscovered,
    removeRecord,
    upsertRecord,
} from "./backend-records";
import {
    closeTunnel,
    forgetScannedHostKey,
    hasTunnel,
    openTunnel,
    readRemotePort,
} from "./tunnel-manager";

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
/** Its origin, kept so `revertActiveBackend` can put main back exactly. */
let previousOrigin: string | null = null;
/**
 * The id `activateBackend` most recently opened a tunnel for and that nothing
 * has promoted or cancelled yet. `cancelActivation` keys off this rather than
 * off "is it the active one", because those two came apart the moment a dropped
 * backend could be re-activated under its own id.
 */
let pendingActivationId: string | null = null;

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
        // `normalizeRecords`, not `as BackendRecord[]`. This file has already
        // changed shape twice — the `Array.isArray` branch below exists because
        // of the first time — and two fields are read with tests that only hold
        // for the exact declared shape: `manualPort !== null` turns an absent
        // field into `{ port: undefined }`, and an absent `hostSource` reads as
        // manual and freezes a discovered record's host. See its comment in
        // Task 4. It is also the only guard on a file the user can hand-edit,
        // which Task 14's verification step invites them to do.
        if (typeof parsed === "object" && parsed !== null && "records" in parsed) {
            const file = parsed as { records?: unknown; activeId?: unknown };
            records = normalizeRecords(file.records);
            lastUsedId = typeof file.activeId === "string" ? file.activeId : LOCAL_ID;
            return;
        }
        // A file written before activeId was persisted.
        if (Array.isArray(parsed)) records = normalizeRecords(parsed);
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

/**
 * Order matters, and it is not the obvious one. `lastKnownPort` is a *cache of
 * a value that changes on every backend restart* — the backend serves on
 * `port: 0` (`packages/backend/src/config.ts:75`) and picks a fresh ephemeral
 * port each start — so it is the least trustworthy of the three sources, not
 * the cheapest-and-good-enough one.
 *
 * Putting it ahead of `readRemotePort` bricks a backend permanently: connect to
 * `desktop` once and the port is cached; `desktop` restarts; multicast does not
 * reach you (VPN, another subnet, a denied macOS local-network prompt) so there
 * is no beacon; every subsequent attempt forwards to the dead cached port,
 * times out after READINESS_TIMEOUT_MS as "Taskflow is not running on desktop",
 * and — because `activateBackend` only writes `lastKnownPort` on success —
 * never invalidates it. The instance port file that Task 1 exists to write is
 * sitting there with the right answer and is never consulted. Removing and
 * re-adding the backend is the user's only way out.
 *
 * So: beacon, then the port file over ssh, then the cache. The cache still
 * earns its place last — it is the only source that works against a Windows
 * backend, whose port file lives under %APPDATA% where `readRemotePort` cannot
 * reach it, and against a host with no usable ssh for a plain `cat`.
 *
 * `manualPort` sits in front of all three and short-circuits them. The spec
 * makes leaving the dialog's port field blank the trigger for port-file
 * resolution (`specs/2026-08-23-taskflow-multi-backend-design.md:534-536`), so
 * a filled-in field is an instruction not to resolve. It is also the field a
 * user reaches for precisely when resolution does not work for them — a Windows
 * backend whose port file is under %APPDATA%, an ssh account with a restricted
 * shell, a host that left a stale port file behind after a crash — and in every
 * one of those cases consulting the port file first costs a 15-second `runSsh`
 * timeout on each connect, or silently prefers a wrong answer to their right
 * one.
 */
async function resolveBackendPort(
    record: BackendRecord,
): Promise<{ port: number } | { failure: TunnelFailure }> {
    if (record.manualPort !== null) return { port: record.manualPort };

    // `matchesDiscovered`, not an id comparison: a record added by host string
    // and its own beacon carry different ids for the same machine, and matching
    // on id alone sends a perfectly discoverable backend down the ssh fallback.
    const live = discovered.find((entry) => matchesDiscovered(record, entry));
    if (live) return { port: live.port };

    const remote = await readRemotePort(record);
    if ("port" in remote) return remote;
    // The ssh read failed. A cached port is a worse answer than a fresh one but
    // a better answer than none, so try it — and if it is stale too, report the
    // ssh failure rather than the readiness timeout, because that is the one
    // that says *why* the port could not be resolved.
    if (record.lastKnownPort !== null) return { port: record.lastKnownPort };
    return remote;
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

    pendingActivationId = id;
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
    // Snapshotted because a **failed** `setActive` has to be a no-op, and it is
    // not one by default. Its rollback in `switchTo`'s catch is
    // `cancelActivation`, which keys off `pendingActivationId` — and clearing
    // that is the first thing this function does. So if `persist` then rejects
    // (a full disk, an unwritable `userData`), the IPC rejects, the renderer
    // reports a failed switch and stays on the old socket, and its
    // `cancelActivation` finds nothing to cancel. Main is left believing the
    // new backend is active: `getActiveOrigin` hands the pollers a tunnel the
    // renderer never promoted, the menu ticks a row the app is not talking to,
    // and that ssh child is now unreachable by every cleanup path there is —
    // `cancelActivation` has lost it, `retirePreviousTunnel` only closes
    // `previousId`, and `revertActiveBackend` is not called on this path.
    // Restoring is what makes the rollback the caller already performs correct.
    const snapshot = {
        activeId,
        activeOrigin,
        previousId,
        previousOrigin,
        lastUsedId,
        pendingActivationId,
    };
    // The activation is spoken for; `cancelActivation` must not still be able
    // to kill the tunnel the renderer is about to promote.
    pendingActivationId = null;
    previousId = activeId;
    previousOrigin = activeOrigin;
    activeId = id;
    lastUsedId = id;
    activeOrigin = id === LOCAL_ID ? null : origin;
    try {
        await persist();
    } catch (error) {
        ({
            activeId,
            activeOrigin,
            previousId,
            previousOrigin,
            lastUsedId,
            pendingActivationId,
        } = snapshot);
        throw error;
    }
    // A notification, not part of the commit, and therefore outside the
    // rollback: `webContents.send` throws on a destroyed window, and a window
    // closing mid-switch must not turn an activation that is already on disk
    // into a reported failure — rolling back here would contradict the file.
    try {
        deps.onChanged();
    } catch (error) {
        console.error("Failed to announce a backend change to the renderer:", error);
    }
}

/**
 * Undoes `setActive` when the renderer could not promote after all — the
 * pending socket died between the handshake and `promoteConnection`. Main
 * commits before the renderer promotes on purpose (see `setActive`), so this is
 * the other half of that bargain: without it main reports a backend the
 * renderer is not talking to, and `retirePreviousTunnel` would close the tunnel
 * that is still carrying traffic.
 *
 * Closing the reverted-from tunnel is part of the revert, not a separate step:
 * `pendingActivationId` was cleared by `setActive`, so `cancelActivation` can
 * no longer reach it and it would otherwise live until the app quits.
 */
async function revertActiveBackend(): Promise<void> {
    const abandoned = activeId;
    activeId = previousId;
    lastUsedId = previousId;
    // Keyed on the id alone — **no** `!== previousId` clause. A **Reconnect**
    // re-activates the id that is already active, so `abandoned === previousId`
    // there, and that clause would decline to close the ssh child
    // `activateBackend` had just spawned. `pendingActivationId` was cleared by
    // `setActive`, so `cancelActivation` cannot reach it either, and it lives
    // until the next attempt or until the app quits. This is the same guard
    // shape that had to come out of `cancelActivation` in round 8, for the same
    // reason, in the same flow.
    if (abandoned !== LOCAL_ID) {
        try {
            closeTunnel(abandoned);
        } catch (error) {
            console.error("Failed to close a reverted activation's tunnel:", error);
        }
    }
    // On a reconnect, `previousOrigin` names the tunnel `openTunnel` already
    // killed on its way in — `openTunnel` closes any existing child for an id
    // before spawning. Restoring it would leave main pointing at a dead local
    // port that `notification-poller` and `tray-manager` then hit every tick.
    // Null is the honest answer; the renderer's `dropped` banner is what the
    // user acts on, and it is still set because the switch failed.
    //
    // `hasTunnel` is the second half of that, and the id comparison alone does
    // not cover it. The reconnect case is only one way `previousOrigin` goes
    // stale; the other is the old backend's tunnel dying *during* the switch,
    // which one lost network covers both ends of. Sequence: on remote A,
    // switch to remote B, and the network drops between `setActiveBackend(B)`
    // and `promoteConnection`. A's ssh child exits, `onTunnelExit` fires, and
    // `markTunnelDropped(A)` returns immediately because `activeId` is already
    // B — its guard reads a drop for a non-active backend as "a tunnel already
    // retired by a completed switch", and this switch has not completed. B's
    // socket then dies, promotion fails, and we land here with `abandoned = B`,
    // `previousId = A`: the ids differ, so `previousOrigin` is restored and
    // main believes A is reachable at a forwarded port whose child is gone. The
    // pollers hit it every tick until the user presses **Reconnect**, each
    // request running to its `AbortSignal.timeout(1000)` — precisely the waste
    // `markTunnelDropped` exists to prevent, arrived at through the one door
    // its guard leaves open.
    activeOrigin =
        abandoned === previousId || (previousId !== LOCAL_ID && !hasTunnel(previousId))
            ? null
            : previousOrigin;
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
    // Keyed on the activation, not on `id !== activeId`. Reconnecting to a
    // backend whose tunnel dropped activates it under the id that is *still*
    // recorded as active, so an `id !== activeId` guard would decline to close
    // the fresh ssh child and leak one on every failed reconnect — the exact
    // leak Task 14's incompatible-protocol check looks for, arrived at from a
    // different direction. `pendingActivationId` is cleared by `setActive`, so
    // this can never reach a tunnel the renderer has promoted.
    if (id === LOCAL_ID || id !== pendingActivationId) return;
    pendingActivationId = null;
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

/**
 * The active backend's ssh child exited on its own. `activeId` is left alone —
 * the renderer still names this backend as active and offers a reconnect for it
 * — but the origin is dropped, so `getActiveOrigin` stops handing main's
 * pollers an address that no longer forwards anywhere.
 *
 * A drop reported for a backend that is no longer active is ignored: that is a
 * tunnel already retired by a completed switch, and clearing the current
 * origin for it would take down a healthy connection.
 */
function markTunnelDropped(id: string): void {
    if (id !== activeId) return;
    activeOrigin = null;
    deps.onChanged();
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
        // The user typed `host`. Nothing may rewrite it — see `mergeForMenu`.
        hostSource: "manual",
        manualPort: input.port ?? null,
        lastKnownPort: null,
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

/**
 * The three fields the Manage dialog owns. `manualPort` is deliberately not one
 * of them — the spec scopes that dialog to rename, user, ssh port and remove
 * (`specs/2026-08-23-taskflow-multi-backend-design.md:536-537`), so a typed
 * port is changed by removing the record and adding it again. Identity is not
 * one of them either:
 * `addBackend` recomputes the id from `host`, so reusing it to edit a
 * discovered record — id `desktop:main`, host `192.168.1.20` — would write a
 * second record keyed `192.168.1.20:main` and leave the original behind.
 */
async function updateBackend(
    id: string,
    patch: { displayName?: string; user?: string; sshPort?: number },
): Promise<{ ok: boolean; reason?: string }> {
    const existing = records.find((record) => record.id === id);
    if (!existing) return { ok: false, reason: "That backend is no longer in the list." };
    // Validated here, not only in the dialog. These three fields go straight
    // into an ssh command line — `buildTunnelArgs` emits `-p
    // ${String(record.sshPort)}` and `${record.user}@${record.host}` — and a
    // spread of a raw patch will write whatever the renderer sent. Clearing the
    // SSH user field to "go back to the default" gives ssh `@192.168.1.20`;
    // clearing the port field gives it `-p NaN`, which `JSON.stringify` then
    // writes to `backends.json` as `null`, so `normalizeRecord` silently heals
    // it to 22 on the next launch and the same row fails two different ways
    // either side of a restart. Neither failure names the field that caused it:
    // `classifyTunnelFailure` reads ssh's stderr and reports "no route" or
    // "auth refused" for a record the user broke by hand a moment earlier.
    //
    // Refusing rather than silently correcting: coercing a typo into 22 hides
    // it until the connection fails. Returned as `{ ok, reason }` rather than
    // thrown, matching `removeBackend` directly below and `save-artifact`'s
    // `{ success, error }` in `ipc-handlers.ts:104` — the repo has no handler
    // that throws text meant for a user, and for a good reason: Electron wraps
    // a rejected `ipcMain.handle` before the renderer sees it, so a thrown
    // "A backend needs an SSH user." reaches the banner as `Error invoking
    // remote method 'backend-update': Error: A backend needs an SSH user.`
    const displayName = patch.displayName?.trim();
    const user = patch.user?.trim();
    if (patch.displayName !== undefined && !displayName) {
        return { ok: false, reason: "A backend needs a name." };
    }
    if (patch.user !== undefined && !user) {
        return { ok: false, reason: "A backend needs an SSH user." };
    }
    if (
        patch.sshPort !== undefined &&
        (!Number.isInteger(patch.sshPort) || patch.sshPort < 1 || patch.sshPort > 65535)
    ) {
        return { ok: false, reason: "The SSH port must be a whole number between 1 and 65535." };
    }
    // Built field by field from the validated locals, **not** `{ ...existing,
    // ...patch }`. A spread does not mean "keys the caller supplied" — it means
    // "own keys", and an explicitly-`undefined` key is an own key that wins.
    // The Manage dialog sends `sshPort: parsePort(field)`, which is `undefined`
    // whenever the port input is blank, so a user editing only the display name
    // would have `sshPort: undefined` written over a working `2222`. ssh is
    // then handed `-p undefined`; `JSON.stringify` drops the key entirely, so
    // `backends.json` loses it and `normalizeRecord` heals it to 22 on the next
    // launch — the same row failing two different ways either side of a
    // restart, which is exactly what this validation was added to stop.
    // `addBackend` does not have this problem because it *builds* a record with
    // `??` defaults rather than merging onto one.
    records = upsertRecord(records, {
        ...existing,
        ...(displayName !== undefined ? { displayName } : {}),
        ...(user !== undefined ? { user } : {}),
        ...(patch.sshPort !== undefined ? { sshPort: patch.sshPort } : {}),
    });
    // `sshPort` is half of the `known_hosts` key (`knownHostsKey`, Task 5), so
    // a key scanned before this edit describes a different endpoint than the
    // one the user would now be trusting. Drop it and make them look again.
    forgetScannedHostKey(id);
    await persist();
    deps.onChanged();
    return { ok: true };
}

/**
 * Refuses to remove the backend the app is currently talking to. Nothing else
 * repairs that state: `activeId` and `activeOrigin` keep pointing at the gone
 * record, so the menu can no longer tick a row and `activeLabel` falls back to
 * "This machine" while the remote badge is still lit; `getLastUsedId` names a
 * record that is not there; and the moment the tunnel drops, the banner's
 * **Reconnect** calls `activateBackend(activeId)`, whose `findRecord` now
 * returns null — "That backend is no longer known." — with no way back except
 * noticing that "This machine" is the escape hatch.
 *
 * Returning a result rather than throwing: the caller is a dialog button, and
 * this is a refusal the user can act on, not an error.
 */
async function removeBackend(id: string): Promise<{ ok: boolean; reason?: string }> {
    if (id === activeId && id !== LOCAL_ID) {
        return {
            ok: false,
            reason: "That backend is the one you are connected to. Switch to another backend first.",
        };
    }
    records = removeRecord(records, id);
    forgetScannedHostKey(id);
    await persist();
    deps.onChanged();
    return { ok: true };
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
    markTunnelDropped,
    retirePreviousTunnel,
    revertActiveBackend,
    setActive,
    isLocalActive,
    listBackends,
    rememberDiscovered,
    removeBackend,
    stopBackendRegistry,
    updateBackend,
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

    ipcMain.handle("backend-revert-active", () => revertActiveBackend());

    ipcMain.handle("backend-cancel-activation", (_event, id: string) => {
        cancelActivation(id);
    });

    ipcMain.handle(
        "backend-add",
        async (_event, input: { host: string; user?: string; sshPort?: number; port?: number }) =>
            addBackend(input),
    );

    ipcMain.handle(
        "backend-update",
        (
            _event,
            id: string,
            patch: { displayName?: string; user?: string; sshPort?: number },
        ) => updateBackend(id, patch),
    );

    ipcMain.handle("backend-remove", (_event, id: string) => removeBackend(id));

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
    revertActiveBackend: () => ipcRenderer.invoke("backend-revert-active"),
    cancelActivation: (id: string) => ipcRenderer.invoke("backend-cancel-activation", id),
    addBackend: (input: { host: string; user?: string; sshPort?: number; port?: number }) =>
        ipcRenderer.invoke("backend-add", input),
    updateBackend: (id: string, patch: { displayName?: string; user?: string; sshPort?: number }) =>
        ipcRenderer.invoke("backend-update", id, patch),
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
    onBackendDropped: (callback: (id: string, failure: TunnelFailure) => void) => {
        const listener = (_e: unknown, id: string, failure: TunnelFailure) =>
            callback(id, failure);
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
    revertActiveBackend(): Promise<void>;
    cancelActivation(id: string): Promise<void>;
    addBackend(input: {
        host: string;
        user?: string;
        sshPort?: number;
        port?: number;
    }): Promise<BackendRecord>;
    updateBackend(
        id: string,
        patch: { displayName?: string; user?: string; sshPort?: number },
    ): Promise<{ ok: boolean; reason?: string }>;
    removeBackend(id: string): Promise<{ ok: boolean; reason?: string }>;
    getHostFingerprint(id: string): Promise<string>;
    trustBackendHost(id: string): Promise<void>;
    onBackendsChanged(callback: () => void): () => void;
    onBackendDropped(callback: (id: string, failure: TunnelFailure) => void): () => void;
```

Add at the top of the file: `import type { BackendRecord, MenuEntry, TunnelFailure } from "@taskflow/shared";`

- [ ] **Step 5: Wire main and repoint the pollers**

In `electron/src/main.ts`, after `initNotificationPoller`:

```ts
void initBackendRegistry({
    getLocalPort: getBackendPort,
    onChanged: () => getMainWindow()?.webContents.send("backends-changed"),
});

onTunnelExit((id, failure) => {
    // Before the renderer is told, so the notification and tray pollers stop
    // fetching a forwarded port that no longer forwards anywhere. Without it
    // they keep issuing a request per tick until the user reconnects, each one
    // running to its AbortSignal timeout.
    markTunnelDropped(id);
    // The id travels with the failure. A tunnel can exit on its own in the
    // moment between the renderer promoting the next backend and
    // `retirePreviousTunnel` removing its `close` listener, so this event can
    // arrive describing a backend that is no longer active. Without the id the
    // renderer cannot tell that apart from its current backend dropping, and
    // would flag a healthy connection as dropped.
    getMainWindow()?.webContents.send("backend-dropped", id, failure);
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

One thing that is **not** a mechanical translation, in
`refreshBackgroundTrayState` (`tray-manager.ts:160-182`). Today's
`if (!port) return` is a fine early exit because a missing local port means the
app is broken anyway. A missing *origin* is routine here — every dropped tunnel
produces one — and `backgroundTrayState` is module state that survives the early
return, so the menu bar keeps showing the remote's last `working` or
`attention` dot for a backend that is no longer connected, indefinitely, and
most visibly with the window closed, which is the only time that dot is the
user's sole signal. Clear it on the way out:

```ts
    const origin = deps.getActiveOrigin();
    if (!origin) {
        // No backend to poll: whatever the dot last said is now stale.
        if (backgroundTrayState !== null) {
            backgroundTrayState = null;
            if (!deps.getMainWindow() || !rendererTrayStateSynced) updateTrayIcon();
        }
        return;
    }
```

`startTrayStatePolling` (`:184-191`) needs only the mechanical swap: it is
called once from `main.ts:154`, straight after the local backend starts, when
`getActiveOrigin()` is the local origin and never null.

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
- Produces: `connectTo(origin: string): Promise<void>` (opens a *pending* socket, does not promote), `promoteConnection(): boolean` (false when there is no open pending socket — the caller must treat that as a failed switch), `abortPending(): void`, `getBackendOrigin(): string | null`, `BACKEND_SWITCHED` error message constant. The reconnect backoff defers while a socket is pending, so it never cancels a switch. `sendRequest`, `sendFireAndForget`, `onEvent`, `onStatusChange` keep their signatures.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/hooks/useWebSocket.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import {
    BACKEND_SWITCHED,
    __resetForTests,
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
                            payload: {
                                editors: [],
                                homedir: "/h",
                                hostname: "fake",
                                protocolVersion: 1,
                            },
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

// `abortPending()` alone is not enough, and the way it fails is quiet. It only
// touches the *pending* slot; `current` is left open and promoted. Stopping the
// fake server then closes that socket for real, its `onclose` runs the live
// branch, and the live branch calls `scheduleReconnect` — so every test that
// promotes a connection leaves a backoff timer behind, redialling a server that
// no longer exists. A second later, inside some later test, that timer runs
// `connectTo`, whose first act is `abortPending()`: it rejects *that* test's
// in-flight connection with "Backend switched" and takes its socket away. The
// symptom is a suite that passes alone and fails in file order, with an error
// message from a switch nobody performed.
//
// Resetting before stopping the servers is the order that matters: detach and
// close while the sockets are still ours, so no handler is left to react to the
// server going away.
afterEach(() => {
    __resetForTests();
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

    test("a pending socket dying mid-handshake rejects its in-flight request", async () => {
        // The switch sends the compatibility handshake over the pending socket
        // and awaits it. If the socket dies there — ssh exiting is the realistic
        // cause — that await has to fail now, not in thirty seconds when
        // `sendRequest` times out, because `switching` stays set until it does
        // and the whole menu is frozen behind it.
        const a = track(startServer());
        const b = track(startServer());

        await connectTo(a.origin);
        promoteConnection();

        await connectTo(b.origin);
        // `project:list` is one of the types the fake server never answers.
        const inFlight = sendRequest("project:list", {}, { usePending: true });
        b.stop();

        await expect(inFlight).rejects.toThrow();
        // And the live connection is untouched by its death.
        expect(getBackendOrigin()).toBe(a.origin);
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

    test("promotion refuses a pending socket that died after the handshake", async () => {
        // The window between the compatibility handshake and `promoteConnection`
        // holds two awaits in `switchTo`, and ssh can exit inside it. A `void`
        // promote returned silently here and the caller carried on resetting
        // state for a backend it was not connected to.
        const a = track(startServer());
        const b = track(startServer());

        await connectTo(a.origin);
        expect(promoteConnection()).toBe(true);

        await connectTo(b.origin);
        await expect(sendRequest("system:info", {}, { usePending: true })).resolves.toBeDefined();
        b.stop();
        await Bun.sleep(100);

        expect(promoteConnection()).toBe(false);
        // And the live connection is untouched: the caller can report a failed
        // switch and leave the user where they were.
        expect(getBackendOrigin()).toBe(a.origin);
    });

    test("an error on the live socket does not reject a switch in flight", async () => {
        // `pendingSettle` is a module global. Without an identity guard in
        // `onerror`, the old backend dropping mid-switch settles the *new*
        // socket's `connectTo` promise, and a switch to a backend that was
        // answering fine fails with "WebSocket connection error".
        const a = track(startServer());
        const b = track(startServer());

        await connectTo(a.origin);
        promoteConnection();

        const connecting = connectTo(b.origin);
        a.stop(); // the live backend dies while B's socket is still opening
        await expect(connecting).resolves.toBeUndefined();
        expect(promoteConnection()).toBe(true);
        expect(getBackendOrigin()).toBe(b.origin);
    });

    test("a failed user-initiated reconnect leaves the backoff armed", async () => {
        // The path that had nothing armed: the tunnel drops, `onclose` arms the
        // backoff, the user presses Reconnect, `connectTo` cancels the backoff
        // on entry, and the new socket fails before open — by which point
        // `onerror` has cleared `pending`, so the `abortPending` in `switchTo`'s
        // catch has nothing to abort. Without the re-arm the app sits at
        // "Reconnecting…" with no timer and never recovers on its own.
        const a = track(startServer());
        await connectTo(a.origin);
        promoteConnection();

        a.stop(); // the live backend goes away; onclose arms the backoff
        await Bun.sleep(100);

        // Stand in for the user pressing Reconnect against a host that is down.
        await expect(connectTo("ws://127.0.0.1:1")).rejects.toThrow();
        abortPending(); // `switchTo`'s catch, with `pending` already null

        const statuses: Array<{ connected: boolean; reconnecting: boolean }> = [];
        const unsubscribe = onStatusChange((status) => statuses.push({ ...status }));
        await Bun.sleep(2_500);
        unsubscribe();

        // Something is still trying. A single `reconnecting` here would be the
        // stale flag from the cancelled arm, not a live timer, so assert on the
        // count the way the backoff test above does.
        expect(statuses.filter((s) => s.reconnecting).length).toBeGreaterThan(1);
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
            .then(() => {
                // The socket can open and then die before this line. Promotion
                // returns false there, and treating that as success would leave
                // `current` on the dead connection with no timer armed — the
                // backoff would have fired exactly once and stopped.
                if (!promoteConnection()) scheduleReconnect();
            })
            .catch(() => {
                // A failed reconnect must schedule the next one. Without this the
                // backoff fires exactly once and the app never recovers on its own.
                scheduleReconnect();
            });
    }, delay);
}

/**
 * Re-arms the reconnect backoff if the live connection is down.
 *
 * `connectTo` cancels the backoff on its way in, so **every** path that ends an
 * attempt without promoting has to come back through here or the app is left
 * with a dead `current`, no timer, and `reconnecting` still true from the arm
 * that got cancelled — sitting at "Reconnecting…" forever. There are three such
 * paths and they were added in different rounds, which is how two of them ended
 * up missing it: the pending socket erroring before open, the pending socket
 * closing before promotion, and `abortPending` — including the case where
 * `abortPending` finds nothing pending, which is the common one, because a
 * failed **Reconnect** has already had its `pending` cleared by `onerror`
 * before `switchTo`'s catch runs.
 */
function scheduleReconnectIfCurrentDown(): void {
    if (current && current.socket.readyState !== WebSocket.OPEN) scheduleReconnect();
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
            scheduleReconnectIfCurrentDown();
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
    // `abortPending` first, *then* clear the timer. `abortPending` re-arms the
    // reconnect when the live connection is down, and this call is exactly the
    // case where that re-arm is not wanted — we are connecting right now. Doing
    // it the other way round leaves a stray timer that fires mid-connect and,
    // finding `pending` set, just reschedules itself forever.
    abortPending();
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

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
            // Two guards, and both are load-bearing.
            //
            // `pending !== connection` is identity: `pendingSettle` is a module
            // global, so an error on some *other* socket would otherwise settle
            // and clear the slot belonging to this one. The reachable case is
            // the live backend dropping while a switch is mid-flight — A's
            // socket errors, A's `onerror` closure sees a non-null
            // `pendingSettle` that belongs to B, and rejects B's `connectTo`.
            // The switch fails with "WebSocket connection error" against a
            // backend that was answering fine.
            //
            // `pendingSettle === null` is phase: an error *after* open — ssh
            // dying mid-handshake — must fall through to `onclose`, which
            // rejects the generation immediately. Clearing `pending` here
            // instead would leave `onclose` unable to recognise the socket as
            // either current or pending; it would return without rejecting
            // anything, and the handshake request would hang for the full
            // 30-second `sendRequest` timeout with `switching` still set.
            if (pending !== connection || pendingSettle === null) return;
            pending = null;
            pendingSettle = null;
            reject(new Error("WebSocket connection error"));
            scheduleReconnectIfCurrentDown();
        };
    });
}

/**
 * Installs the pending socket and retires the previous one. Returns false when
 * there is nothing promotable, which the caller **must** treat as a failed
 * switch.
 *
 * The return value is the whole point. A pending socket can die between the
 * compatibility handshake and this call — `switchTo` awaits `unwatchAll` and an
 * IPC round trip in between, and ssh exiting is the realistic cause. `onclose`
 * clears `pending` when that happens, and nothing is awaiting it, so a `void`
 * version of this function returned silently and the caller carried on:
 * `resetAllState`, the generation bump, main already told that B is active —
 * with `current` still pointing at A. Every request would keep going to A while
 * the app said B, and `retirePreviousTunnel` would then close A's tunnel, the
 * one actually in use. The `readyState` check is part of it: `onclose` fires a
 * task later than the socket entering CLOSING, so `pending` being non-null is
 * not proof it is usable.
 */
function promoteConnection(): boolean {
    if (!pending || pending.socket.readyState !== WebSocket.OPEN) return false;
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
        // `onerror` too, not just the other two. A close often fires `error`
        // first, and the retired socket's `onerror` closure reads the
        // *module-level* `pendingSettle` — which by then belongs to whatever
        // `connectTo` is running next. See the identity guard in `connectTo`.
        previous.socket.onerror = null;
        previous.socket.close();
    }

    reconnectAttempt = 0;
    connected = true;
    reconnecting = false;
    notifyStatus();
    return true;
}

/**
 * Throws away a socket opened by `connectTo` that will not be promoted —
 * a failed handshake, or the user cancelling mid-switch. Settles the
 * `connectTo` promise and rejects anything already sent over that socket, so
 * no caller is left waiting on a connection that no longer exists.
 */
function abortPending(): void {
    if (!pending) {
        // Not a no-op. `connectTo` cancelled the backoff on entry, and by the
        // time `switchTo`'s catch calls this after a failed **Reconnect**,
        // `onerror` has usually already cleared `pending` — so returning here
        // without re-arming is exactly how the app ends up with a dead
        // connection and no timer.
        scheduleReconnectIfCurrentDown();
        return;
    }
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

    scheduleReconnectIfCurrentDown();
}

/**
 * Returns the module to its just-imported state. Exported **only** for the test
 * file: this module is a set of globals with a reconnect timer, and Bun runs
 * every test in one file against the same import, so without a way to put
 * `current` down a promoted socket and its backoff outlive the test that made
 * them. See the comment on `afterEach` in `useWebSocket.test.ts` for what that
 * looks like when it goes wrong. Nothing in the app calls this — a real reset
 * of the connection is `connectTo` plus `promoteConnection`.
 */
function __resetForTests(): void {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    for (const connection of [pending, current]) {
        if (!connection) continue;
        const { socket } = connection;
        socket.onopen = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.onmessage = null;
        socket.close();
    }
    pending = null;
    current = null;
    const settle = pendingSettle;
    pendingSettle = null;
    settle?.reject(new Error(BACKEND_SWITCHED));
    // Rejected, not just cleared. A test that awaits a `sendRequest` the fake
    // server was told to leave hanging would otherwise await a promise nothing
    // can ever settle, and the failure is a timed-out test file rather than a
    // named assertion.
    for (const [, request] of pendingRequests) {
        clearTimeout(request.timeoutId);
        request.reject(new Error(BACKEND_SWITCHED));
    }
    pendingRequests.clear();
    // The listener maps too. A test that registers an `onEvent` handler and
    // does not unsubscribe would otherwise still be counting broadcasts in the
    // next one — which is the assertion the duplicate-subscription test makes.
    eventListeners.clear();
    statusListeners.clear();
    connected = false;
    reconnecting = false;
    reconnectAttempt = 0;
    generationCounter = 0;
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
    __resetForTests,
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
                    // Before anything can throw. This is the only thing that
                    // runs `refresh()` at boot, and without it a window
                    // reopened onto a dropped remote backend has no way back —
                    // see the comment below and Task 11's `ConnectionOverlay`.
                    await useBackendStore.getState().refresh().catch(() => {});
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
                if (!promoteConnection()) {
                    throw new Error("The backend closed the connection before it was ready");
                }
                initConnectivity();
            } catch (err) {
                setError(err instanceof Error ? err.message : "Connection failed");
            }
        }
```

Update its imports to `connectTo, promoteConnection, onStatusChange`, and add
`import { useBackendStore } from "@/stores/backend-store";`.

That one added line is load-bearing, and the reason is worth spelling out
because the shape of it is not obvious from this file. **Nothing else in the app
calls `refresh()` before the user opens the backend menu.** Task 11 wires it to
the menu's `open` state and to `backends-changed`; Task 10 calls it from
`switchTo`'s `finally`. Every one of those needs the user to have done
something first.

Now take the case Task 10's derived `dropped` was written for: macOS, connected
to a remote backend, the window closed while the app stays in the menu bar, the
tunnel dies, the window reopens. Main has `activeId` naming that backend and
`activeOrigin === null`, and the `backend-dropped` event that would have told
the renderer was sent to a window that did not exist. The fresh renderer starts
from the store's initial state: `isLocal: true`, `dropped: false`, `error: null`.
`connect()` throws "No backend is running" and does not retry — there is no
socket, so `scheduleReconnect` returns on `!current`. Task 11's
`ConnectionOverlay` reads `isLocal` to decide whether to block, sees `true`, and
puts a full-screen `fixed inset-0 z-50` blur over the app. Underneath it: the
backend menu, whose `open` effect is the only thing that would run `refresh()`,
and which cannot be clicked. `dropped` is never derived, so the banner and its
**Reconnect** button never render either. The user is back at quit-and-relaunch
— the exact dead end round 14 set out to remove, reached by a different door.

Refreshing here closes it: by the time `connect()` throws, the store knows
`isLocal: false` and `dropped: true`, the overlay takes its non-blocking branch,
and the banner is up with a working **Reconnect**. The `catch` is deliberate —
`refresh` crossing IPC must not be what stops the renderer connecting.

- [ ] **Step 5: Fix the three test files that stub `getBackendPort`**

`packages/ui/src/stores/wiki-store.test.ts:21`, `packages/ui/src/components/panes/MarkdownPaneImpl.anchors.test.tsx:33` and `MarkdownPaneImpl.checkbox.test.tsx:55` stub `getBackendPort: () => 7100`. Change each to `getBackendOrigin: () => "ws://localhost:7100"`, and drop the now-dead `connectWebSocket` stub next to it (`wiki-store.test.ts:23`, `:37`, `:59`).

Add `BACKEND_SWITCHED: "Backend switched"` to all three while you are there.
These are `mock.module("@/hooks/useWebSocket", …)` calls, which replace the
module **wholesale** — a key the factory does not return is `undefined` in the
importer, not a build error. Task 9's Step 5c has `wiki-store.ts` compare
`err.message === BACKEND_SWITCHED`, so with the current factory that comparison
is `=== undefined`: it is always false, the guard never fires, and it fails
silently. The regression Step 5c exists to prevent would be reintroducible
without a single test going red.

Duplicating the literal is deliberate — importing the real constant into a file
that mocks the module it comes from is the circularity these factories exist to
avoid. If the two ever drift, the `wiki-store` test for the guard is what
catches it, so write that test:

```ts
test("a request cancelled by a backend switch does not write an error", async () => {
    // Same shape as production: `promoteConnection` rejects the old
    // generation with this exact message, and the reset has already run.
    response = Promise.reject(new Error("Backend switched"));
    await useWikiStore.getState().loadIndex("/w");
    expect(useWikiStore.getState().errorByRoot["/w"]).toBeUndefined();
});
```

Adjust it to however that file drives `sendRequest` — the assertion is the
point, not the plumbing.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test packages/ui`
Expected: PASS, including the thirteen new connection tests.

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
- Modify: `packages/ui/src/stores/session-activity.ts:12-15`
- Modify: `packages/ui/src/stores/session-helpers.ts:83`
- Modify: `packages/ui/src/hooks/useConnectivity.ts:8,31-45`
- Modify: `packages/ui/src/hooks/useAgentAvailability.ts:8-20`
- Modify: `packages/ui/src/hooks/useActiveWorkspace.ts:19-30`
- Modify: `packages/ui/src/lib/open-file.ts:10-27`
- Modify: `packages/ui/src/lib/monaco-import-navigation.ts:9-12`
- Modify: `packages/ui/src/components/settings/CodexModelSelect.tsx:16-17`
- Modify: `packages/ui/src/components/panes/editor-dirty-state.ts`
- Modify: `packages/ui/src/components/panes/terminal/terminal-link-provider.ts:76-77`
- Modify: `packages/ui/src/stores/session-store.ts:36,106,142`
- Modify: `packages/ui/src/stores/wiki-store.ts:29-30`, `packages/ui/src/stores/search-store.ts:120,153,174,199`
- Create: `packages/ui/src/components/panes/markdown-toggle-queue.ts`
- Create: `packages/ui/src/components/panes/markdown-toggle-queue.test.ts`
- Modify: `packages/ui/src/components/panes/MarkdownPaneImpl.tsx:82-90`
- Modify: every store module in `packages/ui/src/stores/`

**Interfaces:**
- Consumes: nothing.
- Produces: `registerReset(name: string, reset: () => void): void`, `resetAllState(): void`, `rebootstrap(): Promise<void>`, `registeredResetNames(): string[]`, `clearAllEditorState(): void` from `editor-dirty-state.ts`, and `queueToggle` / `clearToggleQueues` from `markdown-toggle-queue.ts`.

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
                // Only module state is `lastTrayState`, which the session-store
                // reset recomputes through the tray subscription.
                name !== "session-subscriptions.ts" &&
                // A pure tab-reconciliation helper — three functions, one
                // export, no module-level state of any kind
                // (`session-sync.ts:1-148`). It lives in `stores/` by topic
                // rather than by kind, so the directory walk picks it up and
                // demands a reset it has nothing to register. Without this
                // exclusion Step 6 below cannot pass: the test reports
                // `missing: ["session-sync"]` on a correct implementation.
                name !== "session-sync.ts",
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

For each module in `packages/ui/src/stores/` other than `store-reset.ts`, `rebootstrap.ts`, `session-subscriptions.ts` and `session-sync.ts`, add at the bottom of the file, adapting the initial state to that store. That exclusion list must stay identical to the one in Step 1's coverage test — it is the same list stated twice, and `session-sync.ts` is in the test's but was missing here, so following this step literally would add a reset to a pure helper the test deliberately does not ask for. Two of them — `session-activity.ts` and `session-helpers.ts` — are not zustand stores at all; Step 5 covers what they reset instead. For example, in `packages/ui/src/stores/project-store.ts`:

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

`packages/ui/src/hooks/useConnectivity.ts` — the reset has to **undo the
subscription**, not just re-open the guard. `initConnectivity` registers an
`onEvent(MSG.CONNECTIVITY_STATUS_CHANGED, …)` handler (`useConnectivity.ts:43`)
and throws away the unsubscribe it gets back, and `rebootstrap` calls
`initConnectivity()` again after every switch. Clearing `initialized` on its own
therefore stacks one more permanent listener per switch into `useWebSocket`'s
`eventListeners` map (`useWebSocket.ts:24,138-148` — a `Set` of closures, no
dedup), and nothing ever drains it. It is the same rule the file-store reset
above states from the other side ("resetting it would register a second handler
and double every refresh"); the difference is that connectivity *must*
re-subscribe, because the value it caches belongs to the backend it was
registered against — so it keeps the handle instead of skipping the reset.

First make the subscription droppable, in `initConnectivity`:

```ts
let unsubscribeStatusChanged: (() => void) | null = null;

function initConnectivity(): void {
    if (initialized) return;
    initialized = true;
    // ...unchanged: the CONNECTIVITY_STATUS request and its two handlers
    unsubscribeStatusChanged = onEvent(MSG.CONNECTIVITY_STATUS_CHANGED, (payload) => {
        const data = payload as ConnectivityStatusPayload;
        setOnline(data.online);
    });
}
```

then drop it in the reset:

```ts
registerReset("connectivity", () => {
    unsubscribeStatusChanged?.();
    unsubscribeStatusChanged = null;
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
    // All three, not two. `tsconfigOptionsCache` (`monaco-import-navigation.ts:15`)
    // is keyed by tsconfig path, and two machines routinely hold the same
    // repository at the same path with different compiler options — a monorepo
    // mid-migration on one and not the other. Leaving it would apply A's
    // `paths` aliases to B's editor.
    tsconfigOptionsCache.clear();
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

`packages/ui/src/stores/session-activity.ts` is in the coverage test's scope but
is **not** a zustand store — it is two module-level `Map`s and a pending timer
per session (`session-activity.ts:12-15`), so "copy the initial state from
`create(...)`" does not apply. It needs its own reset, and it earns one: a
terminal-output event on the old backend arms a 3-second timer
(`session-activity.ts:43-52`) whose callback calls `setSessionStatus` when it
fires. Switch inside that window and it writes `attention` for a session id that
does not exist on the new backend, which the tray then shows.

```ts
registerReset("session-activity", () => {
    for (const timer of activityTimers.values()) clearTimeout(timer);
    activityTimers.clear();
    lastInteractionAt.clear();
});
```

`packages/ui/src/stores/session-helpers.ts` holds `exitedSessions`
(`session-helpers.ts:83`), a set of ids from a machine the app is no longer
talking to. Drop it from the coverage test's exclusion list and register:

```ts
registerReset("session-helpers", () => {
    exitedSessions.clear();
    // `windowFocused` is deliberately not reset: it describes this window, not
    // the backend.
});
```

`packages/ui/src/stores/session-store.ts` has module state the `setState` cannot
reach and a leak that predates this plan. `createSession` adds an owner key to
`pendingSessionCreates` (`session-store.ts:36,106`), awaits `sendRequest`, and
deletes the key only on the success path (`:142`). Any rejection strands it —
and a backend switch guarantees one, because `promoteConnection` rejects every
request in flight on the old socket as `Backend switched`. A stranded key makes
`syncOwnerTabs` refuse to auto-place sessions for that owner
(`session-sync.ts:110`, `session-store.ts:559`) for the rest of the renderer's
life. `"master"` is the easy repeat offender: it is a single fixed key, so one
interrupted master session create silences master auto-placement permanently.

Fix both ends. In `createSession`, move the delete into a `finally` so the key
cannot outlive the call. There is no `try` there today, so one has to be
introduced, and where it *ends* matters: it opens immediately after the
`pendingSessionCreates.add(pendingKey)` block (`session-store.ts:105-107`) and
closes after `addTab` (`:141`) — **not** around the `Promise.all` refetch that
follows. Wrapping the refetch too would hold the key for the length of two more
round trips, which is exactly the window `syncOwnerTabs` must not see it in:

```ts
        if (targetWorkspaceKey && pendingKey) {
            pendingSessionCreates.add(pendingKey);
        }
        try {
            // ...unchanged: lastTerminalSize, sendRequest, the `tab` literal,
            // the `workspaceKey` computation, and `get().addTab(...)`
        } finally {
            if (pendingKey) pendingSessionCreates.delete(pendingKey);
        }
        await Promise.all([
            // ...unchanged
        ]);
```

and clear the set in the reset, because a key added by an in-flight create that
has not settled yet still refers to the old backend's owner:

```ts
registerReset("session-store", () => {
    pendingSessionCreates.clear();
    useSessionStore.setState({ /* the initial state from create(...) */ });
});
```

- [ ] **Step 5c: Do not let a rejected request write into the reset stores**

`promoteConnection` rejects the old generation, `resetAllState` runs, and only
*then* do those rejections reach their `catch` blocks — a promise rejection is a
microtask, so it lands after the synchronous block that emptied the stores. A
catch that writes user-visible state therefore writes it into the new backend's
clean store. `wiki-store.ts:29-30` is the clearest case: switch backends with a
wiki index in flight and the new backend's wiki pane opens showing the error
`Backend switched` for a root it never asked about.

`BACKEND_SWITCHED` is already exported from `@/hooks/useWebSocket` (Task 8);
import it and skip the write:

```ts
        } catch (err: unknown) {
            // The request was cancelled by a backend switch, not refused by a
            // backend. The store it would write to has already been reset for
            // the machine we are now talking to.
            if (err instanceof Error && err.message === BACKEND_SWITCHED) return;
            const message = err instanceof Error ? err.message : "Failed to read the wiki";
            set((s) => ({ errorByRoot: { ...s.errorByRoot, [root]: message } }));
        } finally {
```

Apply the same guard to every `catch` in `packages/ui/src/stores/` that writes a
message a user reads. Do not audit by eye — the list below was wrong twice.
Enumerate them:

```bash
cd packages/ui/src/stores && for f in *.ts; do case "$f" in *.test.ts) continue;; esac
awk -v F="$f" '/catch/{c=NR} c && NR<=c+6 && /error:|errorByRoot/ {print F":"NR}' "$f"; done
```

That returns exactly five, and all five need the guard: `wiki-store.ts:30`,
`search-store.ts:120`, `:153`, `:174`, `:199`.

`search-store.ts:120` is the one to check first, not last. It is the `catch` on
`search()` itself, and a repository-wide search is the longest-running request
in the app — the request most likely to still be in flight when a switch lands.
Switch backends while a search is running and the new backend's search panel
opens with `searching: false` and the error `Backend switched` against a query
it never ran. The earlier draft of this audit listed `search-store.ts:133`
instead, which is not in a `catch` body at all: the `catch` at `:130` is empty
and `:133` is the `set` after it, in `cancel()`.

The remaining `catch` blocks in the directory — `project-store.ts:52`,
`task-store.ts:60`, `theme-store.ts:130` — only clear a
`loading`/`scanning`/`searching` flag, which is what the reset sets anyway, so
they are left alone rather than churned.

`session-subscriptions.ts` stays excluded. Its only module state is
`lastTrayState` (`session-subscriptions.ts:57`), and the reset of the session
store fires the tray subscription, which recomputes and sends the new backend's
aggregate. Say so in the exclusion comment so the next reader does not have to
re-derive it.

- [ ] **Step 5a: Clear the terminal's file-stat cache**

The coverage test only walks `packages/ui/src/stores/`, so this one has to be
found by hand. `packages/ui/src/components/panes/terminal/terminal-link-provider.ts:76`
keeps `fileStatCache`, a `Map` keyed by absolute path alone with a 10-second TTL
(`:77`), holding `FILE_STAT` answers from the backend. It decides whether a bare
filename in terminal output is drawn as a clickable link.

Switch backends within that 10-second window and a bare name that resolved on
machine A stays clickable on machine B, where it opens a path that is not there;
the inverse — a path cached as missing — leaves a real file unclickable. Bounded
and cosmetic next to the write in Step 5b, but the fix is two lines and Task 12
already edits this file.

At the bottom of `terminal-link-provider.ts`:

```ts
registerReset("terminal-file-stat-cache", () => {
    fileStatCache.clear();
});
```

Only the cache: `taskId` and the workspace root come from arguments, not module
state, so there is nothing else in the file to clear.

- [ ] **Step 5b: Stop a queued markdown write from landing on the next backend**

This is the only place in the app where switching backends can *modify* a file
rather than merely read a stale one, so it gets its own step.

`packages/ui/src/components/panes/MarkdownPaneImpl.tsx:82-90` keeps
`toggleChains` — a module-level `Map<filePath, Promise>` — and each queued
closure calls `readFile(path)` then `writeFile(path, next)`
(`MarkdownPaneImpl.tsx:355, :375`). Those go over whatever socket is live when
they run. Tick two checkboxes in `~/notes.md` and switch backends while the
second is still queued, and the second write reads and rewrites `~/notes.md` on
the *other machine*. Task 10's unsaved-file guard does not cover this: a
checkbox toggle is not a dirty Monaco model.

Clearing the map is not enough — the chained promises already exist and hold
their own references. The queue needs an epoch the closures check before they
touch the backend.

Move the queue out of the component into a plain module,
`packages/ui/src/components/panes/markdown-toggle-queue.ts`, next to
`editor-dirty-state.ts` (a `.tsx` cannot export non-components without tripping
`react-refresh/only-export-components`, and this plan does not disable eslint
rules):

```ts
/** Bumped on a backend switch. A toggle queued against the old backend is
 *  dropped rather than replayed: the same absolute path on another machine is a
 *  different file, and the click's snapshot describes bytes that are not there. */
let epoch = 0;
const toggleChains = new Map<string, Promise<void>>();

/**
 * `run` receives `isCurrent`. Checking the epoch once, before `run` starts, is
 * not enough: the switch promotes the new socket *before* the resets run, so a
 * closure sitting between its `readFile` and its `writeFile` has already passed
 * an entry check and would write machine A's bytes to machine B. `run` has to
 * re-ask after every await that precedes backend I/O.
 */
function queueToggle(filePath: string, run: (isCurrent: () => boolean) => Promise<void>): void {
    const queuedAt = epoch;
    const isCurrent = () => queuedAt === epoch;
    const guarded = () => (isCurrent() ? run(isCurrent) : Promise.resolve());
    const previous = toggleChains.get(filePath) ?? Promise.resolve();
    // `then(guarded, guarded)` — a rejected predecessor must not wedge the queue.
    const chain = previous.then(guarded, guarded).finally(() => {
        if (toggleChains.get(filePath) === chain) toggleChains.delete(filePath);
    });
    toggleChains.set(filePath, chain);
}

function clearToggleQueues(): void {
    epoch++;
    toggleChains.clear();
}

export { clearToggleQueues, queueToggle };
```

`MarkdownPaneImpl.tsx` imports `queueToggle` instead of declaring it, and
`toggleTaskLine` takes the new argument and re-checks it around its two backend
calls (`MarkdownPaneImpl.tsx:355` and `:375`):

```ts
            queueToggle(path, async (isCurrent) => {
                // ...unchanged, up to and including the read:
                current = await readFile(path);
                if (!isCurrent()) return;
                // ...unchanged, up to the write:
                if (!isCurrent()) return;
                await writeFile(path, next);
```

The read is guarded as well as the write. A read that resolves against the new
backend returns that machine's bytes, `relocateTaskLine` then matches the click
against a document it never came from, and the write that follows is wrong in a
way no later check can see.

Register the reset from `file-store.ts` alongside `editor-state`:

```ts
registerReset("markdown-toggles", clearToggleQueues);
```

Add `packages/ui/src/components/panes/markdown-toggle-queue.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { clearToggleQueues, queueToggle } from "./markdown-toggle-queue";

describe("queueToggle", () => {
    test("runs queued work in order for one file", async () => {
        const order: number[] = [];
        queueToggle("/a.md", async () => {
            await Bun.sleep(10);
            order.push(1);
        });
        queueToggle("/a.md", async () => {
            order.push(2);
        });
        await Bun.sleep(50);
        expect(order).toEqual([1, 2]);
    });

    test("work queued before a backend switch never runs after it", async () => {
        const ran: string[] = [];
        queueToggle("/a.md", async () => {
            await Bun.sleep(20);
            ran.push("first");
        });
        queueToggle("/a.md", async () => {
            ran.push("second");
        });
        clearToggleQueues();
        await Bun.sleep(60);
        // "first" was already in flight; "second" had not started, and its
        // snapshot describes a file on a machine we are no longer talking to.
        expect(ran).not.toContain("second");
    });

    test("work already in flight can tell that the backend changed under it", async () => {
        // This is the case an entry-only check misses: the switch promotes the
        // new socket before the resets run, so a closure between its read and
        // its write is holding the old machine's bytes and the new machine's
        // socket.
        const wrote: string[] = [];
        queueToggle("/a.md", async (isCurrent) => {
            await Bun.sleep(20); // stands in for `await readFile(path)`
            if (!isCurrent()) return;
            wrote.push("write");
        });
        await Bun.sleep(5);
        clearToggleQueues(); // the switch lands mid-closure
        await Bun.sleep(60);
        expect(wrote).toEqual([]);
    });
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
- Produces: `useBackendStore` with `{ entries, activeId, isLocal, generation, switching, error, pendingTrust, dropped, refresh(), switchTo(id), dismissError() }`, and `checkProtocol(info: SystemInfo): { ok: boolean; reason?: string }`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/stores/backend-store.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION } from "@taskflow/shared";
import type { SystemInfo } from "@taskflow/shared";
import { checkProtocol } from "./backend-store";

const info: SystemInfo = { editors: [], homedir: "/h", hostname: "desktop" };

describe("checkProtocol", () => {
    test("accepts an equal version", () => {
        expect(checkProtocol({ ...info, protocolVersion: PROTOCOL_VERSION })).toEqual({ ok: true });
    });

    test("refuses a different version and names both sides", () => {
        const result = checkProtocol({ ...info, protocolVersion: PROTOCOL_VERSION + 1 });
        expect(result.ok).toBe(false);
        expect(result.reason).toContain(String(PROTOCOL_VERSION));
        expect(result.reason).toContain(String(PROTOCOL_VERSION + 1));
    });

    test("refuses a backend too old to report a version at all", () => {
        // `protocolVersion` is the only optional field on SystemInfo, and this
        // is why: a pre-feature backend answers SYSTEM_INFO without it.
        const result = checkProtocol(info);
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
    /** The active backend's ssh child exited on its own. `activeId` still names
     *  it, but nothing is reachable through it. See `switchTo`'s guard. */
    dropped: boolean;
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
    dropped: false,

    async refresh() {
        const bridge = window.taskflow;
        if (!bridge) return;
        const [entries, active] = await Promise.all([
            bridge.listBackends(),
            bridge.getActiveBackend(),
        ]);
        // `dropped` is **derived** here, not only pushed by the event. The
        // `backend-dropped` message goes to `getMainWindow()?.webContents` and
        // is simply lost when there is no window — and on macOS the app
        // outlives its window (`main.ts:171-177` keeps it alive,
        // `window-manager.ts:168` nulls `mainWindow` on close). Close the
        // window while on a remote backend, let the tunnel die, reopen: main
        // has `activeOrigin === null` and nobody was there to be told. The new
        // renderer starts from `dropped: false`, so the menu ticks the remote
        // row and clicking it lands on `switchTo`'s
        // `id === activeId && !dropped` early return — the single gesture that
        // recovers the connection silently does nothing, and the only way back
        // is to pick "This machine" first and then the remote again, which is
        // exactly the dead end the `dropped` exception exists to remove.
        //
        // A null origin on a non-local backend means precisely that: main has
        // an id it cannot reach. `markTunnelDropped` and `revertActiveBackend`
        // are the two writers, and both mean "dropped".
        const dropped = !active.isLocal && active.origin === null;
        set((state) => {
            // A refresh in flight while a switch is running must not write the
            // active fields, because it is reading a value that is still being
            // decided. `setActive` persists and calls `deps.onChanged()` from
            // inside `switchTo`, *before* `promoteConnection` — that is the
            // deliberate order, main commits first — so `backends-changed`
            // reaches `BackendMenu`'s subscription and starts a `refresh()`
            // that reads the new backend. If the pending socket then dies,
            // `promoteConnection` returns false, `revertActiveBackend` puts
            // main back on the old one, and the catch reports the failure. Two
            // refreshes are now in flight against opposite states, and nothing
            // orders them: should the first land last it writes
            // `activeId: B, isLocal: false, dropped: false` over a renderer
            // that is still talking to A. The menu ticks a backend the app is
            // not connected to, Task 12's remote gating disables local paths
            // for a machine the user is sitting at, and the only thing that
            // repairs it is the next unrelated `backends-changed`.
            //
            // `entries` is still applied: the record list is not part of the
            // contested state, and the menu is the reason this refresh ran.
            // Everything else is re-derived the moment the switch settles —
            // the success path sets it synchronously and then calls `refresh`
            // from its `finally` with `switching` already null, and the
            // failure path is followed by the `onChanged` that
            // `revertActiveBackend` fires.
            if (state.switching !== null) return { entries };
            return {
                entries,
                activeId: active.id,
                isLocal: active.isLocal,
                dropped,
                // The **Reconnect** button renders inside the error banner, so
                // deriving `dropped` without a message would put the one control
                // that fixes this inside a banner that never appears. An existing
                // message wins — it is more specific than this one.
                error:
                    dropped && state.error === null
                        ? "The connection to that backend was lost."
                        : state.error,
            };
        });
    },

    async switchTo(id: string) {
        const bridge = window.taskflow;
        if (!bridge || get().switching !== null) return;
        // Re-selecting the active backend is normally a no-op. It is not when
        // that backend's tunnel has dropped: `activeId` still names it, but the
        // ssh child is gone and the forwarded port is dead, so this is the only
        // way to ask for a new tunnel to the same machine. Without the `dropped`
        // exception the user's only route back is to select "This machine" and
        // then re-select the remote, and until they do it, main's pollers keep
        // fetching a dead origin every tick.
        if (id === get().activeId && !get().dropped) return;

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

        // `pendingTrust` is cleared here, not only in the branches that set it.
        // It names a *record*, and the trust dialog's buttons act on that name.
        // Only the activation-failure branch below rewrites it; the protocol and
        // catch branches set `error` alone, so trust state raised by an earlier
        // switch to A would still be armed while the banner shows B's failure,
        // and "Trust and connect" would silently act on A.
        set({ switching: id, error: null, pendingTrust: null });
        // Declared outside the `try` so the `catch` can undo the unwatch. Stays
        // null on every failure that happens before the unwatch, which makes
        // the restore below a no-op exactly when there is nothing to restore.
        let rewatchPath: string | null = null;
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

            // Read before the unwatch below, and used by the `catch` to put it
            // back. Every failure from here on leaves the renderer on the *old*
            // backend with its watcher already torn down, and nothing restores
            // it: `rebootstrap` and `refresh` are on the success path, and
            // `watchPath` is only called again when the user changes project.
            // The app would sit on a working connection where the file tree
            // stops updating and git status freezes — bad here in particular,
            // because agent sessions write files constantly, so an explorer
            // that has gone quiet reads as an agent doing nothing.
            rewatchPath = useFileStore.getState().watchedPath;

            // The backend keeps one chokidar watcher per watched path and drops
            // it only on an explicit unwatch — `close(ws)` in
            // `packages/backend/src/ws/server.ts:57-59` just removes the socket
            // from the broadcast set — so this has to go out while the old
            // socket is still open.
            //
            // Best-effort, and the `catch` is load-bearing. `unwatchAll` sends
            // over the *current* connection, which is exactly the one that is
            // dead in the two cases where switching matters most: reconnecting
            // after a dropped tunnel, and leaving a backend whose machine went
            // away. `sendRequest` rejects with "WebSocket not connected", the
            // outer catch runs `cancelActivation`, and the tunnel that was just
            // opened successfully is torn down — so a disconnect would make the
            // app unable to switch backends at all, including back to this
            // machine. A watcher we cannot reach is the other side's leak to
            // collect, and it dies with that backend's next restart.
            await useFileStore
                .getState()
                .unwatchAll()
                .catch(() => {});

            // Main is told first: everything up to here is still rollback-able
            // by aborting the pending socket, and nothing after promotion is.
            await bridge.setActiveBackend(id, activation.origin);

            if (!promoteConnection()) {
                // The pending socket died between the handshake and here — ssh
                // exiting is the realistic cause, and there are two awaits in
                // that window. Nothing was waiting on it, so this is the only
                // place that can notice. Falling through would reset the stores
                // and bump the generation with `current` still pointing at the
                // *old* backend: the app would say it was on the new one, every
                // request would go to the old one, and `retirePreviousTunnel`
                // would then kill the tunnel actually in use.
                //
                // Main was told first, so main has to be put back. `revert`
                // restores the previous id and origin and closes the tunnel it
                // is reverting from — the ordering comment above is about what
                // is rollback-able, and this is the rollback.
                await bridge.revertActiveBackend().catch(() => {});
                throw new Error("That backend's connection dropped before the switch completed.");
            }
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
                // A completed switch is what clears `dropped`, including a
                // forced retry of the same id — that is the whole point of the
                // flag, and leaving it set would make every later re-selection
                // of this backend tear down a working connection and rebuild it.
                dropped: false,
                generation: state.generation + 1,
            }));
        } catch (error) {
            abortPending();
            // Same reasoning as the incompatible-protocol branch: everything
            // that can throw between `activateBackend` and `promoteConnection`
            // leaves a tunnel nobody owns. Swallow a failure to close it — the
            // switch already failed and there is nothing else to report.
            await bridge.cancelActivation(id).catch(() => {});
            // The failed switch leaves us on the old backend; put its watcher
            // back. Best-effort: if the old connection is also gone there is
            // nothing to re-watch through, and the reconnect path will rebuild
            // it. This covers the `promoteConnection` branch too — that one
            // throws into here rather than returning.
            if (rewatchPath) {
                await useFileStore
                    .getState()
                    .watchPath(rewatchPath)
                    .catch(() => {});
            }
            set({
                switching: null,
                error: error instanceof Error ? error.message : "Could not switch backend",
            });
            return;
        }

        // Past the point of no return, and therefore outside the try above.
        // The socket is promoted, the stores are reset and the shell has
        // remounted; the switch has happened whatever these do. Folding them
        // into the same `try` had two consequences, both wrong: a throw here
        // painted a red "could not switch backend" banner over a switch that
        // had plainly succeeded, and it skipped `retirePreviousTunnel`, so the
        // ssh child for the backend just left survived — permanently, because
        // the next `setActive` overwrites `previousId` and nothing ever names
        // that tunnel again.
        //
        // `retirePreviousTunnel` runs in its own `finally` for the same reason:
        // it is the only thing here that leaks a process, so it must not be
        // skippable by `rebootstrap` throwing ahead of it.
        try {
            await rebootstrap();
        } catch (bootstrapError) {
            console.error("Re-bootstrap after a backend switch failed:", bootstrapError);
        } finally {
            // The old tunnel is only safe to kill now that nothing is using it.
            await bridge.retirePreviousTunnel().catch(() => {});
            await get().refresh().catch(() => {});
        }
    },

    dismissError() {
        // `dropped` deliberately survives: dismissing the banner hides the
        // message, it does not restore the tunnel. Only a completed switch
        // clears it.
        //
        // Clearing `pendingTrust` is what makes this the trust dialog's Cancel
        // as well as the banner's dismiss — that dialog is mounted off
        // `pendingTrust`, so this is the only thing that closes it without
        // approving a key.
        set({ error: null, pendingTrust: null });
    },
}));

registerReset("backend-store", () => {
    // The backend list itself must survive a switch — it is what you switched
    // with. Only the transient fields reset. `dropped` is not listed because
    // the switch that runs this reset clears it a few lines later, in the same
    // synchronous block as the generation bump; setting it here as well would
    // be a second writer to one flag.
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
- Create: `packages/ui/src/components/sidebar/backend-fields.ts`
- Create: `packages/ui/src/components/sidebar/ConnectBackendDialog.tsx`
- Create: `packages/ui/src/components/sidebar/ManageBackendsDialog.tsx`
- Create: `packages/ui/src/components/sidebar/TrustHostKeyDialog.tsx`
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx:381-395`
- Modify: `packages/ui/src/App.tsx:29-43`
- Modify: `packages/ui/src/components/AppShell.tsx`

**Interfaces:**
- Consumes: Task 10's `useBackendStore`.
- Produces: `<BackendMenu masterWorkspaceActive onMasterWorkspace />`.

- [ ] **Step 1: Build the menu**

Create `packages/ui/src/components/sidebar/BackendMenu.tsx`.

**Read `packages/ui/src/components/workspace/AgentDropdownMenu.tsx` first, and
note that it has two branches.** Like `FileContextMenu`, it builds a
`NativeMenuItem[]` and calls `showNativeMenuAndRun` when `supportsNativeMenus()`
(`AgentDropdownMenu.tsx:146,190`), and falls back to the Radix
`DropdownMenu*` primitives otherwise. That is the app's menu idiom, in both the
desktop app and the browser dev server.

The code below is written against the Radix branch only, and deliberately spells
the structure out rather than abbreviating it — the entries, the active tick,
the liveness dot, the two footer actions. **It is a specification of the menu's
contents, not a licence to hand-roll a third idiom.** Two concrete reasons this
matters rather than being a style note:

- A bare `<div role="menu">` positioned with `absolute` has no dismiss. Nothing
  in this component closes `open` except the trigger and the items themselves,
  so clicking anywhere else in the app leaves the menu sitting over the
  sidebar, and Escape does nothing. Radix's `DropdownMenu` and the native menu
  both handle that; a div does not.
- In the desktop build the native branch is what runs for every other menu, so
  a floating div here is the one menu in the app that does not look or behave
  like the OS.

So: build the entry list once, then render it through both branches the way
`AgentDropdownMenu` does. `NativeMenuItem` has `checked` and `type: "checkbox"`
(`packages/ui/src/env.d.ts:3-10`), which covers the Master Workspace toggle and
the active-backend tick; `enabled: switching === null` covers the disabled rows.
The liveness dot and the instance badge have no native equivalent — fold them
into the label (`desktop — dev`, and a trailing `(not seen)` for an `unseen`
entry) rather than dropping the information.

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
host-key problem. **The trust UI does not live here.** It used to, and that was
wrong twice over:

- Selecting a discovered backend from the menu calls `switchTo(id)` and closes
  the menu. Nothing opens this dialog on that path, so `pendingTrust` was set
  with no mounted consumer: the user got the error text and no fingerprint, and
  first contact with a discovered machine could not be approved at all. Task
  14's Step 6 asks for exactly that flow — "switch to a host whose key is not
  in `known_hosts` → fingerprint dialog; approving connects" — and it could not
  have passed.
- The fingerprint was component state that nothing cleared when
  `pendingTrust.id` changed. Fail host A, show A's fingerprint, correct the
  Host field to B, fail B the same way, and the dialog rendered **A's**
  fingerprint above a button that pins **B's** key.

So the trust flow gets its own component in Step 2b, mounted off `pendingTrust`
itself and keyed by the record id, which fixes both: it is reachable from every
path that can raise trust, and its fingerprint cannot outlive the record it
belongs to. This dialog keeps only the form.

First create `packages/ui/src/components/sidebar/backend-fields.ts`, which holds
the one rule both this dialog and Step 3's manage dialog need. It edits the same
`sshPort` field on the same records, so a second hand-written copy is how one of
them ends up accepting `0` or `65536`. `parsePort` is the only thing it exports:

```ts
/**
 * `Number.parseInt("ssh", 10)` is `NaN`, and `NaN` is not `null`, so a typo in
 * either port field would sail through `addBackend` and land on the record.
 * `manualPort: NaN` then short-circuits `resolveBackendPort` and ssh is handed
 * `-L 0:127.0.0.1:NaN`; worse, `JSON.stringify` writes `NaN` as `null`, so a
 * restart silently converts the typo into "resolve over the port file" and the
 * failure changes shape between runs.
 *
 * `undefined` means the field was left empty, which every caller reads as
 * "not part of this patch"; `"invalid"` is a typo the caller must refuse.
 */
function parsePort(value: string): number | undefined | "invalid" {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return "invalid";
    return parsed;
}

export { parsePort };
```

Then create `packages/ui/src/components/sidebar/ConnectBackendDialog.tsx`. Read
`packages/ui/src/components/sidebar/NewProjectDialog.tsx` first and reuse its
`Dialog` primitives and form layout rather than introducing a second idiom.

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useBackendStore } from "@/stores/backend-store";
import { parsePort } from "./backend-fields";

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
    const [busy, setBusy] = useState(false);

    async function handleSubmit(): Promise<void> {
        const bridge = window.taskflow;
        if (!bridge || host.trim().length === 0) return;
        const parsedSshPort = parsePort(sshPort);
        const parsedPort = parsePort(port);
        if (parsedSshPort === "invalid" || parsedPort === "invalid") {
            useBackendStore.setState({ error: "Ports must be whole numbers between 1 and 65535." });
            return;
        }
        setBusy(true);
        try {
            const record = await bridge.addBackend({
                host: host.trim(),
                user: user.trim() || undefined,
                sshPort: parsedSshPort,
                port: parsedPort,
            });
            await refresh();
            await switchTo(record.id);
            const after = useBackendStore.getState();
            // Close on a clean switch, and also when the failure raised trust:
            // the trust dialog is mounted off `pendingTrust` and takes over
            // from here, so leaving this form stacked under it is just noise.
            if (after.error === null || after.pendingTrust !== null) onOpenChange(false);
        } catch (submitError) {
            // `addBackend` and `refresh` both cross IPC and both reject on an
            // fs error under `userData`. `switchTo` swallows its own failures,
            // but these two do not, and behind `void handleSubmit()` an escaped
            // rejection is a Connect button that silently does nothing. This is
            // the same shape the trust handlers were given; the button every
            // user presses was left without it.
            useBackendStore.setState({
                error:
                    submitError instanceof Error
                        ? submitError.message
                        : "Could not add that backend.",
            });
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

            {/* Trust lives in `TrustHostKeyDialog`, which mounts itself off
                `pendingTrust` — see Step 2b. */}
            {error && pendingTrust === null && <p role="alert">{error}</p>}

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

- [ ] **Step 2b: Build the trust dialog, mounted off `pendingTrust`**

Create `packages/ui/src/components/sidebar/TrustHostKeyDialog.tsx`. It takes the
trust it is for as a prop and owns no identity of its own, so the mount site can
guarantee its fingerprint always belongs to the record on screen:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useBackendStore } from "@/stores/backend-store";

interface TrustHostKeyDialogProps {
    trust: { id: string; kind: "unknown-host-key" | "changed-host-key" };
    label: string;
}

function TrustHostKeyDialog({ trust, label }: TrustHostKeyDialogProps) {
    const switchTo = useBackendStore((s) => s.switchTo);
    const dismissError = useBackendStore((s) => s.dismissError);
    const error = useBackendStore((s) => s.error);
    const [fingerprint, setFingerprint] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function handleShowFingerprint(): Promise<void> {
        const bridge = window.taskflow;
        if (!bridge) return;
        setBusy(true);
        try {
            // `fetchHostKeyFingerprint` throws when `ssh-keyscan` comes back
            // empty, which a host that is down, firewalled on the ssh port, or
            // just slow produces routinely. Called through `void` with no catch
            // this is an unhandled renderer rejection and the button appears to
            // do nothing at all.
            setFingerprint(await bridge.getHostFingerprint(trust.id));
        } catch (scanError) {
            setFingerprint(null);
            useBackendStore.setState({
                error:
                    scanError instanceof Error
                        ? scanError.message
                        : "Could not read that host's key.",
            });
        } finally {
            setBusy(false);
        }
    }

    async function handleTrust(): Promise<void> {
        const bridge = window.taskflow;
        if (!bridge || trust.kind !== "unknown-host-key") return;
        setBusy(true);
        try {
            // `trustBackendHost` pins the key whose fingerprint this dialog
            // showed, and rejects if main has none stashed for this id. The
            // "Trust and connect" button only renders once `fingerprint` is
            // set, so that rejection is a backstop — but it must be surfaced
            // rather than left as an unhandled rejection, because it means the
            // approval and the key have come apart.
            await bridge.trustBackendHost(trust.id);
            // `switchTo` clears `pendingTrust`, which unmounts this component.
            // Nothing after the await may assume it is still mounted.
            await switchTo(trust.id);
        } catch (trustError) {
            setFingerprint(null);
            useBackendStore.setState({
                error:
                    trustError instanceof Error
                        ? trustError.message
                        : "Could not trust that host key.",
            });
        } finally {
            setBusy(false);
        }
    }

    return (
        <div role="dialog" aria-label={`Host key for ${label}`} className="...">
            <p>{error}</p>
            {trust.kind === "changed-host-key" ? (
                // A changed host key is exactly what interception looks like,
                // so no approval is offered — `error` carries ssh's message and
                // the only button closes the dialog.
                <Button onClick={dismissError}>Close</Button>
            ) : fingerprint === null ? (
                <>
                    <Button disabled={busy} onClick={() => void handleShowFingerprint()}>
                        Show host key fingerprint
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={dismissError}>
                        Cancel
                    </Button>
                </>
            ) : (
                <>
                    <pre>{fingerprint}</pre>
                    <p>
                        Trust this host key for {label}? A first-use fingerprint is trusted, not
                        verified — check it against the machine itself if this host came from
                        network discovery.
                    </p>
                    <Button disabled={busy} onClick={() => void handleTrust()}>
                        Trust and connect
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={dismissError}>
                        Cancel
                    </Button>
                </>
            )}
        </div>
    );
}

export { TrustHostKeyDialog };
```

`dismissError` is the cancel path: it clears `error` and `pendingTrust`
together, which unmounts this dialog. There has to be one — without it a trust
prompt raised by a menu selection has no way out except succeeding.

Mount it from `BackendMenu`, next to the other two dialogs, so every path that
can raise trust reaches it — the menu's rows, the connect form, and a
**Reconnect** press after a drop:

```tsx
    const pendingTrust = useBackendStore((s) => s.pendingTrust);
    const trustEntry = entries.find(
        (entry) => entry.kind !== "local" && entry.record.id === pendingTrust?.id,
    );
    // Same shape as `activeEntry` above, and for the same reason: `find`'s
    // result is `MenuEntry | undefined`, so the `kind` test has to be repeated
    // outside the predicate before `.record` is reachable.
    const trustLabel =
        trustEntry === undefined || trustEntry.kind === "local"
            ? (pendingTrust?.id ?? "")
            : trustEntry.record.displayName;

// ...alongside <ConnectBackendDialog /> and <ManageBackendsDialog />:
    {pendingTrust && (
        <TrustHostKeyDialog key={pendingTrust.id} trust={pendingTrust} label={trustLabel} />
    )}
```

The `key` is the load-bearing part, not decoration. `switchTo` sets
`pendingTrust: null` before it calls `activateBackend`, so React normally
unmounts this component between one trust prompt and the next and the
fingerprint dies with it — but that relies on a render landing inside the gap.
Keying on the record id makes the guarantee structural: a fingerprint can never
be shown next to a different backend's name or above a button that pins a
different backend's key.

Add the import to `BackendMenu.tsx` alongside the other two dialogs:

```tsx
import { TrustHostKeyDialog } from "./TrustHostKeyDialog";
```

- [ ] **Step 3: Build the manage dialog**

Create `packages/ui/src/components/sidebar/ManageBackendsDialog.tsx`: a list of saved records with an editable display name, an editable user, an editable ssh port, and a remove button per row, calling `updateBackend(record.id, patch)` and `removeBackend(record.id)` on the bridge and `refresh()` after each.

**Validate before calling `updateBackend`, with the same rules the connect
dialog uses.** This dialog edits the same three fields that dialog collects, on
a record that already works, and the fields it edits are ssh command-line
arguments. Import `parsePort` from `./backend-fields` — the module Step 2
created for exactly this — rather than writing a second one:

```ts
    // `draft` is whatever this dialog keeps the in-progress edits in — one row
    // component's `useState`, or a map keyed by record id. That choice is
    // yours; the validation below is not.
    async function handleSave(
        id: string,
        draft: { displayName: string; user: string; sshPort: string },
    ): Promise<void> {
        const bridge = window.taskflow;
        if (!bridge) return;
        const name = draft.displayName.trim();
        const sshUser = draft.user.trim();
        const parsedSshPort = parsePort(draft.sshPort);
        // Blank is not "leave it alone" here the way it is in the connect
        // dialog — there the field is empty because the user never filled it
        // in and `addBackend` supplies a default, whereas here it is empty
        // because the user cleared a value that was working. Saying so beats
        // quietly restoring `userInfo().username`, which is a different machine
        // account than the one they just deleted.
        if (name.length === 0 || sshUser.length === 0) {
            useBackendStore.setState({ error: "Name and SSH user cannot be empty." });
            return;
        }
        if (parsedSshPort === "invalid") {
            useBackendStore.setState({
                error: "The SSH port must be a whole number between 1 and 65535.",
            });
            return;
        }
        try {
            const result = await bridge.updateBackend(id, {
                displayName: name,
                user: sshUser,
                sshPort: parsedSshPort,
            });
            if (!result.ok) {
                useBackendStore.setState({
                    error: result.reason ?? "Could not save that backend.",
                });
                return;
            }
            await refresh();
        } catch (saveError) {
            useBackendStore.setState({
                error:
                    saveError instanceof Error ? saveError.message : "Could not save that backend.",
            });
        }
    }
```

`parsePort` returns `undefined` for an empty field, and `updateBackend` treats a
missing `sshPort` as "not in this patch", so clearing the port field leaves the
saved one alone. That is deliberate — the port has a meaningful default (22) and
a blank field is not evidence the user wants something else. **This only holds
because `updateBackend` merges field by field rather than spreading the patch**;
see the comment there. It is also why main validates at all: this dialog's guard
is what the user sees, and `updateBackend`'s is what protects the record from a
future third caller.

The refusal comes back as `{ ok, reason }` rather than a rejection, the same
shape `removeBackend` uses two paragraphs down. Do not "simplify" it back to a
throw: Electron prefixes a rejected `ipcMain.handle` with
`Error invoking remote method 'backend-update': `, so the banner would read that
before it got to the sentence the user needs.

Removal can be refused. `removeBackend` returns `{ ok: false, reason }` for the
currently active backend, because deleting the record the app is connected
through leaves `activeId` naming something that is not there — see its comment
in Task 7. Disable the button on that row *and* surface the reason if it comes
back anyway, since `activeId` can change between render and click:

```tsx
const activeId = useBackendStore((s) => s.activeId);
// ...per row:
<Button
    disabled={record.id === activeId}
    title={record.id === activeId ? "Switch to another backend first" : undefined}
    onClick={() => void handleRemove(record.id)}>
    Remove
</Button>
```

```ts
    async function handleRemove(id: string): Promise<void> {
        const bridge = window.taskflow;
        if (!bridge) return;
        try {
            const result = await bridge.removeBackend(id);
            if (!result.ok) {
                useBackendStore.setState({ error: result.reason ?? "Could not remove that backend." });
                return;
            }
            await refresh();
        } catch (removeError) {
            useBackendStore.setState({
                error: removeError instanceof Error ? removeError.message : "Could not remove that backend.",
            });
        }
    }
```

Every bridge call in this dialog gets that shape. `updateBackend` writes to disk
and `refresh` reads main's state; both reject on an fs error, and an
un-caught rejection behind `void` is a button that looks like it did nothing.

Not `addBackend`: it derives the record id from `host`, so using it to edit a
row would leave the original record in place and add a second one under a
different id — visible immediately for any backend that arrived by beacon, whose
id is keyed on the announced hostname rather than the address.

- [ ] **Step 4: Replace the Monitor button**

In `packages/ui/src/components/sidebar/TaskSidebar.tsx`, delete the `Button` at lines 382-394 — that is the `Button` element only, *not* the `<div className="flex items-center">` opening at 381, which the next paragraph tells you to keep and wrap — and render instead:

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
    return window.taskflow?.onBackendDropped((id, failure) => {
        // Read through `getState`, not a captured value: this effect runs once
        // and the active backend changes underneath it.
        if (id !== useBackendStore.getState().activeId) return;
        useBackendStore.setState({ dropped: true, error: failure.message });
    });
}, []);
```

Render `useBackendStore(s => s.error)` as a dismissible banner above the
workspace, wired to `dismissError()`. The same banner carries switch failures
and the unsaved-files refusal from Task 10, so there is one place errors about
backends appear rather than three.

`dropped` is what makes the connection recoverable. Task 10's `switchTo` treats
re-selecting the active backend as a no-op *unless* `dropped` is set, so with
the flag the user gets back by clicking the same row in the menu, and the
`activateBackend` behind it opens a fresh ssh child. Give the banner an explicit
affordance for it rather than leaving the user to guess that clicking the
already-ticked row does anything:

```tsx
const dropped = useBackendStore((s) => s.dropped);
const activeId = useBackendStore((s) => s.activeId);
const switching = useBackendStore((s) => s.switching);
const switchTo = useBackendStore((s) => s.switchTo);

// ...in the banner:
{dropped && (
    <Button disabled={switching !== null} onClick={() => void switchTo(activeId)}>
        Reconnect
    </Button>
)}
```

Three separate selectors rather than one object selector: this store is a plain
zustand `create`, so a selector returning a fresh object re-renders `AppShell`
on every unrelated `set` — the same trap the rest of the codebase already
avoids.

The reconnect goes through the full switch — handshake, reset, remount — not a
socket-level retry. The backend on the other side has not necessarily restarted,
but this client cannot tell the difference between an ssh process that died and
a machine that rebooted, and re-running the switch is correct for both.

**None of the above is reachable until `ConnectionOverlay` stops covering it.**
`packages/ui/src/App.tsx:29-43` renders `<ConnectionOverlay />` as a sibling of
`<AppShell>`, and it is a `fixed inset-0 z-50` blocking layer shown whenever the
WebSocket is not connected. `AppShell` sets no `z-` class anywhere, so the
banner this step just added, its **Reconnect** button, and the backend menu in
the sidebar are all *underneath* it.

That is not a corner case — it is the main line of this whole feature. A remote
tunnel dies, the socket to it closes, `connected` goes false, and the overlay
drops over the app. The backoff in Task 8 keeps redialling a forwarded port
that no longer forwards anywhere, so every attempt fails and `connected` never
comes back: the overlay stays up for good, over a blurred, unclickable
**Reconnect** button that exists precisely for this moment. The user's only way
out is to quit and relaunch, and only because startup always begins on local.
The same overlay is what a user meets in the window-reopen case that Task 10's
`refresh()` derives `dropped` for, except that there it says "No backend is
running" — `WebSocketProvider` throws on a null origin before a socket is ever
opened. That case only works because Task 8 has the provider run `refresh()`
*before* it throws; without it the store is still at `isLocal: true` and the
branch below picks blocking for a remote failure. The two edits are one fix in
two files.

The overlay is right for what it was written for — the *local* backend
restarting, where there is nothing to click and waiting is the answer. It is
wrong the moment there is a backend menu behind it. Change it so the shell's
backend controls stay usable:

```tsx
function ConnectionOverlay() {
    const { connected, error } = useWsStatus();
    const isLocal = useBackendStore((s) => s.isLocal);
    const dropped = useBackendStore((s) => s.dropped);
    if (connected) return null;
    // Only the local backend gets the blocking treatment. When a remote one is
    // active the two controls that can fix this — the backend menu and the
    // banner's Reconnect — live underneath, so the overlay must not eat their
    // clicks. `pointer-events-none` on the backdrop, `pointer-events-auto` on
    // the card, so the message stays readable and selectable without trapping
    // the pointer.
    //
    // `&& !dropped` is the second belt. `isLocal` is right on its own only for
    // as long as something keeps it current, and the thing that does is one
    // `refresh()` call at the top of `WebSocketProvider.connect()`. If that
    // ever stops running — an early return added above it, a refactor that
    // moves the connect — `isLocal` falls back to its initial `true` and this
    // branch goes back to blocking the Reconnect button on the exact path it
    // was added for. `dropped` is set by the same refresh and by the
    // `backend-dropped` event, so it survives one of the two going missing.
    // Two separate selectors, not one object selector: see the banner above.
    const blocking = isLocal && !dropped;
    return (
        <div
            className={cn(
                "fixed inset-0 z-50 flex items-center justify-center",
                blocking ? "bg-background/80 backdrop-blur-sm" : "pointer-events-none",
            )}>
            <div
                className={cn(
                    "space-y-2 text-center",
                    blocking ? undefined : "bg-background/95 pointer-events-auto rounded-md border p-3 shadow-md",
                )}>
                {/* ...unchanged message content */}
            </div>
        </div>
    );
}
```

`App.tsx` imports neither of these today — add
`import { cn } from "@/lib/utils";` and
`import { useBackendStore } from "@/stores/backend-store";`. `isLocal` starts
`true` (`backend-store.ts`, initial state) and `dropped` starts `false`, so
first paint while the *local* backend is still coming up keeps today's blocking
overlay, which is what that moment wants. First paint onto a *remote* backend
does not reach this component with the initial state, because Task 8's
`WebSocketProvider` awaits `refresh()` before it can throw — that is what makes
the initial value a safe default rather than a wrong one.

In the non-blocking form the card floats over the workspace and everything
behind it still takes clicks, so the sidebar menu and the banner work. Do not
"simplify" this by deleting the overlay outright: the local-backend restart it
was written for still needs it, and the browser dev server has no backend menu
to fall back on at all.

- [ ] **Step 6: Explain an empty list on macOS**

A denied local-network permission is silent from inside the process: no error,
no datagrams, an empty list — identical to a network with nothing on it. That
makes it the one discovery failure a user cannot diagnose, so the menu says so.
Compute the condition once and render it through both branches:

```ts
const showLocalNetworkHint = entries.length === 1 && navigator.platform.startsWith("Mac");
const localNetworkHint =
    "No other backends found — check System Settings → Privacy & Security → Local Network";
```

Native branch — `NativeMenuItem` has `type: "label"`
(`packages/ui/src/env.d.ts:8`), which is exactly an unselectable note:

```ts
if (showLocalNetworkHint) items.push({ type: "label", label: localNetworkHint });
```

Radix branch:

```tsx
{showLocalNetworkHint && (
    <DropdownMenuLabel className="text-muted-foreground text-[10px]">
        {localNetworkHint}
    </DropdownMenuLabel>
)}
```

This is the macOS-only case on purpose: it is the only platform that can deny
multicast receive without saying so.

- [ ] **Step 7: Keep the non-Electron renderer working**

With no `window.taskflow`, `refresh()` returns early and `entries` stays
`[{ kind: "local" }]`. Disable "Connect to backend…" and "Manage backends…" in
that case so they are visible but inert:

```tsx
    const hasBridge = typeof window.taskflow !== "undefined";
```

and put `disabled={!hasBridge}` on both. This only ever bites in the Radix
branch: `supportsNativeMenus()` tests for `window.taskflow.showNativeMenu`, so
the native branch cannot run without a bridge and `hasBridge` is always true
there. Do not skip it on that reasoning, though — the Radix branch *is* the
no-bridge case, and it is the one this step is about.

Verify with `bun run dev:ui` against a backend started by `bun run dev:backend`:
the menu opens, shows one entry, and nothing throws.

- [ ] **Step 8: Verify by hand**

Run: `bun run dev:backend` in one terminal and `bun run dev:electron` in another.
Expected: the bottom-left icon opens a menu listing Master Workspace and "This machine", both marked. A second machine on the LAN running Taskflow appears within five seconds of opening the menu.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/components/sidebar packages/ui/src/components/AppShell.tsx packages/ui/src/App.tsx
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
- Modify: `packages/ui/src/components/panels/FileContextMenu.tsx:107,138-192`
- Modify: `packages/ui/src/components/panels/WikiPanel.tsx:113,118`
- Modify: `packages/ui/src/components/panes/MarkdownPane.tsx:50-53`
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx:278-285`
- Modify: `packages/ui/src/components/panes/terminal/terminal-links.ts:64-72`
- Modify: `packages/ui/src/components/panes/terminal/terminal-link-provider.ts:243-245`
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

In each of `MissingLocationDialog.tsx`, `SettingsModal.tsx`, `ImportTab.tsx` and `FlowInputDialog.tsx`, add `const isLocal = useBackendIsLocal();` and set `disabled={!isLocal}` plus `tooltip={isLocal ? undefined : "Only available on the machine running this backend"}` on the browse button.

`NewProjectDialog.tsx` needs more than that, and folding it into
`hasElectronPicker` would make things **worse**. `hasElectronPicker` is a
branch, not a gate (`NewProjectDialog.tsx:70`): when it is false the dialog
renders a plain `<Input>` for a hand-typed path (`:81`), and Submit is only
`disabled={!canSubmit}`, where `canSubmit` is `path.trim() !== ""` (`:38,99`).
So making `hasElectronPicker` false on a remote backend *removes the browse
button and reveals the manual text field* — the user types a path, presses
Create, and a project is created on the remote backend. Task 14's Step 5
explicitly expects "Add project is disabled".

Gate the dialog itself, and leave `hasElectronPicker` alone:

```ts
    const isLocal = useBackendIsLocal();
    const canSubmit = isLocal && path.trim() !== "";
```

and render the reason in place of the form when `!isLocal`, so the button is
not just inert:

```tsx
    {!isLocal && (
        <p className="text-muted-foreground text-xs">
            Projects can only be added on the machine running this backend.
        </p>
    )}
```

Gate the entry point too, so the dialog is not reachable at all:
`TaskSidebar.tsx:278-285` renders the "New project" `Button` that calls
`handleOpenProjectDialog`. Add `disabled={!isLocal}` and the same tooltip. Both,
not one: the sidebar button is what Task 14 checks, and the dialog guard is what
holds if any other caller opens it.

- [ ] **Step 6: Gate the reveal sites — and only those**

`packages/ui/src/components/panels/FileContextMenu.tsx` renders **two menus, not
one**, and gating the one you can see in the JSX gates the one that never runs.
`supportsNativeMenus()` is true whenever `window.taskflow.showNativeMenu` exists
(`packages/ui/src/lib/native-menu.ts:24-26`) — which is always, in the desktop
app, which is the only place a remote backend exists at all. So
`FileContextMenu.tsx:210` takes the native branch and the Radix
`<ContextMenu>` below it is dead code there. Gate both.

The items are "Open in External Editor" and "Reveal in Finder"; both hand a path
to *this* machine's editor or file manager. Add the hook once:

```tsx
    const isLocal = useBackendIsLocal();
```

Native branch, inside `handleNativeContextMenu` (`:174-184`) — `NativeMenuItem`
carries `enabled` (`packages/ui/src/env.d.ts:6`), so the items stay visible and
greyed rather than disappearing and moving everything else up:

```ts
            if (!isDirectory) {
                items.push({ id: "open-external", label: "Open in External Editor", enabled: isLocal });
                actions["open-external"] = handleOpenExternal;
            }

            items.push(
                { id: "reveal", label: "Reveal in Finder", enabled: isLocal },
                { id: "open-terminal", label: "Open in Terminal" },
            );
```

Add `isLocal` to `handleNativeContextMenu`'s dependency array (`:195-206`) — it
is a `useCallback`, and without it the menu keeps the enablement from whichever
backend was active when the callback was last built.

Radix branch (`:254-264`), for the browser dev server where
`supportsNativeMenus()` is false:

```tsx
                        {!isDirectory && (
                            <ContextMenuItem disabled={!isLocal} onSelect={handleOpenExternal}>
```

and the same `disabled={!isLocal}` on the "Reveal in Finder" item.

"Open in Terminal" is deliberately not gated: it creates a session on the
backend, like `runInShell` below, and works fine remotely.

`packages/ui/src/components/panels/WikiPanel.tsx` has the same two affordances
under a different menu, and it is the one the file-tree sweep misses because it
does not go through `useFileStore.openExternal`. Its wiki-root dropdown offers:

- **Open in Obsidian** (`:113`) → `openInObsidian(root)`
  (`packages/ui/src/lib/wiki/open-in-obsidian.ts:10`), which fires an
  `obsidian://open?path=…` URL at *this* machine's Obsidian with the backend's
  absolute path. Against a remote backend that either opens nothing or opens a
  same-named local vault — the wrong notes, silently.
- **Reveal in Finder** (`:118`) → `useFileStore.getState().revealInFinder(root)`,
  the same client-side reveal `FileContextMenu` gates.

Gate both on `useBackendIsLocal()`. This one is Radix-only — `WikiPanel` has no
`supportsNativeMenus` branch — so a single `disabled` on each item is the whole
fix:

```tsx
    const isLocal = useBackendIsLocal();
// ...
    <DropdownMenuItem
        disabled={!isLocal || obsidian.vault !== "registered"}
        title={isLocal ? undefined : "Only available on the machine running this backend"}
```

"New page" stays enabled: it writes through the backend.

`packages/ui/src/components/panes/MarkdownPane.tsx:50-53` is the **second** call
site of that same `openInObsidian`, and it is not a menu — it is a toolbar
button, so both sweeps above miss it. `MarkdownPane` computes
`canOpenInObsidian` from `fetchObsidianState(wikiRoot)` (`MarkdownPane.tsx:33-50`),
which is a *backend* request (`MSG.WIKI_OBSIDIAN_STATE`): on a remote backend
the **other** machine answers "installed, vault registered", and
`packages/ui/src/components/panes/markdown/MarkdownToolbar.tsx:57` renders the
button on **this** one. Clicking it calls `openInObsidian(filePath)` with the
remote machine's absolute path.

Gate it in `MarkdownPane`, not in `MarkdownToolbar` — the toolbar only renders
what it is handed, and `canOpenInObsidian` is the flag it is handed:

```tsx
    const isLocal = useBackendIsLocal();
// ...
    const canOpenInObsidian =
        isLocal && obsidian?.installed === true && obsidian.vault === "registered";
```

**One correction to the WikiPanel paragraph above.** "Opens a same-named local
vault — the wrong notes, silently" is what *would* happen; today nothing happens
at all, on any machine, local included. `openInObsidian` goes through
`window.taskflow.openExternalUrl`
(`packages/ui/src/lib/wiki/open-in-obsidian.ts:11`), and
`electron/src/ipc-handlers.ts:74` returns early for any URL that does not start
with `http://` or `https://` — so the `obsidian://` deep link is dropped in main
and `shell.openExternal` is never reached. That is a pre-existing bug in shipped
code and out of scope for this plan; the gating stays correct either way, and
becomes load-bearing the moment that scheme guard is widened.

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

The same file is not the only reveal site. `packages/ui/src/components/panes/terminal/terminal-link-provider.ts:243-245`
calls `window.taskflow?.showItemInFolder(resolved)` when a *directory* link is
Cmd/Ctrl-clicked, which hands a backend path to the client's Finder. It needs the
same guard:

```ts
    if (stat.isDirectory) {
        if (isExternal) {
            if (!backendIsLocal()) return;
            window.taskflow?.showItemInFolder(resolved);
```

The non-external branch below it (`expandToPathAndLoad`) stays: that opens the
path in Taskflow's own explorer, which reads it through the backend.

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
import type { FlowArtifact, FlowRun } from "@taskflow/shared";

/**
 * `FlowRun` requires `startedAt` and every `FlowArtifact` requires `createdAt`
 * (`packages/shared/src/types/flow.ts:106` and `:82`). Spelling them out in each of
 * the four runs below is four chances to forget one and fail typecheck before
 * the route is ever exercised, and none of these tests care what the stamps
 * are.
 */
function run(artifacts: FlowArtifact[]): FlowRun {
    return {
        projectId: "p1",
        flowId: "f1",
        status: "completed",
        currentActionIndex: 0,
        actions: [],
        artifacts,
        startedAt: "2026-08-23T00:00:00.000Z",
    };
}

function artifact(fields: Omit<FlowArtifact, "actionEntryId" | "createdAt">): FlowArtifact {
    return { ...fields, actionEntryId: "a1", createdAt: "2026-08-23T00:00:00.000Z" };
}

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
        await flowStore.saveFlowRun(run([artifact({ type: "report", path: artifactPath })]));

        const response = await router.handle(
            new Request("http://x/api/flow/artifact/p1/f1/report/raw"),
        );
        expect(response?.status).toBe(200);
        expect(await response?.text()).toBe("hello");
    });

    it("serves an artifact whose type needed url encoding", async () => {
        const dir = await mkdtemp(join(tmpdir(), "artifact-"));
        const artifactPath = join(dir, "notes.md");
        await writeFile(artifactPath, "spaced");

        const { router, flowStore } = await buildTestRouter();
        await flowStore.saveFlowRun(run([artifact({ type: "review notes", path: artifactPath })]));

        const response = await router.handle(
            new Request(`http://x/api/flow/artifact/p1/f1/${encodeURIComponent("review notes")}/raw`),
        );
        expect(response?.status).toBe(200);
        expect(await response?.text()).toBe("spaced");
    });

    it("404s for an artifact the run recorded as inline text", async () => {
        // The UI keeps sending these through `saveArtifact({ text })`; this
        // asserts the route's behaviour for the case, so a later change that
        // routes them here fails loudly instead of silently 404ing a download.
        const { router, flowStore } = await buildTestRouter();
        await flowStore.saveFlowRun(run([artifact({ type: "report", text: "inline" })]));
        const response = await router.handle(
            new Request("http://x/api/flow/artifact/p1/f1/report/raw"),
        );
        expect(response?.status).toBe(404);
    });

    it("404s for a type the run never produced", async () => {
        const { router, flowStore } = await buildTestRouter();
        await flowStore.saveFlowRun(run([]));
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
            // `ApiRouter` hands back the raw regex capture with no decoding
            // (`packages/backend/src/api/router.ts:36-39`), and an artifact type
            // is any string an agent passed to the CLI — `review notes` is
            // legal. Without this the comparison is against "review%20notes".
            const artifacts = flowRunner.getArtifacts(run, decodeURIComponent(params.type));
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
                                        void window.taskflow?.saveArtifact(
                                            a.path
                                                ? {
                                                      url: `/api/flow/artifact/${ownerId}/${run.flowId}/${encodeURIComponent(a.type)}/raw`,
                                                      defaultName,
                                                  }
                                                : { text: a.text, defaultName },
                                        );
```

**Keep the text branch.** `FlowArtifact` is `{ path?: string; text?: string }`
(`packages/shared/src/types/flow.ts:74-75`) and the current call already passes
both (`FlowPanel.tsx:308-312`). An artifact recorded as inline text has no path,
so routing it through the raw endpoint would hit `artifacts[0]?.path` being
undefined and 404 — a download that works today would stop working. Only a path
artifact needs the backend round trip; text is already in the renderer.

`ownerId` is the run's owner id — do not spell it out. `FlowPanel` already has
an `ownerId` prop; use it, exactly as the existing
`/api/flow/artifact/:ownerId/:flowId` calls in this file do. It is emphatically
not the literal `"master"` for a master flow: the shared constant is
`MASTER_OWNER_ID = "__master__"` (`packages/shared/src/types/flow.ts:85`), and
`getFlowRunOwnerId` (`:125-129`) is what derives it. A hand-built `"master"` URL
404s on every master flow artifact.

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
- Switch to a host whose key is not in `known_hosts` **by picking it from the
  menu, not from the connect form** → fingerprint dialog; approving connects.
  The menu path is the one that was broken: the trust UI used to live inside
  the connect dialog, which that path never opens.
- With that prompt up, press Cancel → it closes and the app stays where it was.
- Add a backend by typing its short hostname (`desktop`, not its IP) while its
  beacon is visible, connect, quit, and reopen `backends.json` under
  `userData`. Expected: `host` is still `desktop`. An IP there means
  `mergeForMenu` is rewriting a manual host and the name is unrecoverable.
- Connect to a remote backend, open **Manage backends…**, and try to remove the
  row you are connected through. Expected: the button is disabled and says to
  switch away first.
- Start a repository-wide search on a remote backend and switch backends while
  it is still running. Expected: the new backend's search panel is empty and
  idle. `Backend switched` in its error slot means the `search-store.ts:120`
  guard is missing.
- On a remote backend, right-click a file in the explorer. Expected: "Open in
  External Editor" and "Reveal in Finder" are greyed out. If they are live, the
  native menu branch was missed — the desktop app never renders the Radix one,
  so gating only the JSX looks correct in review and changes nothing.
- Open the backend menu and click somewhere else in the app. Expected: it
  closes. A menu that stays open means it was hand-rolled as a `<div>` instead
  of going through the two branches Step 1 asks for.
- Occupy the discovery port before starting the backend
  (`nc -ulk 47654` in another terminal, or any process that binds it
  exclusively) and start Taskflow. Expected: it finishes starting, logs
  "Taskflow LAN discovery is unavailable", and works with discovery simply
  absent. A backend that prints its "running on port" line and then hangs means
  a failed UDP bind is wedging `advertiser.start()`.
- Connect to a remote backend, let its tunnel drop, press **Reconnect**, and
  make the handshake fail (stop Taskflow on the other machine first, leaving
  ssh reachable). Expected: `pgrep -fl "ssh -N -L"` shows no child afterwards.
  One left behind means `revertActiveBackend` is skipping the tunnel it just
  opened because the reconnect re-activated the same id.
- Add a backend by host while Taskflow is **not** running on that machine, with
  the Backend port field left blank. Expected: the error names the machine and
  points at the port field. "SSH exited with code 1." means `readRemotePort` is
  still handing a failed `cat` to `classifyTunnelFailure`.
- Connect to machine B, then kill its ssh child (`pkill -f "ssh -N -L"`).
  Expected: the dropped banner and the sidebar's backend menu are both still
  clickable, and **Reconnect** works. A blurred, unclickable screen saying
  "Connecting to backend…" means `ConnectionOverlay` is still the blocking
  variant while a remote backend is active — and there is no way out of it
  except quitting.
- macOS only: connect to machine B, close the window (the app stays in the menu
  bar), kill B's ssh child, then reopen the window from the dock. Expected: the
  app comes back with the dropped banner and a working **Reconnect**. A ticked
  B row that does nothing when clicked means `refresh()` is not deriving
  `dropped` from a null origin, and the `backend-dropped` event that would have
  set it was sent while no window existed. A full-screen blur saying "No backend
  is running", with the menu unreachable underneath it, means the derivation is
  fine but nothing ran it: `WebSocketProvider.connect()` is missing its
  `refresh()` call, so `ConnectionOverlay` is still reading the initial
  `isLocal: true` and blocking.
- Turn Wi-Fi off, launch Taskflow on both machines, then turn Wi-Fi back on and
  wait a minute. Expected: each machine appears in the other's backend menu
  without a restart. One-sided is the tell, and it is the shape this bug takes:
  `sendToGroup` re-enumerates interfaces per announce so *announcing* recovers
  on its own, while a one-shot `addMembership` at bind time means *receiving*
  never does. If A sees B but B does not see A, B's `keepMembershipsCurrent`
  timer is not running.
- In Settings → General, paste a 200-character name into "Name on the network".
  Expected: the field stops accepting input at 64. If it takes the whole string,
  this backend will vanish from every other machine's menu the moment it
  announces, with nothing logged anywhere — `parseDatagram` drops the datagram
  over `DISCOVERY_MAX_DATAGRAM_BYTES` before it parses far enough to complain.
- Open the backend menu → **Manage backends**, clear the SSH user on a saved
  remote row and save. Expected: an inline "Name and SSH user cannot be empty."
  and no write. Then put a valid user back, type `0` in the SSH port and save.
  Expected: the whole-number refusal. If either saves, `updateBackend`'s
  validation is missing and the next connection to that row will fail with an
  ssh error that names nothing the user touched.
- On a remote backend, open a wiki page in preview and look at the markdown
  toolbar. Expected: no Obsidian button. It appearing means only the wiki root's
  menu was gated and `MarkdownPane`'s `canOpenInObsidian` still trusts the
  *remote* machine's answer about the *local* machine's Obsidian.
- On a remote backend, open the wiki root's menu. Expected: "Open in Obsidian"
  and "Reveal in Finder" are greyed out, "New page" is not.
- Connect to machine B, then start a switch and kill B's `ssh` child from a
  terminal (`pkill -f "ssh -N -L"`) while the switch is running. Expected: an
  error banner, and the app is still on the backend it started from —
  `pgrep -fl "ssh -N -L"` shows no child for B. If the app claims it is on B
  while showing the previous backend's projects, `promoteConnection`'s return
  value is being ignored.
- Quit, add `"hostSource"` and `"manualPort"` by hand to a record in
  `backends.json`, delete both again, and relaunch. Expected: the backend still
  connects. `Bad local forwarding specification` in the failure banner means
  `normalizeRecords` was skipped and `manualPort: undefined` reached ssh.
- Open a file, type into it without saving, then try to switch → refused, naming the unsaved file.
- Pull the network while a remote backend is active → disconnected banner. ssh
  gives up after `ServerAliveInterval` × `ServerAliveCountMax`, roughly 45
  seconds, and its exit turns the banner into the dropped-tunnel one with a
  **Reconnect** button. Restore the network and press it: the app switches to
  the same backend again — a fresh tunnel, handshake, reset and remount — rather
  than resuming the old socket. Confirm `pgrep -fl "ssh -N -L"` shows exactly
  one child afterwards, not two.
- Switch to a backend running an incompatible `PROTOCOL_VERSION` → refused with both
  numbers named, and `pgrep -fl "ssh -N -L"` shows no ssh child left behind. The
  leak this checks for is invisible from the UI, so check the process list.

- [ ] **Step 6a: Confirm the two silent leaks are closed**

Neither of these is visible from the UI, and both were live in earlier drafts of
this plan, so they are checked from the process list and the filesystem.

- Start a switch to a host that is reachable over ssh but has no Taskflow
  running, and quit the app *during* the ten-second readiness wait. Then
  `pgrep -fl "ssh -N -L"`. Expected: nothing. A surviving child means the tunnel
  is being registered on success rather than on spawn.
- Connect to machine B, then restart Taskflow on B while A stays connected.
  A's tunnel drops; press **Reconnect**. Expected: it connects, because the port
  is re-read from B's `~/.config/taskflow/main.port` rather than from A's cached
  copy of B's previous port. To be sure the port file is what did it, run this
  with B's beacon off (Settings → General → "Discoverable on this network"), so
  discovery cannot supply the answer.

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

- [ ] **Step 6d: Confirm a switch survives a dead old socket**

The switch sends `FILE_UNWATCH` over the connection it is leaving, and after a
drop that connection is gone. Open a project on a remote backend so a file
watcher is active, then kill the ssh child from a terminal
(`pkill -f "ssh -N -L"`). When the dropped banner appears, press **Reconnect**,
and separately try selecting "This machine".

Expected: both work. If either fails with "WebSocket not connected", the
`unwatchAll` call in `switchTo` has lost its `catch` and a disconnect has left
the app unable to switch backends at all.

- [ ] **Step 7: Confirm the caches actually cleared**

After a switch, open the new-session agent picker and the external-editor menu. Both must list what is installed on the machine you switched *to*. This is the check the unit tests approximate; the caches are the most likely thing to be quietly wrong.

- [ ] **Step 8: Commit any fixes**

```bash
git add -A
git commit -m "fix: address multi-backend end-to-end findings"
```

---

## Deferred

Out of scope for this plan, recorded so nobody adds them on the way past:
telling apart two machines that answer to the same hostname *and* the same
instance id — the listener keeps whichever is still announcing (Task 3), so the
menu shows one row and the other machine is invisible; showing several backends' records in one view; keeping non-active backends connected for notifications; per-client session viewports; creating or repairing projects on a remote host; the TUI adopting the discovery listener.
