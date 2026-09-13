import { execFile, spawn, type ChildProcess } from "node:child_process";
import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { isSafeLabel } from "@taskflow/shared/discovery";
import type { BackendRecord, TunnelFailure } from "@taskflow/shared";
import {
    buildKeyscanArgs,
    buildTunnelArgs,
    classifyTunnelFailure,
    hostKeyOptions,
    KNOWN_HOSTS_FILE,
    knownHostsKey,
} from "./tunnel-args";

interface ActiveTunnel {
    child: ChildProcess;
    localPort: number;
    /** False until the readiness probe has answered. See `pendingOpens` below. */
    established: boolean;
}

type TunnelResult = { ok: true; localPort: number } | { ok: false; failure: TunnelFailure };

/** What one `openTunnel` attempt files its child under, and whether it was told to stop. */
interface OpenContext {
    /** Moved by `rekeyTunnel` while the open is in flight. */
    id: string;
    /** Set by `closeTunnel`, so a closed open spawns nothing more. */
    cancelled: boolean;
}

interface PendingOpen {
    ctx: OpenContext;
    promise: Promise<TunnelResult>;
}

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

/**
 * One attempt per record id. A second caller awaits the first rather than
 * racing it, and only an `established` tunnel short-circuits: a child is in
 * `tunnels` from spawn, but its port does not forward until readiness answers,
 * and a caller handed that port early is refused and marks the machine offline
 * while the first call succeeds moments later. Several callers for one id is
 * the normal case — the launch dial, the renderer's attach and `retry` all open.
 */
const pendingOpens = new Map<string, PendingOpen>();

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
 */
function hasTunnel(id: string): boolean {
    return tunnels.has(id);
}

/** The id a child is filed under right now, which `rekeyTunnel` may have changed. */
function idOf(entry: ActiveTunnel): string | null {
    for (const [id, tunnel] of tunnels) if (tunnel === entry) return id;
    return null;
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
 * "Taskflow backend" (`packages/backend/src/ws/server.ts` — `/` falls past the
 * API router to exactly that string), and the body is what gets checked. A
 * status check alone is not enough: the port being forwarded to can be a
 * *stale* one — a remembered port the remote machine may have handed to
 * something else since — and any HTTP server answering 200 there would pass.
 * The failure then resurfaces much later, as an unexplained WebSocket error.
 *
 * `stopped` ends the wait early once the open was closed or the app is
 * quitting, so nobody waits out the timeout on a child that was killed.
 */
async function waitForBackend(localPort: number, stopped: () => boolean): Promise<boolean> {
    const deadline = Date.now() + READINESS_TIMEOUT_MS;
    while (Date.now() < deadline && !stopped()) {
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
            resolve({ stdout, stderr: stderr + (error ? error.message : ""), code });
        });
    });
}

/**
 * The manual-connect fallback for hosts multicast cannot reach. Returns the
 * classified failure rather than a bare null: a missing ssh binary reported as
 * "could not work out which port" sends the user looking at the wrong machine.
 *
 * The path mirrors the backend's `config.instancePortFile`, which is
 * `join(getConfigBaseDir(), `${instanceId}.port`)` — on macOS and Linux that is
 * `~/.config/taskflow`, NOT `~/.taskflow` (`packages/backend/src/services/platform.ts`).
 * A Windows backend keeps it under %APPDATA% and cannot be read this way, and
 * neither can one started with `TASKFLOW_CONFIG_DIR`; those hosts need
 * discovery or an explicit port in the connect dialog.
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
    // The same host-key options as `buildTunnelArgs`, and they matter more here:
    // this is the *first* ssh call a manual connect makes, so it is the one that
    // produces the host-key failure the trust dialog reacts to. Left to the
    // user's `~/.ssh/config`, an `accept-new` policy pins the key here, silently,
    // before a tunnel is ever attempted — and every later call finds a host that
    // is already trusted.
    const { stdout, stderr, code } = await runSsh([
        "-p",
        String(record.sshPort),
        "-o",
        "BatchMode=yes",
        ...hostKeyOptions(record),
        "-l",
        record.user,
        "--",
        record.host,
        `cat ${remotePath}`,
    ]);
    const port = Number.parseInt(stdout.trim(), 10);
    if (Number.isInteger(port) && port > 0) return { port };

    // ssh reserves 255 for its own failures — auth, host keys, no route — and
    // otherwise exits with the *remote command's* status. So a code that is
    // neither 255 nor null means the connection worked and `cat` failed, which
    // is the single most likely outcome of a first manual connect: Taskflow is
    // not running over there, or it is running as a different user than the one
    // we logged in as, so `~` is a different home. `classifyTunnelFailure`
    // matches only ssh's own stderr and would say "SSH exited with code 1.",
    // which names neither the cause nor the remedy.
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
        stderr += error.message;
    });
    return {
        child,
        readStderr: () => stderr,
    };
}

/**
 * Set by `closeAllTunnels` and never cleared: its only caller is `will-quit`,
 * and nothing after that expects to open a tunnel.
 *
 * `closeAllTunnels` kills what is *in* `tunnels`, and an open still in flight
 * is not in it yet. There are two windows where the map is empty and an `ssh`
 * child is nevertheless on its way: inside `attemptTunnel`, between
 * `await allocateLocalPort()` and `spawnTunnel`; and inside `runOpen`, between
 * one awaited attempt and the next. Quit during either and the sweep is a
 * no-op, the pending microtask resolves anyway, `spawn` runs, and the child
 * outlives the app — a port forward into another machine held open by a
 * process with no parent left to close it.
 */
