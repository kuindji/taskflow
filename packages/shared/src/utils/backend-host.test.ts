import { describe, test, expect, afterEach } from "bun:test";
import { resolveBackendHost, hostForUrl, backendHttpOrigin } from "./backend-host";

const original = process.env.TASKFLOW_HOST;

afterEach(() => {
    if (original === undefined) delete process.env.TASKFLOW_HOST;
    else process.env.TASKFLOW_HOST = original;
});

describe("resolveBackendHost", () => {
    test("defaults to IPv4 loopback when the variable is unset or empty", () => {
        delete process.env.TASKFLOW_HOST;
        expect(resolveBackendHost()).toBe("127.0.0.1");
        process.env.TASKFLOW_HOST = "";
        expect(resolveBackendHost()).toBe("127.0.0.1");
    });

    test.each(["127.0.0.1", "::1", "0:0:0:0:0:0:0:1", "localhost"])(
        "accepts the loopback address %p",
        (host) => {
            process.env.TASKFLOW_HOST = host;
            expect(resolveBackendHost()).toBe(host);
        },
    );

    // Only the spellings `localhost` itself resolves to are accepted. The rest of
    // 127/8 is loopback but unreachable from every client that dials by name —
    // `packages/ui/src/hooks/useWebSocket.ts` and the CLI both use `localhost`.
    test.each(["127.0.0.2", "127.255.255.254", "0.0.0.0", "::", "192.168.1.5", "10.0.0.1", "127.0.0.999", "example.com"])(
        "refuses to bind the unauthenticated backend to %p",
        (host) => {
            process.env.TASKFLOW_HOST = host;
            expect(() => resolveBackendHost()).toThrow(/loopback/);
        },
    );
});

describe("hostForUrl", () => {
    // Both accepted IPv6 spellings, not just `::1`: an implementation that special-cased
    // the short form would leave `TASKFLOW_HOST=0:0:0:0:0:0:0:1` building
    // `http://0:0:0:0:0:0:0:1:7100`, which `new URL` rejects outright.
    test.each(["::1", "0:0:0:0:0:0:0:1"])(
        "brackets the IPv6 literal %p so the URL stays parseable",
        (host) => {
            expect(hostForUrl(host)).toBe(`[${host}]`);
            expect(new URL(`http://${hostForUrl(host)}:7100`).port).toBe("7100");
        },
    );

    test("leaves an IPv4 address and a name alone", () => {
        expect(hostForUrl("127.0.0.1")).toBe("127.0.0.1");
        expect(hostForUrl("localhost")).toBe("localhost");
    });
});

describe("backendHttpOrigin", () => {
    test("follows the host the backend bound", () => {
        delete process.env.TASKFLOW_HOST;
        expect(backendHttpOrigin(7100)).toBe("http://127.0.0.1:7100");
        process.env.TASKFLOW_HOST = "::1";
        expect(backendHttpOrigin(7100)).toBe("http://[::1]:7100");
    });

    test("is a parseable URL for every accepted host", () => {
        for (const host of ["127.0.0.1", "::1", "0:0:0:0:0:0:0:1", "localhost"]) {
            process.env.TASKFLOW_HOST = host;
            expect(new URL(backendHttpOrigin(7100)).port).toBe("7100");
        }
    });
});
