import { describe, test, expect } from "bun:test";
import { hostForUrl } from "@taskflow/shared";

import { parseArgs } from "./cli";
import { backendUrl } from "./net/client";

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

    test("rejects an IPv6 zone id, which no URL parser will take", () => {
        // `new URL` rejects a zone id outright, in either spelling, so a target
        // carrying one can never be dialled. Accepting it here only moves the
        // failure to `new WebSocket`, where it surfaces as a bare
        // `TypeError: Invalid URL` instead of a usage error.
        expect(() => parseArgs(["--connect", "[fe80::1%en0]:7777"])).toThrow(/host:port/);
        expect(() => parseArgs(["--connect", "[fe80::1%25en0]:7777"])).toThrow(/host:port/);
    });

    test("rejects a bracketed literal that is not a valid IPv6 address", () => {
        // Shape-matched by the old regex — a colon and hex digits is all it
        // asked for — but rejected by every URL parser.
        expect(() => parseArgs(["--connect", "[:]:7777"])).toThrow(/host:port/);
        expect(() => parseArgs(["--connect", "[1:2:3:4:5:6:7:8:9]:7777"])).toThrow(/host:port/);
        expect(() => parseArgs(["--connect", "[::g]:7777"])).toThrow(/host:port/);
    });

    test("rejects a host whose percent sequence is not one a URL accepts", () => {
        expect(() => parseArgs(["--connect", "%:7777"])).toThrow(/host:port/);
        expect(() => parseArgs(["--connect", "%zz:7777"])).toThrow(/host:port/);
        expect(() => parseArgs(["--connect", "a%2Fb:7777"])).toThrow(/host:port/);
    });

    test("rejects a host a URL parser would read as something other than a host", () => {
        // Each of these parses, so `URL.canParse` alone waved them through —
        // and each parses to a *different* authority from the one typed. The
        // port is the visible casualty: `desktop/path:7777` becomes the host
        // `desktop` with the path `/path:7777`, i.e. port 80.
        expect(() => parseArgs(["--connect", "desktop/path:7777"])).toThrow(/host:port/);
        expect(() => parseArgs(["--connect", "127.0.0.1/x:7777"])).toThrow(/host:port/);
        expect(() => parseArgs(["--connect", "desktop\\path:7777"])).toThrow(/host:port/);
        expect(() => parseArgs(["--connect", "desktop?q:7777"])).toThrow(/host:port/);
        expect(() => parseArgs(["--connect", "desktop#frag:7777"])).toThrow(/host:port/);
        expect(() => parseArgs(["--connect", "evil@desktop:7777"])).toThrow(/host:port/);
        expect(() => parseArgs(["--connect", "user:pw@desktop:7777"])).toThrow(/host:port/);
    });

    test("every accepted target is dialled at the host and port that were typed", () => {
        // The guard below proves the URL opens; this one proves it opens the
        // right thing. `URL.canParse` answers the first question and not the
        // second, which is how the host-as-path forms above got in.
        const accepted: Array<[string, string, string]> = [
            ["127.0.0.1:7777", "127.0.0.1", "7777"],
            ["desktop.local:9000", "desktop.local", "9000"],
            ["DESKTOP:65535", "desktop", "65535"],
            ["[::1]:7777", "[::1]", "7777"],
            ["[2001:db8::1]:7777", "[2001:db8::1]", "7777"],
            // 80 is ws's default, so the URL drops it from `port` — the check
            // is that it is the *default* rather than a port that went missing.
            ["desktop:80", "desktop", ""],
        ];
        for (const [target, hostname, port] of accepted) {
            const parsed = parseArgs(["--connect", target]).connect;
            expect(parsed).not.toBeNull();
            const url = new URL(backendUrl(parsed?.host ?? "", parsed?.port ?? 0));
            expect(url.hostname).toBe(hostname);
            expect(url.port).toBe(port);
        }
    });

    test("every accepted target produces a URL a WebSocket can open", () => {
        // The check that matters: whatever survives parseArgs must survive the
        // one thing done with it. Anything added to this list is validated
        // against the real constructor rather than against a second regex.
        const accepted = [
            "127.0.0.1:7777",
            "0.0.0.0:7777",
            "localhost:1",
            "DESKTOP:65535",
            "desktop.local:9000",
            "my_host:7777",
            "[::1]:7777",
            "[2001:db8::1]:7777",
            "[::ffff:1.2.3.4]:7777",
        ];
        for (const target of accepted) {
            const parsed = parseArgs(["--connect", target]).connect;
            expect(parsed).not.toBeNull();
            const host = parsed?.host ?? "";
            const port = parsed?.port ?? 0;
            expect(() => new WebSocket(backendUrl(host, port))).not.toThrow();
        }
    });

    test("accepts a hostname with an underscore in it", () => {
        // Illegal in DNS, ordinary as an SSH `Host` alias or a container name.
        // Pinned because validating against `new URL` rather than a character
        // class is what now decides it, and a URL takes it.
        expect(parseArgs(["--connect", "my_host:7777"])).toEqual({
            connect: { host: "my_host", port: 7777 },
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

    test("rejects a control character in the host rather than letting it be stripped", () => {
        // `new URL` deletes tab, CR and LF from an authority instead of
        // refusing it, so `desk<TAB>top` would quietly dial `desktop` — a
        // different machine from the one that was typed.
        expect(() => parseArgs(["--connect", "desk\ttop:7777"])).toThrow(/host:port/);
        expect(() => parseArgs(["--connect", "desk\ntop:7777"])).toThrow(/host:port/);
        expect(() => parseArgs(["--connect", "desktop\r:7777"])).toThrow(/host:port/);
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
