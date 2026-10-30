import { lstat, mkdir, readFile, realpath, writeFile } from "fs/promises";
import { dirname, join, parse, resolve } from "path";
import { git } from "./git-helpers";
import { removeWorktreeDirectorySafely } from "./worktree-removal";

async function createWorktree(
    repoPath: string,
    branch: string,
    worktreePath: string,
): Promise<void> {
    await mkdir(dirname(worktreePath), { recursive: true });
    await git(["worktree", "add", "-b", branch, worktreePath], repoPath);
}

async function isBranchMerged(repoPath: string, branch: string): Promise<boolean> {
    // If the branch no longer exists, treat as already merged/cleaned up
    const branches = await git(["branch", "--list", branch], repoPath, { readOnly: true });
    if (!branches.trim()) {
        return true;
    }
    const output = await git(["branch", "--merged"], repoPath, { readOnly: true });
    return output.split("\n").some((line) => line.replace(/^[*+]?\s+/, "") === branch);
}

// Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): apps/server/src/vcs/worktreeRemoval.ts
async function removeWorktree(
    repoPath: string,
    worktreePath: string,
    deps: {
        git?: typeof git;
        removeDirectory?: typeof removeWorktreeDirectorySafely;
        platform?: NodeJS.Platform;
        lstat?: typeof lstat;
    } = {},
): Promise<void> {
    const target = resolve(worktreePath);
    const run = deps.git ?? git;
    const inspect = deps.lstat ?? lstat;
    const platform = deps.platform ?? process.platform;
    const removeDirectory = deps.removeDirectory ?? removeWorktreeDirectorySafely;
    const normalize = (path: string): string => {
        const absolute = resolve(path);
        return platform === "win32" ? absolute.toLowerCase() : absolute;
    };
    async function canonical(path: string): Promise<string> {
        try {
            return normalize(await realpath(path));
        } catch (error) {
            if (isMissing(error)) return normalize(path);
            throw error;
        }
    }
    const targetCanonical = await canonical(target);
    async function samePath(path: string): Promise<boolean> {
        return normalize(path) === normalize(target) || (await canonical(path)) === targetCanonical;
    }
    const output = await run(["worktree", "list", "--porcelain", "-z"], repoPath, {
        readOnly: true,
    });
    const entries: Array<{ path: string; locked: boolean }> = [];
    for (const record of output.split("\0\0")) {
        const fields = record.split("\0");
        const pathField = fields.find((field) => field.startsWith("worktree "));
        if (!pathField) continue;
        entries.push({
            path: pathField.slice(9),
            locked: fields.some((field) => field === "locked" || field.startsWith("locked ")),
        });
    }
    if (entries[0] && (await samePath(entries[0].path))) {
        throw new Error("Refusing to remove the main worktree");
    }
    if (targetCanonical === normalize(parse(targetCanonical).root)) {
        throw new Error(`Refusing to remove a filesystem root: ${target}`);
    }
    const commonDir = resolve(
        repoPath,
        stripTerminator(await run(["rev-parse", "--git-common-dir"], repoPath, { readOnly: true })),
    );
    if (await samePath(commonDir)) {
        throw new Error(`Refusing to remove the common Git directory: ${target}`);
    }
    let entry: (typeof entries)[number] | undefined;
    for (const candidate of entries) {
        if (await samePath(candidate.path)) {
            entry = candidate;
            break;
        }
    }
    const unregistered = () => new Error(`Refusing to remove an unregistered worktree: ${target}`);
    const locked = () => new Error(`Refusing to remove a locked worktree: ${target}`);
    if (entry?.locked) throw locked();
    try {
        await inspect(target);
    } catch (error) {
        if (!isMissing(error)) throw error;
        await run(["worktree", "prune"], repoPath);
        return;
    }
    if (!entry) throw unregistered();

    // The linked .git file must name this repository's worktrees admin directory,
    // and that directory's gitdir must point back to this exact .git file.
    const gitFile = join(target, ".git");
    const gitFileInfo = await inspect(gitFile);
    if (!gitFileInfo.isFile() || gitFileInfo.isSymbolicLink()) throw unregistered();
    const contents = stripTerminator(await readFile(gitFile, "utf8"));
    if (!contents.startsWith("gitdir: ")) throw unregistered();
    const adminDir = resolve(target, contents.slice(8));
    if ((await canonical(dirname(adminDir))) !== (await canonical(join(commonDir, "worktrees"))))
        throw unregistered();
    const backlink = stripTerminator(await readFile(join(adminDir, "gitdir"), "utf8"));
    if ((await canonical(resolve(adminDir, backlink))) !== (await canonical(gitFile)))
        throw unregistered();
    let hasLock = true;
    try {
        await inspect(join(adminDir, "locked"));
    } catch (error) {
        if (!isMissing(error)) throw error;
        hasLock = false;
    }
    if (hasLock) throw locked();
    if (platform !== "win32") {
        try {
            await run(["worktree", "remove", "--force", "--", target], repoPath);
            return;
        } catch {
            // Git can remove .git before failing. Keep a retry verifiable.
            await writeFile(gitFile, `${contents}\n`).catch(() => {});
        }
        try {
            await inspect(target);
        } catch (error) {
            if (!isMissing(error)) throw error;
            await run(["worktree", "prune"], repoPath);
            return;
        }
    }
    await removeDirectory(target);
    await run(["worktree", "prune"], repoPath);
}

function isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function stripTerminator(output: string): string {
    return output.replace(/\r?\n$/, "");
}

async function deleteBranch(repoPath: string, branch: string): Promise<void> {
    await git(["branch", "-D", branch], repoPath);
}

export { createWorktree, isBranchMerged, removeWorktree, deleteBranch };
