import { MSG } from "@taskflow/shared";
import type {
    FileTreePayload,
    FileReadPayload,
    FileWatchPayload,
    FileUnwatchPayload,
    FileWritePayload,
    WsEvent,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { FileWatcher } from "../services/file-watcher";
import type { TaskStore } from "../services/task-store";
import { readFile, writeFile } from "fs/promises";
import { assertWorkspacePath } from "../utils/path-validation";

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
}
