import { MSG } from "@taskflow/shared";
import type {
    FileTreePayload,
    FileReadPayload,
    FileWatchPayload,
    FileUnwatchPayload,
    FileWritePayload,
    FileStatPayload,
    FileRenamePayload,
    FilePathPayload,
    WsEvent,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { FileWatcher } from "../services/file-watcher";
import type { TaskStore } from "../services/task-store";
import { readFile, writeFile, stat as fsStat, rename, rm } from "fs/promises";
import { assertWorkspacePath, assertMutableWorkspacePath } from "../utils/path-validation";

interface FileHandlerDeps {
    router: Router;
    fileWatcher: FileWatcher;
    taskStore: TaskStore;
    broadcast: (event: WsEvent) => void;
}

export function registerFileHandlers(deps: FileHandlerDeps): void {
    const { router, fileWatcher, taskStore, broadcast } = deps;

    router.register(MSG.FILE_TREE, async (payload) => {
        const { path } = payload as FileTreePayload;
        const workspacePath = await assertWorkspacePath(taskStore, path);
        const tree = await fileWatcher.buildTree(workspacePath);
        return { tree };
    });

    router.register(MSG.FILE_READ, async (payload) => {
        const { path } = payload as FileReadPayload;
        const workspacePath = await assertWorkspacePath(taskStore, path);
        const content = await readFile(workspacePath, "utf-8");
        return { content };
    });

    router.register(MSG.FILE_WRITE, async (payload) => {
        const { path, content } = payload as FileWritePayload;
        const workspacePath = await assertWorkspacePath(taskStore, path);
        await writeFile(workspacePath, content, "utf-8");
        return { success: true };
    });

    router.register(MSG.FILE_WATCH, async (payload) => {
        const { path } = payload as FileWatchPayload;
        const workspacePath = await assertWorkspacePath(taskStore, path);
        await fileWatcher.watch(workspacePath, (event) => {
            broadcast({ type: MSG.FILE_CHANGED, payload: event });
        });
        return { success: true };
    });

    router.register(MSG.FILE_UNWATCH, async (payload) => {
        const { path } = payload as FileUnwatchPayload;
        const workspacePath = await assertWorkspacePath(taskStore, path);
        fileWatcher.stop(workspacePath);
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
        const resolvedOld = await assertMutableWorkspacePath(taskStore, oldPath);
        const resolvedNew = await assertWorkspacePath(taskStore, newPath);
        try {
            await fsStat(resolvedNew);
            throw new Error("A file or folder with that name already exists");
        } catch (e) {
            if (e instanceof Error && e.message === "A file or folder with that name already exists") throw e;
            // ENOENT is expected — target doesn't exist, proceed
        }
        await rename(resolvedOld, resolvedNew);
        return { success: true };
    });

    router.register(MSG.FILE_DELETE_FILE, async (payload) => {
        const { path } = payload as FilePathPayload;
        const resolvedPath = await assertMutableWorkspacePath(taskStore, path);
        await rm(resolvedPath, { recursive: true });
        return { success: true };
    });

    router.register(MSG.FILE_OPEN_EXTERNAL, async (payload) => {
        const { path } = payload as FilePathPayload;
        const resolvedPath = await assertWorkspacePath(taskStore, path);
        const editor = process.env.EDITOR || "code";
        const which = Bun.which(editor);
        if (!which) {
            throw new Error(`Editor "${editor}" not found on PATH`);
        }
        Bun.spawn([which, resolvedPath], {
            stdio: ["ignore", "ignore", "ignore"],
        });
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
}
