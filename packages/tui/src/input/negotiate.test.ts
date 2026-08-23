import { describe, test, expect } from "bun:test";
import { negotiateKitty } from "./negotiate";

/** A reader that hands back `chunks` in order and then reports its timeout. */
function reader(chunks: string[]): (ms: number) => Promise<string> {
    let i = 0;
    return () => Promise.resolve(chunks[i++] ?? "");
}

describe("negotiateKitty", () => {
    test("reports support when the terminal replies with flags", async () => {
        const written: string[] = [];
        const result = await negotiateKitty({
            write: (data) => written.push(data),
            waitForData: reader(["\x1b[?1u"]),
        });
        expect(result.kitty).toBe(true);
        expect(written).toContain("\x1b[?u");
    });

    test("reports no support when the reply times out", async () => {
        const result = await negotiateKitty({
            write: () => undefined,
            waitForData: reader([]),
        });
        expect(result).toEqual({ kitty: false, rest: "" });
    });

    test("reports no support for an unrelated reply", async () => {
        const result = await negotiateKitty({
            write: () => undefined,
            waitForData: reader(["\x1b[?62;c"]),
        });
        expect(result.kitty).toBe(false);
    });

    test("finds the reply among other pending input", async () => {
        // The reply can arrive interleaved with real keystrokes.
        const result = await negotiateKitty({
            write: () => undefined,
            waitForData: reader(["a\x1b[?0u"]),
        });
        expect(result.kitty).toBe(true);
    });

    test("hands back the keystrokes that surrounded the reply", async () => {
        // Only the reply is the terminal's; everything else the user typed and
        // is owed to the decoder, in the order it was typed.
        const result = await negotiateKitty({
            write: () => undefined,
            waitForData: reader(["a\x1b[?0ub"]),
        });
        expect(result).toEqual({ kitty: true, rest: "ab" });
    });

    test("hands back everything read when no reply came", async () => {
        const result = await negotiateKitty({
            write: () => undefined,
            waitForData: reader(["Q"]),
        });
        expect(result).toEqual({ kitty: false, rest: "Q" });
    });

    test("keeps reading when a keystroke arrives ahead of the reply", async () => {
        // A terminal that is answering can still have a keypress land first.
        // Stopping at that chunk would read silence and downgrade the terminal.
        const result = await negotiateKitty({
            write: () => undefined,
            waitForData: reader(["Q", "\x1b[?5u"]),
        });
        expect(result).toEqual({ kitty: true, rest: "Q" });
    });

    test("joins a reply split across two reads", async () => {
        const result = await negotiateKitty({
            write: () => undefined,
            waitForData: reader(["\x1b[?", "5u"]),
        });
        expect(result).toEqual({ kitty: true, rest: "" });
    });

    test("spends no more than the timeout across all its reads", async () => {
        const seen: number[] = [];
        const result = await negotiateKitty(
            {
                write: () => undefined,
                waitForData: (ms) => {
                    seen.push(ms);
                    return Promise.resolve(seen.length < 3 ? "x" : "");
                },
            },
            42,
        );
        expect(result.rest).toBe("xx");
        expect(seen).toHaveLength(3);
        // Each read gets what is left of the one budget, never a fresh one.
        for (const ms of seen) expect(ms).toBeLessThanOrEqual(42);
        expect(seen[0]).toBeGreaterThan(0);
    });
});