let closing = false;

function isStopped(ctx: OpenContext): boolean {
    return closing || ctx.cancelled;
}

/** The shape every stop check returns. Nobody renders it — the open was closed
 *  or the app is going away — but the promise must still settle, or its
 *  callers hang. */
function stoppedResult(): TunnelResult {
    return {
        ok: false,
        failure: {
            kind: "unknown",
            message: closing ? "Taskflow is quitting." : "The tunnel was closed.",
            stderr: "",
        },
    };
}

async function attemptTunnel(
    record: BackendRecord,
    backendPort: number,
    ctx: OpenContext,
): Promise<TunnelResult> {
    if (isStopped(ctx)) return stoppedResult();
    const localPort = await allocateLocalPort();
    // Checked again on the far side of the await, which is the point: this is
    // where the map is empty and the child does not exist yet.
    if (isStopped(ctx)) return stoppedResult();
    const { child, readStderr } = spawnTunnel(record, localPort, backendPort);
    // Registered before the readiness probe runs, not after it succeeds, so
    // `closeAllTunnels` on quit can see it. See the comment on `tunnels`.
    const entry: ActiveTunnel = { child, localPort, established: false };
    tunnels.set(ctx.id, entry);

    /** Drops this attempt's registration, under whatever id it now has, without
     *  disturbing a later one. */
    const deregister = (): void => {
        const id = idOf(entry);
        if (id !== null) tunnels.delete(id);
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
            // Read before deregistering: after a rekey this is the uid, the id
            // the renderer knows the machine by.
            const id = idOf(entry);
            deregister();
            if (entry.established) {
                if (id !== null) exitHandler?.(id, failure);
                return;
            }
            resolve(failure);
        });
    });
    const ready = waitForBackend(localPort, () => isStopped(ctx)).then((ok) =>
        ok ? null : "not-ready",
    );

    const outcome = await Promise.race([exited, ready]);

    if (isStopped(ctx)) {
        // Closed while probing. `closeTunnel` already killed a registered
        // child; this covers one the probe answered for just before the close.
        deregister();
        child.kill();
        return stoppedResult();
    }

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

async function runOpen(
    record: BackendRecord,
    backendPort: number,
    ctx: OpenContext,
): Promise<TunnelResult> {
    let last: TunnelResult = {
        ok: false,
        failure: { kind: "unknown", message: "Tunnel never started.", stderr: "" },
    };
    for (let attempt = 0; attempt < LOCAL_PORT_ATTEMPTS; attempt++) {
        last = await attemptTunnel(record, backendPort, ctx);
        if (last.ok) return last;
        // Only a lost local port is worth retrying; everything else is terminal.
        if (last.failure.kind !== "local-bind-failed") return last;
        // A retry is a fresh spawn, so it needs the same guard the first
        // attempt got — this loop is the second of the two empty-map windows.
        if (isStopped(ctx)) return stoppedResult();
    }
    return last;
}

/**
 * Concurrent calls for different records each get their own child. Calls for
 * the same record id share one child and one answer, and none of them resolves
 * before the backend has answered through the tunnel.
 */
function openTunnel(record: BackendRecord, backendPort: number): Promise<TunnelResult> {
    if (closing) return Promise.resolve(stoppedResult());
    const existing = tunnels.get(record.id);
    if (existing?.established) return Promise.resolve({ ok: true, localPort: existing.localPort });
    const inFlight = pendingOpens.get(record.id);
    if (inFlight) return inFlight.promise;

    // Nothing is in flight, so anything still registered is not ours to keep.
    closeTunnel(record.id);
    const ctx: OpenContext = { id: record.id, cancelled: false };
    const pending: PendingOpen = {
        ctx,
        promise: runOpen(record, backendPort, ctx).finally(() => {
            // By context, not by the id the open started under: `rekeyTunnel`
            // may have moved it, and a settled promise left filed under the new
            // id would be adopted by the next `openTunnel` and report a port for
            // a tunnel that may since have died.
            if (pendingOpens.get(ctx.id) === pending) pendingOpens.delete(ctx.id);
        }),
    };
    pendingOpens.set(record.id, pending);
    return pending.promise;
}

/**
 * Refile a live child from one record id to another. Not a close and reopen:
 * the connection through it is already established and proved healthy, and
 * tearing it down to rebuild it is exactly the bug this avoids. Called when a
 * provisional record adopts its uid.
 *
 * Whatever was already filed under `toId` is closed first: once replaced it
 * could never be found again, and a child nothing can find is never killed.
 */
