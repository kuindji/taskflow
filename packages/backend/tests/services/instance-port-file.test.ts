import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
    releaseInstancePort,
    removeInstancePortFile,
    writeInstancePortFile,
    writePortHandshake,
} from "../../src/services/instance-port-file";

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

    test("never deletes a port file written while the removal is under way", async () => {
        // A backend shutting down reads its own port, then another backend of the
        // same instance writes its port, then the first one deletes the file. The
        // backend still running would be left with no port file.
        await withDir(async (dir) => {
            const file = join(dir, "main.port");
            let lost = 0;
            for (let i = 0; i < 300; i++) {
                await writeFile(file, "4321");
                await Promise.all([
                    removeInstancePortFile(file, 4321),
                    (async () => {
                        for (let k = 0; k < i % 4; k++) await Promise.resolve();
                        await writeInstancePortFile(file, 5555);
                    })(),
                ]);
                if (!existsSync(file)) lost++;
            }
            expect(lost).toBe(0);
        });
    });

    test("does nothing when the file is already gone", async () => {
        await withDir(async (dir) => {
            await removeInstancePortFile(join(dir, "main.port"), 4321);
        });
    });
});

describe("releaseInstancePort", () => {
    test("a backend that takes over a fixed port keeps its port file", async () => {
        // With TASKFLOW_DEV_PORT the next backend of the instance binds the same
        // port the moment it is freed and writes the same contents. A removal that
        // runs after that point cannot tell the file apart from ours.
        await withDir(async (dir) => {
            const file = join(dir, "main.port");
            await writeInstancePortFile(file, 4321);
            await releaseInstancePort(file, 4321, () => {
                writeFileSync(file, "4321");
            });
            expect(existsSync(file)).toBe(true);
        });
    });
});

test.skipIf(process.platform === "win32")(
    "the handshake replaces a pre-existing 0644 file with a 0600 one",
    async () => {
        await withDir(async (dir) => {
            const file = join(dir, "hs");
            await writeFile(file, "4321", { mode: 0o644 });
            expect((await stat(file)).mode & 0o777).toBe(0o644);
            const token = "a".repeat(43);
            await writePortHandshake(file, 4321, token);
            expect(await readFile(file, "utf-8")).toBe(`4321\n${token}\n`);
            expect((await stat(file)).mode & 0o777).toBe(0o600);
        });
    },
);
