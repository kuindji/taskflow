import { describe, test, expect } from "bun:test";
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

    test("rejects an unknown flag", () => {
        expect(() => parseArgs(["--nope"])).toThrow(/Unknown/);
    });
});
