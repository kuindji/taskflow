import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { GitService } from "../../src/services/git-service";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

async function run(args: string[], cwd: string): Promise<void> {
    const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
    await proc.exited;
}

async function commitFile(
    repoDir: string,
    name: string,
    content: string,
    message: string,
): Promise<void> {
    await writeFile(join(repoDir, name), content);
    await run(["git", "add", "."], repoDir);
    await run(["git", "commit", "-m", message], repoDir);
}

describe("git history", () => {
    let git: GitService;
    let repoDir: string;

    beforeEach(async () => {
        repoDir = await mkdtemp(join(tmpdir(), "taskflow-git-history-test-"));
        await run(["git", "init"], repoDir);
        await run(["git", "config", "user.email", "test@test.com"], repoDir);
        await run(["git", "config", "user.name", "Test Author"], repoDir);
        git = new GitService();
    });

    afterEach(async () => {
        await rm(repoDir, { recursive: true, force: true });
    });

    describe("log", () => {
        it("returns commits newest first with metadata", async () => {
            await commitFile(repoDir, "a.txt", "one", "first commit");
            await commitFile(repoDir, "b.txt", "two", "second commit");

            const result = await git.log(repoDir, 100, 0);

            expect(result.hasMore).toBe(false);
            expect(result.entries).toHaveLength(2);
            const [latest, oldest] = result.entries;
            expect(latest.subject).toBe("second commit");
            expect(oldest.subject).toBe("first commit");
            expect(latest.hash).toMatch(/^[0-9a-f]{40}$/);
            expect(latest.shortHash.length).toBeGreaterThanOrEqual(7);
            expect(latest.hash.startsWith(latest.shortHash)).toBe(true);
            expect(latest.authorName).toBe("Test Author");
            expect(new Date(latest.date).getTime()).not.toBeNaN();
        });

        it("pages with limit and skip and reports hasMore", async () => {
            await commitFile(repoDir, "a.txt", "1", "c1");
            await commitFile(repoDir, "a.txt", "2", "c2");
            await commitFile(repoDir, "a.txt", "3", "c3");

            const page1 = await git.log(repoDir, 2, 0);
            expect(page1.entries.map((e) => e.subject)).toEqual(["c3", "c2"]);
            expect(page1.hasMore).toBe(true);

            const page2 = await git.log(repoDir, 2, 2);
            expect(page2.entries.map((e) => e.subject)).toEqual(["c1"]);
            expect(page2.hasMore).toBe(false);
        });

        it("returns branch decorations in refs", async () => {
            await commitFile(repoDir, "a.txt", "one", "decorated");

            const result = await git.log(repoDir, 10, 0);

            // The checked-out branch name (master or main) decorates the tip commit
            expect(result.entries[0].refs.length).toBeGreaterThan(0);
            expect(result.entries[0].refs.join(",")).toMatch(/ma(in|ster)/);
        });

        it("returns empty result for a repo with no commits", async () => {
            const result = await git.log(repoDir, 100, 0);
            expect(result).toEqual({ entries: [], hasMore: false });
        });

        it("rejects when the path is not a git repository", async () => {
            const plainDir = await mkdtemp(join(tmpdir(), "taskflow-not-a-repo-"));
            try {
                await expect(git.log(plainDir, 100, 0)).rejects.toThrow();
            } finally {
                await rm(plainDir, { recursive: true, force: true });
            }
        });

        it("handles subjects containing tabs and quotes", async () => {
            await commitFile(repoDir, "a.txt", "x", 'weird\tsubject "quoted" %H');

            const result = await git.log(repoDir, 10, 0);

            expect(result.entries[0].subject).toBe('weird\tsubject "quoted" %H');
        });
    });

    describe("commitFiles", () => {
        it("lists added, modified, and deleted files with stats", async () => {
            await commitFile(repoDir, "keep.txt", "line1\n", "base");
            await writeFile(join(repoDir, "keep.txt"), "line1\nline2\n");
            await writeFile(join(repoDir, "added.txt"), "new\n");
            await run(["git", "add", "."], repoDir);
            await run(["git", "commit", "-m", "changes"], repoDir);

            const { entries } = await git.log(repoDir, 1, 0);
            const { files } = await git.commitFiles(repoDir, entries[0].hash);

            expect(files).toHaveLength(2);
            const added = files.find((f) => f.path === "added.txt");
            const modified = files.find((f) => f.path === "keep.txt");
            expect(added).toMatchObject({ status: "new", additions: 1, deletions: 0 });
            expect(modified).toMatchObject({ status: "modified", additions: 1, deletions: 0 });
        });

        it("detects deletions", async () => {
            await commitFile(repoDir, "gone.txt", "a\nb\n", "base");
            await run(["git", "rm", "gone.txt"], repoDir);
            await run(["git", "commit", "-m", "remove"], repoDir);

            const { entries } = await git.log(repoDir, 1, 0);
            const { files } = await git.commitFiles(repoDir, entries[0].hash);

            expect(files).toHaveLength(1);
            expect(files[0]).toMatchObject({
                path: "gone.txt",
                status: "deleted",
                additions: 0,
                deletions: 2,
            });
        });

        it("detects renames with previousPath", async () => {
            await commitFile(repoDir, "old name.txt", "same content\n", "base");
            await run(["git", "mv", "old name.txt", "new name.txt"], repoDir);
            await run(["git", "commit", "-m", "rename"], repoDir);

            const { entries } = await git.log(repoDir, 1, 0);
            const { files } = await git.commitFiles(repoDir, entries[0].hash);

            expect(files).toHaveLength(1);
            expect(files[0]).toMatchObject({
                path: "new name.txt",
                previousPath: "old name.txt",
                status: "renamed",
            });
        });

        it("marks binary files with -1 stats", async () => {
            await commitFile(repoDir, "a.txt", "text", "base");
            await writeFile(join(repoDir, "bin.dat"), Buffer.from([0, 1, 2, 255, 0, 7]));
            await run(["git", "add", "."], repoDir);
            await run(["git", "commit", "-m", "binary"], repoDir);

            const { entries } = await git.log(repoDir, 1, 0);
            const { files } = await git.commitFiles(repoDir, entries[0].hash);

            expect(files).toHaveLength(1);
            expect(files[0]).toMatchObject({
                path: "bin.dat",
                status: "new",
                additions: -1,
                deletions: -1,
            });
        });

        it("lists files of the root commit", async () => {
            await commitFile(repoDir, "first.txt", "hello\n", "root");

            const { entries } = await git.log(repoDir, 1, 0);
            const { files } = await git.commitFiles(repoDir, entries[0].hash);

            expect(files).toHaveLength(1);
            expect(files[0]).toMatchObject({ path: "first.txt", status: "new", additions: 1 });
        });
    });
});
