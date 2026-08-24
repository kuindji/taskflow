import { describe, test, expect } from "bun:test";
import { hostForUrl } from "@taskflow/shared";

import { parseArgs } from "./cli";

describe("parseArgs", () => {
    test("defaults to local mode", () => {
        expect(parseArgs([])).toEqual({ connect: null });
    });

    test("parses host and port from --connect", () => {
        expect(parseArgs(["--connect", "127.0.0.1:7777"])).toEqual({
            connect: { host: "127.0.0.1", port: 7777 },
        });
    });

    test("accepts --connect=host:port", () => {
        expect(parseArgs(["--connect=desktop.local:9000"])).toEqual({
            connect: { host: "desktop.local", port: 9000 },
        });
    });

    test("rejects a target with no port", () => {
        expect(() => parseArgs(["--connect", "desktop"])).toThrow(/host:port/);
    });

    test("rejects a non-numeric port", () => {
        expect(() => parseArgs(["--connect", "desktop:abc"])).toThrow(/host:port/);
    });

    test("rejects a port with trailing garbage", () => {
        // parseInt alone would accept this as 123.
        expect(() => parseArgs(["--connect", "desktop:123abc"])).toThrow(/host:port/);
    });

    test("rejects an out-of-range port", () => {
        expect(() => parseArgs(["--connect", "desktop:99999"])).toThrow(/host:port/);
    });

    test("strips the brackets from an IPv6 target", () => {
        expect(parseArgs(["--connect", "[::1]:7777"])).toEqual({
            connect: { host: "::1", port: 7777 },
        });
    });

    test("a bracketed IPv6 target produces a URL a WebSocket can open", () => {
        // hostForUrl re-brackets any host with a colon in it, so a host that
        // arrived bracketed would come back as ws://[[::1]]:7777 — an invalid
        // URL that WebSocket rejects at startup.
        const target = parseArgs(["--connect", "[2001:db8::1]:7777"]).connect;
        expect(target).not.toBeNull();
        const url = `ws://${hostForUrl(target?.host ?? "")}:${String(target?.port ?? 0)}`;
        expect(url).toBe("ws://[2001:db8::1]:7777");
        expect(() => new URL(url)).not.toThrow();
    });

    test("keeps an IPv6 zone id", () => {
        expect(parseArgs(["--connect", "[fe80::1%en0]:7777"])).toEqual({
            connect: { host: "fe80::1%en0", port: 7777 },
        });
    });

    test("rejects a bare IPv6 address, whose own colons hide the port", () => {
        // lastIndexOf(":") alone would read this as the host ":" on port 1.
        expect(() => parseArgs(["--connect", "::1"])).toThrow(/host:port/);
        expect(() => parseArgs(["--connect", "2001:db8::1"])).toThrow(/host:port/);
    });

    test("rejects a bracketed host with no port", () => {
        expect(() => parseArgs(["--connect", "[::1]"])).toThrow(/host:port/);
    });

    test("rejects an unclosed bracket", () => {
        expect(() => parseArgs(["--connect", "[::1:7777"])).toThrow(/host:port/);
    });

    test("rejects empty brackets", () => {
        expect(() => parseArgs(["--connect", "[]:7777"])).toThrow(/host:port/);
    });

    test("rejects whitespace in the host", () => {
        expect(() => parseArgs(["--connect", " desktop:7777"])).toThrow(/host:port/);
        expect(() => parseArgs(["--connect", "desk top:7777"])).toThrow(/host:port/);
    });

    test("rejects --connect as the last argument", () => {
        expect(() => parseArgs(["--connect"])).toThrow(/host:port/);
    });

    test("rejects a target that is only a port", () => {
        expect(() => parseArgs(["--connect", ":7777"])).toThrow(/host:port/);
    });

    test("rejects an empty port", () => {
        expect(() => parseArgs(["--connect", "desktop:"])).toThrow(/host:port/);
    });

    test("rejects port zero", () => {
        expect(() => parseArgs(["--connect", "desktop:0"])).toThrow(/host:port/);
    });

    test("rejects an unknown flag", () => {
        expect(() => parseArgs(["--nope"])).toThrow(/Unknown/);
    });
});
