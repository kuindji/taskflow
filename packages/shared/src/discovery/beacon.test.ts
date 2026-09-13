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
    backendUid: "3f2b9c1e8a4d4e6f9b0a1c2d3e4f5a6b",
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

    test("returns null for an announcement without a backendUid", () => {
        const { backendUid: _omitted, ...withoutUid } = announce;
        const bytes = new TextEncoder().encode(JSON.stringify(withoutUid));
        expect(parseDatagram(bytes)).toBeNull();
    });

    test("returns null for a backendUid that is not a plain identifier", () => {
        for (const backendUid of ["uid; rm -rf ~", "", "../x", 42]) {
            const bytes = new TextEncoder().encode(JSON.stringify({ ...announce, backendUid }));
            expect(parseDatagram(bytes)).toBeNull();
        }
    });

    test("returns null when a required field has the wrong type", () => {
        const bytes = new TextEncoder().encode(JSON.stringify({ ...announce, port: "54892" }));
        expect(parseDatagram(bytes)).toBeNull();
    });

    test("returns null for an instanceId that is not a plain identifier", () => {
        // `instanceId` reaches a remote shell in the port lookup and is part of
        // the persisted record id. Anyone on the LAN can send one, so the codec
        // is where the character set is decided.
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
