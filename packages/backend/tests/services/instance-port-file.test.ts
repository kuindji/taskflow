import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { removeInstancePortFile } from "../../src/services/instance-port-file";

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "instance-port-"));
    try {
        await run(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

describe("removeInstancePortFile", () => {
    test("removes the file while it still names this backend's port", async () => {
        await withDir(async (dir) => {
            const file = join(dir, "main.port");
            await writeFile(file, "4321");
            await removeInstancePortFile(file, 4321);
            expect(existsSync(file)).toBe(false);
        });
    });

    test("leaves a file another backend of the same instance has since written", async () => {
        await withDir(async (dir) => {
            const file = join(dir, "main.port");
            await writeFile(file, "5555");
            await removeInstancePortFile(file, 4321);
            expect(await readFile(file, "utf-8")).toBe("5555");
        });
    });

    test("does nothing when the file is already gone", async () => {
        await withDir(async (dir) => {
            await removeInstancePortFile(join(dir, "main.port"), 4321);
        });
    });
});
