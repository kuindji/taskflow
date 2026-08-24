import { describe, test, expect, afterEach } from "bun:test";
import { backendOrigin } from "./backend-url";

const original = process.env.TASKFLOW_HOST;

afterEach(() => {
    if (original === undefined) delete process.env.TASKFLOW_HOST;
    else process.env.TASKFLOW_HOST = original;
});

describe("backendOrigin", () => {
    test("defaults to IPv4 loopback, matching the backend's default bind", () => {
        delete process.env.TASKFLOW_HOST;
        expect(backendOrigin(7100)).toBe("http://127.0.0.1:7100");
    });

    test("follows the TASKFLOW_HOST override the backend binds to", () => {
        process.env.TASKFLOW_HOST = "127.0.0.2";
        expect(backendOrigin(7100)).toBe("http://127.0.0.2:7100");
    });

    test("brackets an IPv6 literal so the URL stays parseable", () => {
        process.env.TASKFLOW_HOST = "::1";
        expect(backendOrigin(7100)).toBe("http://[::1]:7100");
        expect(new URL(backendOrigin(7100)).port).toBe("7100");
    });
});
