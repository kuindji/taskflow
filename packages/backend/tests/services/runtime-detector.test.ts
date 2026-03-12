import { describe, it, expect } from "bun:test";
import { detectRuntimes } from "../../src/services/runtime-detector";

describe("detectRuntimes", () => {
    it("returns at least one runtime on a dev machine", async () => {
        const runtimes = await detectRuntimes();
        expect(runtimes.length).toBeGreaterThan(0);
    });

    it("detects bun when running under bun", async () => {
        const runtimes = await detectRuntimes();
        const bun = runtimes.find((r) => r.name === "bun");
        expect(bun).toBeDefined();
        expect(bun?.path).toBeTruthy();
        expect(bun?.version).not.toBe("unknown");
    });

    it("returns name, path, and version for each runtime", async () => {
        const runtimes = await detectRuntimes();
        for (const rt of runtimes) {
            expect(rt.name).toBeTruthy();
            expect(rt.path).toBeTruthy();
            expect(typeof rt.version).toBe("string");
        }
    });
});
