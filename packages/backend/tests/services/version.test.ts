import { describe, expect, it } from "bun:test";
import { isVersionAtLeast, parseVersion } from "@taskflow/shared";

describe("agent version helpers", () => {
    it("parses plain and decorated CLI versions", () => {
        expect(parseVersion("2.1.206 (Claude Code)")).toEqual([2, 1, 206]);
        expect(parseVersion("v0.144.1")).toEqual([0, 144, 1]);
    });

    it("compares semantic version components numerically", () => {
        expect(isVersionAtLeast("2.1.203 (Claude Code)", [2, 1, 203])).toBe(true);
        expect(isVersionAtLeast("2.1.202", [2, 1, 203])).toBe(false);
        expect(isVersionAtLeast("unknown", [2, 1, 203])).toBe(false);
    });
});
