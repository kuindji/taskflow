import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    symlink,
    unlink,
    writeFile,
} from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { removeWorktreeDirectorySafely } from "../../src/services/worktree-removal";
import { expectRejects } from "../expect-rejects";

describe("worktree filesystem removal", () => {
    let root: string;
    let worktree: string;
    let outside: string;
    beforeEach(async () => {
        root = await realpath(await mkdtemp(join(tmpdir(), "taskflow-safe-remove-")));
        worktree = join(root, "worktree");
        outside = join(root, "outside");
        await mkdir(worktree);
        await mkdir(outside);
        await writeFile(join(outside, "sentinel"), "survives");
        await writeFile(join(worktree, ".git"), "gitdir: /admin/worktrees/test\n");
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });
    it("symlink targets outside the worktree survive", async () => {
        await symlink(
            outside,
            join(worktree, "outside-link"),
            process.platform === "win32" ? "junction" : "dir",
        );
        await mkdir(join(worktree, "nested"));
        await writeFile(join(worktree, "nested", "file"), "remove");
        await removeWorktreeDirectorySafely(worktree);
        expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("survives");
        await expectRejects(lstat(worktree), "ENOENT");
    });
    it.skipIf(process.platform !== "win32")(
        "junction targets outside the worktree survive on Windows",
        async () => {
            await symlink(outside, join(worktree, "junction"), "junction");
            await removeWorktreeDirectorySafely(worktree);
            expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("survives");
        },
    );
    it("unlinks a target symlink without traversing it", async () => {
        const link = join(root, "root-link");
        await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
        await removeWorktreeDirectorySafely(link);
        expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("survives");
    });
    it("partial failure preserves the git backlink when possible", async () => {
        const gitFile = join(worktree, ".git");
        await writeFile(join(worktree, "blocked"), "open file");
        await expectRejects(
            removeWorktreeDirectorySafely(worktree, {
                unlink: async (path) => {
                    if (path.endsWith("blocked")) {
                        await unlink(gitFile).catch(() => {});
                        throw new Error("file held open");
                    }
                    return unlink(path);
                },
            }),
            "file held open",
        );
        expect(await readFile(gitFile, "utf8")).toBe("gitdir: /admin/worktrees/test\n");
    });
    it("does not hide inspection failures", async () => {
        await expectRejects(
            removeWorktreeDirectorySafely(worktree, {
                lstat: async () => {
                    throw new Error("stat refused");
                },
            }),
            "stat refused",
        );
    });
});
