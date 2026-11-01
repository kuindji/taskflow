import { MSG } from "@taskflow/shared";
import type {
    FileTreePayload,
    FileListDirPayload,
    FileReadPayload,
    FileWatchPayload,
    FileUnwatchPayload,
    FileWritePayload,
    FileStatPayload,
    FileRenamePayload,
    FilePathPayload,
    FileMkdirPayload,
    WsEvent,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { FileWatcher } from "../services/file-watcher";
import type { TaskStore } from "../services/task-store";
import type { ChangeTracker } from "../services/change-tracker";
import { readFile, writeFile, stat as fsStat, lstat, rename, rm, mkdir } from "fs/promises";
import type { Stats } from "fs";
import { basename, dirname } from "path";
import { isUtf8 } from "buffer";
import {
    assertMutableWorkspaceEntry,
    assertMutableWorkspacePath,
    assertWorkspacePath,
} from "../utils/path-validation";
import { readFilePreview } from "../services/file-preview";
import { getKnownEditor } from "../services/editor-detector";
import { resolveEditorCommand } from "../services/editor-resolver";

async function readExisting(path: string): Promise<Buffer> {
    try {
        return await readFile(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return Buffer.alloc(0);
        throw error;
    }
}

/** `newPath` is `oldPath` spelled differently (case, Unicode form) on a volume that ignores it. */
async function isSameEntryRespelled(oldPath: string, newPath: string, existing: Stats) {
    const source = await lstat(oldPath).catch(() => null);
    const foldName = (path: string) => basename(path).normalize("NFC").toLowerCase();
    return (
        source !== null &&
        source.dev === existing.dev &&
        source.ino === existing.ino &&
        dirname(oldPath) === dirname(newPath) &&
        foldName(oldPath) === foldName(newPath)
    );
}

interface FileHandlerDeps {
    router: Router;
    fileWatcher: FileWatcher;
    taskStore: TaskStore;
    broadcast: (event: WsEvent) => void;
    changeTracker?: ChangeTracker;
    resolveEditor?: typeof resolveEditorCommand;
    spawnEditor?: (command: string, args: string[]) => void;
}

export function registerFileHandlers(deps: FileHandlerDeps): void {
    const { router, fileWatcher, taskStore, broadcast, changeTracker } = deps;
    const resolveEditor = deps.resolveEditor ?? resolveEditorCommand;
    const spawnEditor =
        deps.spawnEditor ??
        ((command: string, args: string[]) => {
            Bun.spawn([command, ...args], { stdio: ["ignore", "ignore", "ignore"] });
        });

    router.register(MSG.FILE_TREE, async (payload) => {
        const { path } = payload as FileTreePayload;
        const workspacePath = await assertWorkspacePath(taskStore, path);
        const { tree, gitignorePatterns } = await fileWatcher.buildTree(workspacePath);
        return { tree, gitignorePatterns };
    });

    router.register(MSG.FILE_LIST_DIR, async (payload) => {
        const { path } = payload as FileListDirPayload;
        const workspacePath = await assertWorkspacePath(taskStore, path);
        const { entries, gitignorePatterns } = await fileWatcher.listDir(workspacePath);
        return { entries, gitignorePatterns };
    });

    router.register(MSG.FILE_READ, async (payload) => {
        const { path } = payload as FileReadPayload;
        const workspacePath = await assertWorkspacePath(taskStore, path);
        return readFilePreview(workspacePath);
    });

    router.register(MSG.FILE_WRITE, async (payload) => {
        const { path, content } = payload as FileWritePayload;
        const workspacePath = await assertMutableWorkspacePath(taskStore, path);
        // The editor received this file decoded as UTF-8 with every invalid
        // byte turned into U+FFFD; writing that back would destroy them all.
        if (!isUtf8(await readExisting(workspacePath))) {
            throw new Error("The file is not UTF-8 text; saving it here would corrupt it");
        }
        await writeFile(workspacePath, content, "utf-8");
        return { success: true };
    });

    router.register(MSG.FILE_WATCH, async (payload, ctx) => {
        const { path } = payload as FileWatchPayload;
        const workspacePath = await assertWorkspacePath(taskStore, path);
        await fileWatcher.watch(workspacePath, ctx.clientId, (event) => {
            broadcast({ type: MSG.FILE_CHANGED, payload: event });
            changeTracker?.onFileChanged(event.path);
        });
        return { success: true };
    });

    router.register(MSG.FILE_UNWATCH, async (payload, ctx) => {
        const { path } = payload as FileUnwatchPayload;
        const workspacePath = await assertWorkspacePath(taskStore, path);
        await fileWatcher.release(workspacePath, ctx.clientId);
        return { success: true };
    });

    router.register(MSG.FILE_STAT, async (payload) => {
        const { path } = payload as FileStatPayload;
        const workspacePath = await assertWorkspacePath(taskStore, path);
        try {
            const stats = await fsStat(workspacePath);
            return { exists: true, isDirectory: stats.isDirectory() };
        } catch {
            return { exists: false, isDirectory: false };
        }
    });

    router.register(MSG.FILE_RENAME, async (payload) => {
        const { oldPath, newPath } = payload as FileRenamePayload;
        const resolvedOld = await assertMutableWorkspaceEntry(taskStore, oldPath);
        // The name as typed: resolving it would give back the existing spelling
        // on a case-insensitive volume, and a case-only rename would do nothing.
        const resolvedNew = await assertMutableWorkspaceEntry(taskStore, newPath);
        const existing = await lstat(resolvedNew).catch(() => null);
        if (existing && !(await isSameEntryRespelled(resolvedOld, resolvedNew, existing))) {
            throw new Error("A file or folder with that name already exists");
        }
        await rename(resolvedOld, resolvedNew);
        return { success: true };
    });

    router.register(MSG.FILE_DELETE_FILE, async (payload) => {
        const { path } = payload as FilePathPayload;
        const resolvedPath = await assertMutableWorkspaceEntry(taskStore, path);
        await rm(resolvedPath, { recursive: true });
        return { success: true };
    });

    router.register(MSG.FILE_OPEN_EXTERNAL, async (payload) => {
        const { path } = payload as FilePathPayload;
        const resolvedPath = await assertWorkspacePath(taskStore, path);
        const editor = process.env.EDITOR || "code";
        const command = await resolveEditor(
            getKnownEditor(editor) ?? { id: editor, name: editor, command: editor },
        );
        if (!command) {
            throw new Error(`Editor "${editor}" not found`);
        }
        spawnEditor(command, [resolvedPath]);
        return { success: true };
    });

    router.register(MSG.FILE_REVEAL, async (payload) => {
        const { path } = payload as FilePathPayload;
        const resolvedPath = await assertWorkspacePath(taskStore, path);
        Bun.spawn(["open", "-R", resolvedPath], {
            stdio: ["ignore", "ignore", "ignore"],
        });
        return { success: true };
    });

    router.register(MSG.FILE_MKDIR, async (payload) => {
        const { path } = payload as FileMkdirPayload;
        const resolvedPath = await assertWorkspacePath(taskStore, path);
        try {
            await fsStat(resolvedPath);
            throw new Error("A file or folder with that name already exists");
        } catch (e) {
            if (
                e instanceof Error &&
                e.message === "A file or folder with that name already exists"
            )
                throw e;
        }
        await mkdir(resolvedPath, { recursive: true });
        return { success: true };
    });
}
