import { lstat, readFile, readdir, rmdir, unlink, writeFile } from "fs/promises";
import { join } from "path";

// Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): apps/server/src/vcs/worktreeRemoval.ts
async function removeWorktreeDirectorySafely(
    worktreePath: string,
    deps: { lstat?: typeof lstat; unlink?: (path: string) => Promise<void> } = {},
): Promise<void> {
    const inspect = deps.lstat ?? lstat;
    const removeFile = deps.unlink ?? unlink;
    const root = await inspect(worktreePath);
    if (!root.isDirectory() || root.isSymbolicLink()) {
        await removeFile(worktreePath);
        return;
    }

    const gitFile = join(worktreePath, ".git");
    let gitFileContents: string | undefined;
    try {
        const info = await inspect(gitFile);
        if (info.isFile()) gitFileContents = await readFile(gitFile, "utf8");
    } catch (error) {
        if (!isMissing(error)) throw error;
    }

    async function remove(path: string): Promise<void> {
        const info = await inspect(path);
        // lstat identifies links and Windows junctions without following them.
        if (info.isSymbolicLink() || !info.isDirectory()) {
            await removeFile(path);
            return;
        }
        for (const entry of await readdir(path)) await remove(join(path, entry));
        await rmdir(path);
    }

    try {
        await remove(worktreePath);
    } catch (error) {
        // Restore ownership evidence after a partial delete, if the directory remains.
        if (gitFileContents !== undefined) {
            await writeFile(gitFile, gitFileContents).catch(() => {});
        }
        throw error;
    }
}

function isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export { removeWorktreeDirectorySafely };
