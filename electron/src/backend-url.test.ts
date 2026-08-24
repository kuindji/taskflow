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

    test("treats an empty TASKFLOW_HOST as unset, exactly as the backend does", () => {
        process.env.TASKFLOW_HOST = "";
        expect(backendOrigin(7100)).toBe("http://127.0.0.1:7100");
        expect(new URL(backendOrigin(7100)).port).toBe("7100");
    });

    // Both IPv6 spellings the backend accepts, not just `::1`. Special-casing the short
    // form here would build `http://0:0:0:0:0:0:0:1:7100`, which `new URL` rejects — the
    // same class of break the empty-string case above caused.
    test.each(["::1", "0:0:0:0:0:0:0:1"])(
        "brackets the IPv6 literal %p so the URL stays parseable",
        (host) => {
            process.env.TASKFLOW_HOST = host;
            expect(backendOrigin(7100)).toBe(`http://[${host}]:7100`);
            expect(new URL(backendOrigin(7100)).port).toBe("7100");
        },
    );
});
