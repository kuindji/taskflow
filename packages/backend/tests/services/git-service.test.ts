import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { GitService } from "../../src/services/git-service";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

async function run(args: string[], cwd: string): Promise<void> {
    const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
    await proc.exited;
}

describe("GitService", () => {
    let git: GitService;
    let repoDir: string;

    beforeEach(async () => {
        repoDir = await mkdtemp(join(tmpdir(), "taskflow-git-test-"));
        await run(["git", "init"], repoDir);
        await run(["git", "config", "user.email", "test@test.com"], repoDir);
        await run(["git", "config", "user.name", "Test"], repoDir);
        await writeFile(join(repoDir, "initial.txt"), "initial content");
        await run(["git", "add", "."], repoDir);
        await run(["git", "commit", "-m", "initial"], repoDir);
        git = new GitService();
    });

    afterEach(async () => {
        await rm(repoDir, { recursive: true, force: true });
    });

    it("gets status of clean repo", async () => {
        const status = await git.status(repoDir);
        expect(status.branch).toBeTruthy();
        expect(status.stagedFiles).toHaveLength(0);
        expect(status.unstagedFiles).toHaveLength(0);
    });

    it("detects modified files", async () => {
        await writeFile(join(repoDir, "initial.txt"), "modified");
        const status = await git.status(repoDir);
        expect(status.unstagedFiles).toHaveLength(1);
        expect(status.unstagedFiles[0].status).toBe("modified");
    });

    it("detects new untracked files", async () => {
        await writeFile(join(repoDir, "new.txt"), "new file");
        const status = await git.status(repoDir);
        expect(status.unstagedFiles).toHaveLength(1);
        expect(status.unstagedFiles[0].status).toBe("untracked");
    });

    it("separates staged and unstaged files in status", async () => {
        await writeFile(join(repoDir, "initial.txt"), "modified");
        await writeFile(join(repoDir, "staged.txt"), "new content");
        await run(["git", "add", "staged.txt"], repoDir);

        const status = await git.status(repoDir);
        expect(status.stagedFiles).toHaveLength(1);
        expect(status.stagedFiles[0]).toMatchObject({
            path: "staged.txt",
            status: "new",
            staged: true,
        });
        expect(status.unstagedFiles).toHaveLength(1);
        expect(status.unstagedFiles[0]).toMatchObject({
            path: "initial.txt",
            status: "modified",
            staged: false,
        });
    });

    it("shows partially staged file in both arrays", async () => {
        await writeFile(join(repoDir, "initial.txt"), "staged content");
        await run(["git", "add", "initial.txt"], repoDir);
        await writeFile(join(repoDir, "initial.txt"), "more changes after staging");

        const status = await git.status(repoDir);
        expect(status.stagedFiles).toHaveLength(1);
        expect(status.stagedFiles[0]).toMatchObject({
            path: "initial.txt",
            status: "modified",
            staged: true,
        });
        expect(status.unstagedFiles).toHaveLength(1);
        expect(status.unstagedFiles[0]).toMatchObject({
            path: "initial.txt",
            status: "modified",
            staged: false,
        });
    });

    it("shows untracked files only in unstaged", async () => {
        await writeFile(join(repoDir, "untracked.txt"), "untracked");
        const status = await git.status(repoDir);
        expect(status.stagedFiles).toHaveLength(0);
        expect(status.unstagedFiles).toHaveLength(1);
        expect(status.unstagedFiles[0]).toMatchObject({
            path: "untracked.txt",
            status: "untracked",
            staged: false,
        });
    });

    it("gets diff", async () => {
        await writeFile(join(repoDir, "initial.txt"), "modified content");
        const diff = await git.diff(repoDir);
        expect(diff.files).toHaveLength(1);
        expect(diff.files[0].staged).toBe(false);
        expect(diff.files[0].diff).toContain("modified content");
    });

    it("gets diff for untracked files", async () => {
        await writeFile(join(repoDir, "new.txt"), "new file");
        const diff = await git.diff(repoDir);
        expect(diff.files).toHaveLength(1);
        expect(diff.files[0]).toMatchObject({
            path: "new.txt",
            additions: 1,
            deletions: 0,
            staged: false,
        });
        expect(diff.files[0].diff).toContain("new file");
    });

    it("gets diff for staged new files", async () => {
        await writeFile(join(repoDir, "staged.txt"), "staged file");
        await run(["git", "add", "staged.txt"], repoDir);
        const diff = await git.diff(repoDir);
        expect(diff.files).toHaveLength(1);
        expect(diff.files[0]).toMatchObject({
            path: "staged.txt",
            additions: 1,
            deletions: 0,
            staged: true,
        });
        expect(diff.files[0].diff).toContain("staged file");
    });

    it("gets diff for renamed files", async () => {
        await run(["git", "mv", "initial.txt", "renamed file.txt"], repoDir);
        const diff = await git.diff(repoDir);
        expect(diff.files).toHaveLength(1);
        expect(diff.files[0]).toMatchObject({
            path: "renamed file.txt",
            additions: 0,
            deletions: 0,
            staged: true,
        });
        expect(diff.files[0].diff).toContain("rename to renamed file.txt");
    });

    it("throws when the path is not a git repository", async () => {
        const nonRepoDir = await mkdtemp(join(tmpdir(), "taskflow-git-nonrepo-"));
        expect(git.status(nonRepoDir)).rejects.toThrow();
        await rm(nonRepoDir, { recursive: true, force: true });
    });

    it("reverts a modified file", async () => {
        await writeFile(join(repoDir, "initial.txt"), "modified");
        await git.revertFile(repoDir, { path: "initial.txt", status: "modified" });
        const status = await git.status(repoDir);
        expect(status.stagedFiles).toHaveLength(0);
        expect(status.unstagedFiles).toHaveLength(0);
    });

    it("parses renamed files with spaces using porcelain -z metadata", async () => {
        await run(["git", "mv", "initial.txt", "renamed file.txt"], repoDir);
        const status = await git.status(repoDir);
        expect(status.stagedFiles).toHaveLength(1);
        expect(status.stagedFiles[0]).toMatchObject({
            status: "renamed",
            path: "renamed file.txt",
            previousPath: "initial.txt",
            staged: true,
        });
    });

    it("reverts an untracked file by removing it", async () => {
        await writeFile(join(repoDir, "scratch.txt"), "temporary");
        await git.revertFile(repoDir, { path: "scratch.txt", status: "untracked" });
        const status = await git.status(repoDir);
        expect(status.stagedFiles).toHaveLength(0);
        expect(status.unstagedFiles).toHaveLength(0);
    });

    it("reverts a renamed file", async () => {
        await run(["git", "mv", "initial.txt", "renamed file.txt"], repoDir);
        await git.revertFile(repoDir, {
            path: "renamed file.txt",
            previousPath: "initial.txt",
            status: "renamed",
        });
        const status = await git.status(repoDir);
        expect(status.stagedFiles).toHaveLength(0);
        expect(status.unstagedFiles).toHaveLength(0);
    });

    it("reverts a staged new file", async () => {
        await writeFile(join(repoDir, "staged.txt"), "new content");
        await run(["git", "add", "staged.txt"], repoDir);
        await git.revertFile(repoDir, { path: "staged.txt", status: "new" });
        const status = await git.status(repoDir);
        expect(status.stagedFiles).toHaveLength(0);
        expect(status.unstagedFiles).toHaveLength(0);
    });

    it("gets file diff for staged files", async () => {
        await writeFile(join(repoDir, "staged.txt"), "new content");
        await run(["git", "add", "staged.txt"], repoDir);
        const result = await git.diffFile(repoDir, "staged.txt");
        expect(result.staged).toContain("new content");
    });

    it("diffFile returns staged and unstaged diffs separately", async () => {
        await writeFile(join(repoDir, "initial.txt"), "staged content");
        await run(["git", "add", "initial.txt"], repoDir);
        await writeFile(join(repoDir, "initial.txt"), "more unstaged changes");

        const result = await git.diffFile(repoDir, "initial.txt");
        expect(result.staged).toContain("staged content");
        expect(result.unstaged).toContain("more unstaged changes");
    });

    it("diffFile returns only staged for fully staged file", async () => {
        await writeFile(join(repoDir, "initial.txt"), "staged only");
        await run(["git", "add", "initial.txt"], repoDir);

        const result = await git.diffFile(repoDir, "initial.txt");
        expect(result.staged).toContain("staged only");
        expect(result.unstaged).toBeUndefined();
    });

    it("diffFile returns only unstaged for untracked file", async () => {
        await writeFile(join(repoDir, "new.txt"), "untracked content");

        const result = await git.diffFile(repoDir, "new.txt");
        expect(result.staged).toBeUndefined();
        expect(result.unstaged).toContain("untracked content");
    });

    it("stages a single file", async () => {
        await writeFile(join(repoDir, "a.txt"), "aaa");
        await writeFile(join(repoDir, "b.txt"), "bbb");

        await git.stage(repoDir, "a.txt");
        const status = await git.status(repoDir);
        expect(status.stagedFiles).toHaveLength(1);
        expect(status.stagedFiles[0].path).toBe("a.txt");
        expect(status.unstagedFiles).toHaveLength(1);
        expect(status.unstagedFiles[0].path).toBe("b.txt");
    });

    it("stages all files", async () => {
        await writeFile(join(repoDir, "a.txt"), "aaa");
        await writeFile(join(repoDir, "b.txt"), "bbb");

        await git.stage(repoDir);
        const status = await git.status(repoDir);
        expect(status.stagedFiles).toHaveLength(2);
        expect(status.unstagedFiles).toHaveLength(0);
    });

    it("unstages a single file", async () => {
        await writeFile(join(repoDir, "a.txt"), "aaa");
        await writeFile(join(repoDir, "b.txt"), "bbb");
        await run(["git", "add", "."], repoDir);

        await git.unstage(repoDir, "a.txt");
        const status = await git.status(repoDir);
        expect(status.stagedFiles).toHaveLength(1);
        expect(status.stagedFiles[0].path).toBe("b.txt");
        expect(status.unstagedFiles).toHaveLength(1);
        expect(status.unstagedFiles[0].path).toBe("a.txt");
    });

    it("unstages all files", async () => {
        await writeFile(join(repoDir, "a.txt"), "aaa");
        await writeFile(join(repoDir, "b.txt"), "bbb");
        await run(["git", "add", "."], repoDir);

        await git.unstage(repoDir);
        const status = await git.status(repoDir);
        expect(status.stagedFiles).toHaveLength(0);
        expect(status.unstagedFiles).toHaveLength(2);
    });

    it("creates a worktree", async () => {
        const wtPath = join(repoDir, ".worktrees", "test-branch");
        await git.createWorktree(repoDir, "test-branch", wtPath);
        const status = await git.status(wtPath);
        expect(status.branch).toBe("test-branch");
        // Cleanup
        await run(["git", "worktree", "remove", wtPath], repoDir);
    });
});
