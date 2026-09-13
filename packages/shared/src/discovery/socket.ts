import dgram from "node:dgram";
import { networkInterfaces } from "node:os";
import {
    ANNOUNCE_INTERVAL_MS,
    DISCOVERY_GROUP,
    DISCOVERY_MAX_BACKENDS,
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
 * What has to change to bring a set of joined addresses in line with the
 * addresses the machine currently has. Pure, and exported for the test — the
 * bookkeeping is the part of this that has been wrong twice, and it is the part
 * a real socket makes untestable.
 */
function membershipDelta(
    joined: ReadonlySet<string>,
    addresses: readonly string[],
): { add: string[]; drop: string[] } {
    return {
        add: addresses.filter((address) => !joined.has(address)),
        drop: [...joined].filter((address) => !addresses.includes(address)),
    };
}

/**
 * Keeps `socket`'s multicast memberships in step with the machine's interfaces,
 * and returns the timer that goes on doing so.
 *
 * A one-shot join at bind time is not enough, and the failure is invisible from
 * the inside. `addMembership` is per interface, and an interface that did not
 * exist when we bound is one we never joined: start Taskflow before the laptop
 * is on Wi-Fi — closing the lid, a VPN coming up, docking — and the listener
 * stays joined to nothing.
 *
 * It is also one-directional. `sendToGroup` re-enumerates `localIPv4Addresses()`
 * on every call, so *announcing* starts using a new interface immediately: this
 * machine appears in everyone else's backend menu while their machines never
 * appear in its own, and probes sent to wake them up are answered into a socket
 * that is not listening on that interface. Restarting the app fixes it, which
 * makes the bug look intermittent.
 *
 * Recomputed when `os.networkInterfaces()` changes, polled every
 * `MEMBERSHIP_REFRESH_MS` rather than watching link state per platform.
 */
function keepMembershipsCurrent(socket: dgram.Socket): ReturnType<typeof setInterval> {
    // The addresses we have successfully joined. Not "the addresses that
    // existed last time we looked" — a join that throws must be retried on the
    // next tick, because the common reason is an interface that is up but not
    // yet configured, which resolves itself a second later.
    const joined = new Set<string>();

    function refresh(): void {
        const addresses = localIPv4Addresses();
        const { add, drop } = membershipDelta(joined, addresses);
        // Drop first, and from a delta rather than from a branch on
        // `addresses.length`: an early return for the no-interface case skips
        // the drop pass, and a `joined` entry for an address the machine no
        // longer has is a rejoin that `add` will not contain when that address
        // comes back on the same DHCP lease.
        for (const address of drop) {
            joined.delete(address);
            try {
                socket.dropMembership(DISCOVERY_GROUP, address);
            } catch {
                // The interface is already gone; the kernel dropped the
                // membership with it. Nothing to do, and nothing to report.
            }
        }
        if (addresses.length === 0) {
            // No usable interface. Join the OS-chosen one so a loopback-only
            // machine still hears something. `joined` is empty by now — the
            // drop pass above saw to that — so the real interfaces are picked
            // up the moment they appear.
            try {
                socket.addMembership(DISCOVERY_GROUP);
            } catch {
                // Discovery is unavailable; manual connect still works.
            }
            return;
        }
        for (const address of add) {
            try {
                socket.addMembership(DISCOVERY_GROUP, address);
                joined.add(address);
            } catch {
                // One interface refusing the join must not take down the
                // others, and must not stop us retrying it next tick — which is
                // why `joined` is written only on success.
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
 * Two sockets on one machine can both bind DISCOVERY_PORT thanks to reuseAddr,
 * and both receive every datagram in the group — including their own. Verified
 * on macOS: one send produced two receipts per socket, because the packet
 * arrives over both the loopback and the interface path.
 *
 * So: delivery is at-least-once, never exactly-once. Everything downstream must
 * be idempotent. The listener keys entries by host and instance, so a duplicate
 * is a no-op; the advertiser answering a probe twice costs one extra datagram.
 * Do not write a test that asserts a datagram arrives exactly once.
 *
 * `onFailed` is not optional. `bind(port, callback)` only calls back on
 * success, so a bind that fails emits `error` and the surrounding promise would
 * never settle. The backend `await`s `advertiser.start()` during boot, so a
 * swallowed bind failure wedges startup after the HTTP server is already
 * listening — and discovery failure is meant to be non-fatal.
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
 * one discovery failure nobody can diagnose.
 *
 * Both call sites wrap this as `(error) => discoveryFailureHandler(bound, …)(error)`
 * rather than calling it directly in the argument list. That is deliberate:
 * `bound` is the `const` being initialised by the very `bindDiscoverySocket`
 * call this handler is an argument to, so reading it eagerly is a
 * temporal-dead-zone `ReferenceError`. The arrow defers the read until the
 * error actually fires, by which point `bound` is assigned.
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
            // `start()`'s promise unsettled forever: `bind(port, cb)` followed
            // immediately by `close()` emits `close` and neither the bind
            // callback nor an `error`, so nothing else settles it.
            pendingSettle?.();
            pendingSettle = null;
        },
    };
}

function createListener(opts: {
    onChange: (entries: DiscoveredBackend[]) => void;
}): DiscoveryListener {
    const seen = new Map<string, DiscoveredBackend>();
    /** Ids we have already complained about below. One line per collision, not
     *  one every five seconds. */
    const warnedDuplicates = new Set<string>();
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
                // The warning is about a collision between an incumbent and a
                // newcomer, so it has to die with the incumbent. Left behind,
                // it suppresses the *next* collision on the same id once the
                // incumbent leaves and comes back as the loser.
                warnedDuplicates.delete(id);
                removed = true;
            }
        }
        if (removed) opts.onChange(live());
    }

    return {
        start() {
            // Same guard as the advertiser: without it a second call would
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
                const bound: dgram.Socket = bindDiscoverySocket(
                    (bytes, address) => {
                        const message = parseDatagram(bytes);
                        if (!message || "probe" in message) return;
                        const id = backendIdFor(message.hostname, message.instanceId);
                        const existing = seen.get(id);
                        // A datagram for a known id from a *different* address is
                        // either one machine that changed address (the old one
                        // goes quiet, so follow the new one immediately) or two
                        // machines answering to the same hostname and instance
                        // (both keep announcing, so last-wins would flap the
                        // address every five seconds). Whether the incumbent is
                        // still announcing separates them; two missed
                        // announcements is the threshold, since one dropped
                        // datagram is normal on a multicast group.
                        if (
                            existing &&
                            existing.address !== address &&
                            Date.now() - existing.lastSeenAt < ANNOUNCE_INTERVAL_MS * 2
                        ) {
                            // The incumbent keeps the row. Two stock
                            // `MacBook-Pro`s are ordinary, and to the user on
                            // the losing side this looks exactly like a
                            // multicast fault, so it must not be silent.
                            if (!warnedDuplicates.has(id)) {
                                warnedDuplicates.add(id);
                                console.warn(
                                    `[discovery] Two machines are announcing as "${id}" ` +
                                        `(${existing.address} and ${address}). Only ` +
                                        `${existing.address} will appear in the backend menu. ` +
                                        `Rename one machine, or add the other by address with ` +
                                        `"Connect to a backend".`,
                                );
                            }
                            return;
                        }
                        // Bounded, because anyone on the LAN can announce.
                        if (!existing && seen.size >= DISCOVERY_MAX_BACKENDS) return;
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
                                warnedDuplicates.clear();
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
                // ERR_SOCKET_DGRAM_NOT_RUNNING, and a quit path is not worth
                // taking down for it.
            }
            socket = null;
            seen.clear();
            warnedDuplicates.clear();
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

export { createAdvertiser, createListener, membershipDelta };
export type { DiscoveryHandle, DiscoveryListener };