function rekeyTunnel(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const tunnel = tunnels.get(fromId);
    const pending = pendingOpens.get(fromId);
    if (!tunnel && !pending) return;
    closeTunnel(toId);
    if (tunnel) {
        tunnels.delete(fromId);
        tunnels.set(toId, tunnel);
    }
    if (pending) {
        pendingOpens.delete(fromId);
        pending.ctx.id = toId;
        pendingOpens.set(toId, pending);
    }
}

/** Kills whatever child is registered for `id`, established or still probing,
 *  and stops an open in flight for it from spawning another. */
function closeTunnel(id: string): void {
    const pending = pendingOpens.get(id);
    if (pending) {
        pending.ctx.cancelled = true;
        pendingOpens.delete(id);
    }
    const tunnel = tunnels.get(id);
    if (!tunnel) return;
    tunnels.delete(id);
    // Drops the single lifetime listener, so a deliberate close is not reported
    // to the renderer as a dropped tunnel. On a child that is still probing it
    // also strands that attempt's `exited` promise, which is intended: the
    // readiness loop sees the cancelled context and returns on its own.
    tunnel.child.removeAllListeners("close");
    tunnel.child.kill();
}

function closeAllTunnels(): void {
    // Before the sweep, not after: the point is to stop the children that are
    // not in the map yet, and they are racing this call.
    closing = true;
    for (const id of [...pendingOpens.keys()]) closeTunnel(id);
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
 * channel, so the renderer never handles key bytes.
 *
 * The endpoint is stored beside the material, not just the id. An id is not a
 * stable address: for a discovered record `host` follows the beacon, so DHCP
 * moving the machine between the fingerprint and the approval would have
 * `trustHostKey` write the key it scanned from the old address under the new
 * address's alias. `forgetScannedHostKey` covers the edit and remove paths but
 * discovery does not go through them.
 */
interface ScannedHostKey {
    material: string;
    host: string;
    sshPort: number;
}

const scannedHostKeys = new Map<string, ScannedHostKey>();

/** Called by the registry when a record is edited or removed. */
function forgetScannedHostKey(id: string): void {
    scannedHostKeys.delete(id);
}

async function fetchHostKeyFingerprint(record: BackendRecord): Promise<string> {
    // A new scan invalidates the old one whatever happens next. Without this, a
    // second scan that fails would leave the *first* scan's material stashed,
    // and `trustHostKey` would happily pin it against a fingerprint the dialog
    // never managed to show.
    forgetScannedHostKey(record.id);
    const keyMaterial = await scanHostKey(record);
    if (keyMaterial.trim().length === 0) {
        throw new Error(`No host key returned by ${record.host}`);
    }
    const fingerprint = await new Promise<string>((resolve, reject) => {
        const child = execFile("ssh-keygen", ["-lf", "-"], (error, stdout) => {
            // `ssh-keygen` failing — missing binary, a key type it will not
            // parse — must not resolve with `""`: the trust dialog would show an
            // empty box, ask the user to approve it, and `trustHostKey` would
            // then pin bytes nobody ever looked at. Trust-on-first-use is only
            // worth anything if the thing the user approved is the thing that
            // gets written.
            if (error || stdout.trim().length === 0) {
                return reject(new Error(`Could not read the host key from ${record.host}.`));
            }
            resolve(stdout);
        });
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
 * `ssh-keyscan` files each key under the host it scanned (`[host]:port` off
 * port 22), but every connection looks the key up under `HostKeyAlias`, so the
 * first field of each key line is replaced by the alias. Comment lines are
 * dropped.
 */
function aliasKeyLines(material: string, alias: string): string[] {
    return material
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => [alias, ...line.split(/\s+/).slice(1)].join(" "));
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
 *
 * Writes the app's own `KNOWN_HOSTS_FILE`, never `~/.ssh/known_hosts`: every
 * ssh call passes `UserKnownHostsFile` and `HostKeyAlias` (`hostKeyOptions`),
 * so that file under that alias is the only place ssh will look.
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
        throw new Error(
            "That backend's address changed. Re-check its fingerprint before trusting it.",
        );
    }
    scannedHostKeys.delete(record.id);
    const lines = aliasKeyLines(scanned.material, knownHostsKey(record));
    if (lines.length === 0) {
        throw new Error(`No host key returned by ${record.host}`);
    }

    await mkdir(dirname(KNOWN_HOSTS_FILE), { recursive: true, mode: 0o700 });
    let existing = "";
    try {
        existing = await readFile(KNOWN_HOSTS_FILE, "utf-8");
    } catch {
        // File does not exist yet.
    }
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await appendFile(KNOWN_HOSTS_FILE, `${prefix}${lines.join("\n")}\n`, { mode: 0o600 });
    await chmod(KNOWN_HOSTS_FILE, 0o600);
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
    rekeyTunnel,
    trustHostKey,
};
export type { TunnelResult };
