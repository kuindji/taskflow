import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";

describe("TUI entry point", () => {
    it("reports CLI errors before touching the terminal", async () => {
        const proc = Bun.spawn([process.execPath, "run", "src/index.ts", "--bad"], {
            cwd: import.meta.dir.replace(/\/src$/, ""),
            stdout: "pipe",
            stderr: "pipe",
        });
        const [code, stdout, stderr] = await Promise.all([
            proc.exited,
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        expect(code).toBe(1);
        expect(stdout).not.toContain("\x1b[?1049h");
        expect(stderr).toContain("Unknown argument");
    });

    it("wires the production entry through SessionController", async () => {
        const source = await readFile(new URL("./opentui/entry.ts", import.meta.url), "utf-8");
        expect(source).toContain("new SessionController");
        expect(source).not.toContain("sessions: []");
    });
});
