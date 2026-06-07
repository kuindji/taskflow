import { describe, expect, test } from "bun:test";
import { consumeFlags } from "../../src/services/cli-flags";

describe("consumeFlags", () => {
    test("parses known string and boolean flags", () => {
        const result = consumeFlags(["create", "--name", "foo", "--force"], {
            name: "string",
            force: "boolean",
        });
        expect(result.flags).toEqual({ name: "foo", force: true });
        expect(result.positional).toEqual(["create"]);
        expect(result.unknown).toEqual([]);
    });

    test("collects unknown flags instead of silently skipping", () => {
        const result = consumeFlags(["--typo"], { name: "string" });
        expect(result.unknown).toEqual(["--typo"]);
    });

    test("unknown flag does not consume the following value as its own", () => {
        const result = consumeFlags(["--typo", "value", "pos"], {});
        expect(result.unknown).toEqual(["--typo"]);
        expect(result.positional).toEqual(["value", "pos"]);
    });

    test("string flag at end of args gets empty value", () => {
        const result = consumeFlags(["--name"], { name: "string" });
        expect(result.flags.name).toBe("");
    });

    test("bare -- ends flag parsing; remaining args are positional", () => {
        const result = consumeFlags(["--force", "--", "--name", "pos"], {
            name: "string",
            force: "boolean",
        });
        expect(result.flags).toEqual({ force: true });
        expect(result.positional).toEqual(["--name", "pos"]);
        expect(result.unknown).toEqual([]);
    });

    test("string flag followed by another flag consumes the flag as its value", () => {
        const result = consumeFlags(["--name", "--force"], { name: "string", force: "boolean" });
        expect(result.flags.name).toBe("--force");
        expect(result.flags.force).toBeUndefined();
    });
});
