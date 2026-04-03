import { describe, it, expect } from "bun:test";
import {
    isWindows,
    getHomeDir,
    getConfigBaseDir,
    getPathDelimiter,
    getNullDevice,
    getDefaultShell,
    getDefaultShellEnvVar,
    getEnsurePaths,
} from "../../src/services/platform";

describe("platform utilities", () => {
    it("isWindows() returns a boolean", () => {
        expect(typeof isWindows()).toBe("boolean");
    });

    it("getHomeDir() returns a non-empty string", () => {
        const home = getHomeDir();
        expect(typeof home).toBe("string");
        expect(home.length).toBeGreaterThan(0);
    });

    it("getConfigBaseDir() contains 'taskflow'", () => {
        const dir = getConfigBaseDir();
        expect(dir).toContain("taskflow");
    });

    it("getPathDelimiter() returns ':' or ';'", () => {
        const delim = getPathDelimiter();
        expect([":", ";"]).toContain(delim);
    });

    it("getNullDevice() returns '/dev/null' or 'NUL'", () => {
        const dev = getNullDevice();
        expect(["/dev/null", "NUL"]).toContain(dev);
    });

    it("getDefaultShell() returns a non-empty string", () => {
        const shell = getDefaultShell();
        expect(typeof shell).toBe("string");
        expect(shell.length).toBeGreaterThan(0);
    });

    it("getDefaultShellEnvVar() returns a string or undefined", () => {
        const shellEnv = getDefaultShellEnvVar();
        expect(
            shellEnv === undefined || typeof shellEnv === "string",
        ).toBe(true);
    });

    it("getEnsurePaths() returns an array of strings", () => {
        const paths = getEnsurePaths();
        expect(Array.isArray(paths)).toBe(true);
        expect(paths.length).toBeGreaterThan(0);
        for (const p of paths) {
            expect(typeof p).toBe("string");
        }
    });
});
