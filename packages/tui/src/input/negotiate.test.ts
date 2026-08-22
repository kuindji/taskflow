import { describe, test, expect } from "bun:test";
import { negotiateKitty } from "./negotiate";

describe("negotiateKitty", () => {
    test("reports support when the terminal replies with flags", async () => {
        const written: string[] = [];
        const supported = await negotiateKitty({
            write: (data) => written.push(data),
            waitForData: () => Promise.resolve("\x1b[?1u"),
        });
        expect(supported).toBe(true);
        expect(written).toContain("\x1b[?u");
    });

    test("reports no support when the reply times out", async () => {
        const supported = await negotiateKitty({
            write: () => undefined,
            waitForData: () => Promise.resolve(""),
        });
        expect(supported).toBe(false);
    });

    test("reports no support for an unrelated reply", async () => {
        const supported = await negotiateKitty({
            write: () => undefined,
            waitForData: () => Promise.resolve("\x1b[?62;c"),
        });
        expect(supported).toBe(false);
    });

    test("finds the reply among other pending input", async () => {
        // The reply can arrive interleaved with real keystrokes.
        const supported = await negotiateKitty({
            write: () => undefined,
            waitForData: () => Promise.resolve("a\x1b[?0u"),
        });
        expect(supported).toBe(true);
    });

    test("passes the timeout through to the reader", async () => {
        const seen: number[] = [];
        await negotiateKitty(
            {
                write: () => undefined,
                waitForData: (ms) => {
                    seen.push(ms);
                    return Promise.resolve("");
                },
            },
            42,
        );
        expect(seen).toEqual([42]);
    });
});
