import { describe, test, expect, afterEach } from "bun:test";
import { resolveBackendHost, hostForUrl } from "./backend-host";

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

    test.each(["::1", "0:0:0:0:0:0:0:1", "localhost", "127.0.0.2", "127.255.255.254"])(
        "accepts the loopback address %p",
        (host) => {
            process.env.TASKFLOW_HOST = host;
            expect(resolveBackendHost()).toBe(host);
        },
    );

    test.each(["0.0.0.0", "::", "192.168.1.5", "10.0.0.1", "127.0.0.999", "example.com"])(
        "refuses to bind the unauthenticated backend to %p",
        (host) => {
            process.env.TASKFLOW_HOST = host;
            expect(() => resolveBackendHost()).toThrow(/loopback/);
        },
    );
});

describe("hostForUrl", () => {
    test("brackets an IPv6 literal so the URL stays parseable", () => {
        expect(hostForUrl("::1")).toBe("[::1]");
        expect(new URL(`http://${hostForUrl("::1")}:7100`).port).toBe("7100");
    });

    test("leaves an IPv4 address and a name alone", () => {
        expect(hostForUrl("127.0.0.1")).toBe("127.0.0.1");
        expect(hostForUrl("localhost")).toBe("localhost");
    });
});
