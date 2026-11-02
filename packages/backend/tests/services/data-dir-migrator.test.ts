import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
    clearDataLocation,
    migrateDataDir,
    writeDataLocation,
} from "../../src/services/data-dir-migrator";
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

        await migrateDataDir(from, to, async () => {});

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

        await expectRejects(
            migrateDataDir(current, root, async () => {}),
            "overlaps",
        );

        expect(await readFile(join(current, "projects.json"), "utf-8")).toBe("[]");
        expect(await readFile(join(current, "tasks", "t1.json"), "utf-8")).toBe("{}");
    });

    it("refuses to move a folder onto itself under another spelling", async () => {
        const current = join(root, "data");
        await mkdir(current, { recursive: true });
        await writeFile(join(current, "projects.json"), "[]");

        await expectRejects(
            migrateDataDir(current, `${current}/`, async () => {}),
            "overlaps",
        );

        expect(await readFile(join(current, "projects.json"), "utf-8")).toBe("[]");
    });

    /** One file per data item, so a test can check a folder is complete. */
    async function seed(dir: string): Promise<void> {
        await mkdir(join(dir, "tasks"), { recursive: true });
        await mkdir(join(dir, "themes"), { recursive: true });
        await mkdir(join(dir, "flows"), { recursive: true });
        await mkdir(join(dir, "flow-runs", "main"), { recursive: true });
        await writeFile(join(dir, "projects.json"), "[]");
        await writeFile(join(dir, "tasks", "t1.json"), "{}");
        await writeFile(join(dir, "themes", "dark.jsonc"), "{}");
        await writeFile(join(dir, "flows", "actions.json"), "[]");
        await writeFile(join(dir, "flow-runs", "main", "run.json"), "{}");
        await writeFile(join(dir, "schedules.json"), "[]");
        await writeFile(join(dir, "notifications.json"), "[]");
    }

    const SEEDED = [
        "projects.json",
        "tasks/t1.json",
        "themes/dark.jsonc",
        "flows/actions.json",
        "flow-runs/main/run.json",
        "schedules.json",
        "notifications.json",
    ];

    async function expectComplete(dir: string): Promise<void> {
        for (const file of SEEDED) {
            expect(await readFile(join(dir, file), "utf-8")).toBeDefined();
        }
    }

    it("moves flows, flow runs, schedules and notifications too, and commits once all are in place", async () => {
        const from = join(root, "old");
        const to = join(root, "new");
        await seed(from);
        let committedWhileComplete = false;

        await migrateDataDir(from, to, async () => {
            await expectComplete(to);
            await expectComplete(from);
            committedWhileComplete = true;
        });

        expect(committedWhileComplete).toBe(true);
        await expectComplete(to);
        expect(await readdir(from)).toEqual([]);
        expect((await readdir(to)).sort()).toEqual(
            [
                "flow-runs",
                "flows",
                "notifications.json",
                "projects.json",
                "schedules.json",
                "tasks",
                "themes",
            ].sort(),
        );
    });

    // Both rely on POSIX permissions to make one item fail.
    it.skipIf(process.platform === "win32")(
        "leaves the old folder complete and the destination as it was when a copy fails part way",
        async () => {
            const from = join(root, "old");
            const to = join(root, "new");
            await seed(from);
            await mkdir(to);
            await writeFile(join(to, "projects.json"), "theirs");
            // Copied after projects.json and tasks, so the failure comes part way.
            await chmod(join(from, "themes"), 0o000);
            let committed = false;
            try {
                await expectRejects(
                    migrateDataDir(from, to, async () => {
                        committed = true;
                    }),
                );
            } finally {
                await chmod(join(from, "themes"), 0o755);
            }

            expect(committed).toBe(false);
            await expectComplete(from);
            expect(await readdir(to)).toEqual(["projects.json"]);
            expect(await readFile(join(to, "projects.json"), "utf-8")).toBe("theirs");
        },
    );

    it("puts the destination back when the commit fails", async () => {
        const from = join(root, "old");
        const to = join(root, "new");
        await seed(from);
        await mkdir(to);
        await writeFile(join(to, "projects.json"), "theirs");

        await expectRejects(
            migrateDataDir(from, to, async () => {
                throw new Error("pointer write failed");
            }),
            "pointer write failed",
        );

        await expectComplete(from);
        expect(await readdir(to)).toEqual(["projects.json"]);
        expect(await readFile(join(to, "projects.json"), "utf-8")).toBe("theirs");
    });

    it.skipIf(process.platform === "win32")(
        "keeps the new folder and reports the source it could not delete after the commit",
        async () => {
            const from = join(root, "old");
            const to = join(root, "new");
            await seed(from);
            // projects.json is deleted first; flows cannot be, a file is locked in it.
            await mkdir(join(from, "flows", "locked"));
            await writeFile(join(from, "flows", "locked", "a.json"), "{}");
            await chmod(join(from, "flows", "locked"), 0o555);
            let leftovers: string[] | undefined;
            try {
                leftovers = await migrateDataDir(from, to, async () => {});
            } finally {
                await chmod(join(from, "flows", "locked"), 0o755);
                await chmod(join(to, "flows", "locked"), 0o755).catch(() => undefined);
            }

            expect(leftovers).toEqual([join(from, "flows")]);
            await expectComplete(to);
            expect(await readdir(from)).toEqual(["flows"]);
        },
    );
});

describe("data location pointer", () => {
    let base: string;
    beforeEach(async () => {
        base = await mkdtemp(join(tmpdir(), "taskflow-data-location-"));
    });
    afterEach(async () => {
        await rm(base, { recursive: true, force: true });
    });

    it("writes the pointer whole, leaving no temp file", async () => {
        await writeDataLocation(base, "/data/new");

        expect(JSON.parse(await readFile(join(base, "data-location.json"), "utf-8"))).toEqual({
            path: "/data/new",
        });
        expect(await readdir(base)).toEqual(["data-location.json"]);
    });

    it("fails loudly when the pointer cannot be removed", async () => {
        await mkdir(join(base, "data-location.json", "locked"), { recursive: true });

        await expectRejects(clearDataLocation(base));
    });
});
