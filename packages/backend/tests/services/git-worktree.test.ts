import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "fs/promises";
import { join, parse } from "path";
import { tmpdir } from "os";
import { git } from "../../src/services/git-helpers";
import { removeWorktree } from "../../src/services/git-worktree";
import { expectRejects } from "../expect-rejects";

describe("safe linked worktree removal", () => {
    let root: string;
    let repo: string;
    let linked: string;
    beforeEach(async () => {
        root = await realpath(await mkdtemp(join(tmpdir(), "taskflow-worktree-")));
        repo = join(root, "repo");
        linked = join(root, "linked");
        await mkdir(repo);
        await git(["init"], repo);
        await git(
            [
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@test.com",
                "commit",
                "--allow-empty",
                "-m",
                "initial",
            ],
            repo,
        );
        await git(["worktree", "add", "-b", "linked", "--", linked], repo);
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("refuses the main worktree without invoking a remover", async () => {
        let calls = 0;
        await expectRejects(
            removeWorktree(repo, repo, {
                removeDirectory: async () => {
                    calls++;
                },
            }),
            "Refusing to remove the main worktree",
        );
        expect(calls).toBe(0);
        expect(await Bun.file(join(repo, ".git", "HEAD")).exists()).toBe(true);
    });
    it("refuses an existing foreign or unregistered directory", async () => {
        for (const target of [join(root, "unregistered"), join(root, "foreign")]) {
            await mkdir(target);
            if (target.endsWith("foreign")) await git(["init"], target);
            await writeFile(join(target, "sentinel"), "safe");
            await expectRejects(
                removeWorktree(repo, target),
                `Refusing to remove an unregistered worktree: ${target}`,
            );
            expect(await readFile(join(target, "sentinel"), "utf8")).toBe("safe");
        }
    });
    it("refuses a locked linked worktree", async () => {
        await git(["worktree", "lock", linked], repo);
        await expectRejects(
            removeWorktree(repo, linked),
            `Refusing to remove a locked worktree: ${linked}`,
        );
        expect(await Bun.file(join(linked, ".git")).exists()).toBe(true);
    });
    it("registered paths containing spaces and newlines match exactly", async () => {
        const unusual = join(root, "space and\nnewline");
        await git(["worktree", "move", linked, unusual], repo);
        await removeWorktree(repo, join(unusual, "..", "space and\nnewline"));
        expect(await Bun.file(join(unusual, ".git")).exists()).toBe(false);
        expect(await git(["worktree", "list", "--porcelain", "-z"], repo)).not.toContain(unusual);
    });
    it("matches a canonical existing directory through its parent alias", async () => {
        const alias = join(root, "alias");
        await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
        await removeWorktree(repo, join(alias, "linked"));
        expect(await Bun.file(join(linked, ".git")).exists()).toBe(false);
    });
    it("already absent worktree is pruned", async () => {
        await rm(linked, { recursive: true });
        await removeWorktree(repo, linked);
        expect(await git(["worktree", "list", "--porcelain", "-z"], repo)).not.toContain(linked);
        await removeWorktree(repo, join(root, "never-existed"));
    });
    it("failed git removal safely deletes the registered directory then prunes", async () => {
        const calls: string[][] = [];
        await removeWorktree(repo, linked, {
            git: async (args, cwd, options) => {
                calls.push(args);
                if (args[0] === "worktree" && args[1] === "remove")
                    throw new Error("forced Git failure");
                return git(args, cwd, options);
            },
        });
        expect(await Bun.file(join(linked, ".git")).exists()).toBe(false);
        expect(calls.at(-1)).toEqual(["worktree", "prune"]);
        if (process.platform !== "win32")
            expect(calls).toContainEqual(["worktree", "remove", "--force", "--", linked]);
    });
    it("Windows removes files before pruning without asking Git to remove", async () => {
        const calls: string[] = [];
        await removeWorktree(repo, linked, {
            platform: "win32",
            removeDirectory: async () => {
                calls.push("files");
                await rm(linked, { recursive: true });
            },
            git: async (args, cwd, options) => {
                if (args[0] === "worktree" && args[1] === "remove")
                    throw new Error("unsafe Git remove");
                if (args[1] === "prune") calls.push("prune");
                return git(args, cwd, options);
            },
        });
        expect(calls).toEqual(["files", "prune"]);
    });
    it("invalid admin backlink refuses fallback filesystem removal", async () => {
        const admin = (await readFile(join(linked, ".git"), "utf8")).trim().slice(8);
        await writeFile(join(admin, "gitdir"), join(root, "foreign", ".git"));
        let removed = false;
        await expectRejects(
            removeWorktree(repo, linked, {
                removeDirectory: async () => {
                    removed = true;
                },
            }),
            `Refusing to remove an unregistered worktree: ${linked}`,
        );
        expect(removed).toBe(false);
    });
    it("refuses roots and the common Git directory before removal", async () => {
        for (const [path, message] of [
            [parse(repo).root, "Refusing to remove a filesystem root"],
            [join(repo, ".git"), "Refusing to remove the common Git directory"],
        ] as const) {
            let removed = false;
            await expectRejects(
                removeWorktree(repo, path, {
                    removeDirectory: async () => {
                        removed = true;
                    },
                }),
                message,
            );
            expect(removed).toBe(false);
        }
    });
    it("fallback preserves an outside sentinel linked from the worktree", async () => {
        const outside = join(root, "outside");
        await mkdir(outside);
        await writeFile(join(outside, "sentinel"), "safe");
        await symlink(
            outside,
            join(linked, "outside"),
            process.platform === "win32" ? "junction" : "dir",
        );
        await removeWorktree(repo, linked, {
            git: async (args, cwd, options) => {
                if (args[0] === "worktree" && args[1] === "remove")
                    throw new Error("forced Git failure");
                return git(args, cwd, options);
            },
        });
        expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("safe");
    });
    it("fallback keeps the backlink when filesystem deletion fails", async () => {
        const original = await readFile(join(linked, ".git"), "utf8");
        await expectRejects(
            removeWorktree(repo, linked, {
                git: async (args, cwd, options) => {
                    if (args[0] === "worktree" && args[1] === "remove") {
                        await rm(join(linked, ".git"));
                        throw new Error("partial Git removal");
                    }
                    return git(args, cwd, options);
                },
                removeDirectory: async () => {
                    throw new Error("open file");
                },
            }),
            "open file",
        );
        expect(await readFile(join(linked, ".git"), "utf8")).toBe(original);
    });
    it("stat permission errors are not treated as an absent worktree", async () => {
        await expectRejects(
            removeWorktree(repo, linked, {
                lstat: async () => {
                    throw new Error("permission denied");
                },
            }),
            "permission denied",
        );
        expect(await Bun.file(join(linked, ".git")).exists()).toBe(true);
    });
});
