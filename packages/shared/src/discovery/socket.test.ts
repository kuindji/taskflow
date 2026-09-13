import { afterEach, describe, expect, test } from "bun:test";
import { networkInterfaces } from "node:os";
import { PROTOCOL_VERSION } from "../constants";
import type { BeaconAnnounce } from "../types/backend";
import { createAdvertiser, createListener, membershipDelta } from "./socket";

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
        backendUid: "0123456789abcdef0123456789abcdef",
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

// No socket and no LAN, so this one runs everywhere — which is the point. The
// membership bookkeeping is what has been wrong twice: once as a one-shot join
// at bind time, and once as an early return for the no-interface case that
// skipped the drop pass and left `joined` claiming an address the machine no
// longer had. Neither was reachable from the integration tests below, which
// need a real interface that never goes away mid-test.
describe("membershipDelta", () => {
    test("an interface that disappears is dropped, so it is rejoined when it returns", () => {
        const joined = new Set<string>();

        // On Wi-Fi.
        const first = membershipDelta(joined, ["192.168.1.20"]);
        expect(first).toEqual({ add: ["192.168.1.20"], drop: [] });
        first.add.forEach((address) => joined.add(address));

        // Wi-Fi off, VPN torn down, cable out: nothing left to be joined to.
        const second = membershipDelta(joined, []);
        expect(second).toEqual({ add: [], drop: ["192.168.1.20"] });
        second.drop.forEach((address) => joined.delete(address));

        // Back, on the same DHCP lease. The membership went away with the
        // interface, so this must ask for it again rather than trusting a set
        // that was never emptied.
        const third = membershipDelta(joined, ["192.168.1.20"]);
        expect(third).toEqual({ add: ["192.168.1.20"], drop: [] });
    });

    test("an address that is already joined is not joined twice", () => {
        expect(membershipDelta(new Set(["10.0.0.4"]), ["10.0.0.4", "10.0.0.9"])).toEqual({
            add: ["10.0.0.9"],
            drop: [],
        });
    });
});

describe("discovery over the loopback multicast group", () => {
    test.skipIf(!hasLan)(
        "a listener sees an advertiser and can force an announcement with a probe",
        async () => {
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
            expect(entry?.backendUid).toBe("0123456789abcdef0123456789abcdef");
            expect(entry?.address.length).toBeGreaterThan(0);
        },
    );

    test.skipIf(!hasLan)("stopping the advertiser stops new announcements", async () => {
        const listener = createListener({ onChange: () => {} });
        stops.push(() => listener.stop());
        await listener.start();

        const advertiser = createAdvertiser({ payload: () => announce(54893) });
        await advertiser.start();
        listener.probe();
        await waitFor(() => listener.entries().some((e) => e.port === 54893));

        advertiser.stop();
        // Delivery is at-least-once: a copy of an announcement sent before the
        // stop can still arrive over the second path. Let it land first, or it
        // reads as an announcement from a stopped advertiser (seen 75 ms late).
        await new Promise((resolve) => setTimeout(resolve, 300));
        const seenAt = listener.entries().find((e) => e.port === 54893)?.lastSeenAt ?? 0;
        listener.probe();
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(listener.entries().find((e) => e.port === 54893)?.lastSeenAt).toBe(seenAt);
    });
});
