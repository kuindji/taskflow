import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { migrateDataDir } from "../../src/services/data-dir-migrator";

describe("migrateDataDir", () => {
    let root: string;
    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "taskflow-data-dir-"));
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("moves the session logs and Master list the task store reads from the new folder", async () => {
        const from = join(root, "old");
        const to = join(root, "new");
        await mkdir(join(from, "session-logs", "main"), { recursive: true });
        await mkdir(join(from, "sessions", "main"), { recursive: true });
        await writeFile(join(from, "session-logs", "main", "task--s1.jsonl"), "log\n");
        await writeFile(join(from, "sessions", "main", "master.json"), "[]");

        await migrateDataDir(from, to);

        expect(await readFile(join(to, "session-logs", "main", "task--s1.jsonl"), "utf-8")).toBe(
            "log\n",
        );
        expect(await readFile(join(to, "sessions", "main", "master.json"), "utf-8")).toBe("[]");
    });
});
