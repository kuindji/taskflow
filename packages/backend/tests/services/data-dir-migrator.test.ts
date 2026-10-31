import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { migrateDataDir } from "../../src/services/data-dir-migrator";
import { expectRejects } from "../expect-rejects";

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

    it("refuses to move into the parent folder of a data folder named like a data item", async () => {
        const current = join(root, "tasks");
        await mkdir(join(current, "tasks"), { recursive: true });
        await writeFile(join(current, "projects.json"), "[]");
        await writeFile(join(current, "tasks", "t1.json"), "{}");

        await expectRejects(migrateDataDir(current, root), "overlaps");

        expect(await readFile(join(current, "projects.json"), "utf-8")).toBe("[]");
        expect(await readFile(join(current, "tasks", "t1.json"), "utf-8")).toBe("{}");
    });

    it("refuses to move a folder onto itself under another spelling", async () => {
        const current = join(root, "data");
        await mkdir(current, { recursive: true });
        await writeFile(join(current, "projects.json"), "[]");

        await expectRejects(migrateDataDir(current, `${current}/`), "overlaps");

        expect(await readFile(join(current, "projects.json"), "utf-8")).toBe("[]");
    });
});
