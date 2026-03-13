import { describe, expect, it } from "bun:test";
import { parseTerminalApp } from "../../../src/services/theme-parsers/terminal-app";

describe("parseTerminalApp", () => {
    it("should return an empty array (best-effort parser)", async () => {
        const result = await parseTerminalApp();
        expect(result).toEqual([]);
    });
});
