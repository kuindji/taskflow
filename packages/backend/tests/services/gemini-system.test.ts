import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ensureGeminiSystemFile } from "../../src/services/gemini-system";

const tempDirs: string[] = [];

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

describe("gemini system prompt", () => {
    it("writes system prompt file with base and additional prompt", async () => {
        const tempDir = await mkdtemp(join(tmpdir(), "gemini-test-"));
        tempDirs.push(tempDir);
        const filePath = await ensureGeminiSystemFile(tempDir, false, "Extra instructions");
        const content = await readFile(filePath, "utf-8");
        expect(content).toContain("taskflow-cli");
        expect(content).toContain("Extra instructions");
    });

    it("writes system prompt file without additional prompt", async () => {
        const tempDir = await mkdtemp(join(tmpdir(), "gemini-test-"));
        tempDirs.push(tempDir);
        const filePath = await ensureGeminiSystemFile(tempDir, false);
        const content = await readFile(filePath, "utf-8");
        expect(content).toContain("taskflow-cli");
        expect(content).not.toContain("undefined");
    });

    it("falls back to tmpdir when baseDir is not writable", async () => {
        const filePath = await ensureGeminiSystemFile("/nonexistent/path", false);
        tempDirs.push(join(tmpdir(), "taskflow-agent-skills"));
        const content = await readFile(filePath, "utf-8");
        expect(content).toContain("taskflow-cli");
    });
});
