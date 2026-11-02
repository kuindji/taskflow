import { create } from "zustand";
import type {
    FileNode,
    FileChangeEvent,
    FileListDirResponse,
    GitStatusResult,
    GitStatusResponse,
    FileDiskReadResponse,
    FileDiskText,
    FileWriteResponse,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { FilePreviewError } from "@/lib/file-preview-error";
import { onEvent, sendRequest } from "@/lib/connection-registry";
import { onBackendReady } from "@/lib/backend-ready";
import { useDiffStore } from "./diff-store";
import { registerBackendReset } from "./store-reset";

function setChildrenAtPath(root: FileNode, targetPath: string, children: FileNode[]): FileNode {
    if (root.path === targetPath) {
        // A listing is one level deep: a directory still listed keeps what was loaded below it.
        const previous = new Map(root.children?.map((child) => [child.path, child]));
        return {
            ...root,
            loaded: true,
            children: children.map((child) => {
                const old = previous.get(child.path);
                return child.type === "directory" && old?.type === "directory" && old.loaded
                    ? { ...child, children: old.children, loaded: true }
                    : child;
            }),
        };
    }
    if (!root.children) return root;
    return {
        ...root,
        children: root.children.map((child) =>
            child.type === "directory" &&
            (targetPath === child.path || targetPath.startsWith(child.path + "/"))
                ? setChildrenAtPath(child, targetPath, children)
                : child,
        ),
    };
}

function isDirLoaded(root: FileNode, dirPath: string): boolean {
    if (root.path === dirPath) return root.loaded === true;
    if (!root.children) return false;
    for (const child of root.children) {
        if (
            child.type === "directory" &&
            (dirPath === child.path || dirPath.startsWith(child.path + "/"))
        ) {
            if (isDirLoaded(child, dirPath)) return true;
        }
    }
    return false;
}

function isSameOrChild(path: string, root: string): boolean {
    return path === root || path.startsWith(root + "/");
}

function collectLoadedDirs(root: FileNode, prefix: string, out: Set<string>): void {
    if (root.type !== "directory") return;
    const inside = root.path === prefix || root.path.startsWith(prefix + "/");
    if (inside && root.loaded === true) out.add(root.path);
    if (!root.children) return;
    for (const child of root.children) {
        if (child.type !== "directory") continue;
        if (inside || prefix === child.path || prefix.startsWith(child.path + "/")) {
            collectLoadedDirs(child, prefix, out);
        }
    }
}

/**
 * A watch lives on one machine. Two machines can hold the same path, so the
 * path alone cannot say whether a watch is already in place, nor whose change
 * event is whose.
 */
interface WatchedPath {
    backendId: string;
    path: string;
}

interface PendingMove {
    sourcePath: string;
    destinationDir: string;
}

interface FileStore {
    tree: FileNode | null;
    treePath: string | null;
    /** The machine that listed `tree`; its directories are fetched from there. */
    treeBackendId: string | null;
    gitignorePatterns: string[];
    gitStatus: GitStatusResult | null;
    gitStatusPath: string | null;
    watched: WatchedPath | null;
    loading: boolean;
    loadingDirs: Set<string>;
    expandedDirs: Set<string>;
    focusedPath: string | null;
    contextMenuPath: string | null;
    onOpenFile: ((path: string) => void) | null;
    dragOverPath: string | null;
    pendingMove: PendingMove | null;
    fetchTree(backendId: string, path: string): Promise<void>;
    fetchDir(dirPath: string): Promise<void>;
    fetchGitStatus(backendId: string, path: string): Promise<void>;
    /**
     * Holds a watch of `path` on `backendId` until the returned release is
     * called. Holders of one machine and path share a single backend watch.
     */
    retainWatch(backendId: string, path: string): () => void;
    /** The explorer's watch: its tree and git status follow this path's changes. */
    watchPath(backendId: string, path: string): void;
    unwatchPath(backendId: string, path: string): void;
    clearExplorerState(): void;
    /** The file's text and the hash a write's `expected` names it by. */
    readFile(backendId: string, path: string): Promise<FileDiskText>;
    /**
     * With `expected`, a file changed on disk since that hash is left alone
     * and the answer is a conflict; the caller must check it before treating
     * the save as done.
     */
    writeFile(
        backendId: string,
        path: string,
        content: string,
        expected?: string,
    ): Promise<FileWriteResponse>;
    renameFile(backendId: string, oldPath: string, newPath: string): Promise<void>;
    deleteFile(backendId: string, path: string): Promise<void>;
    createFile(backendId: string, path: string): Promise<void>;
    createDirectory(backendId: string, path: string): Promise<void>;
    openExternal(backendId: string, path: string): Promise<void>;
    revealInFinder(backendId: string, path: string): Promise<void>;
    expandToPathAndLoad(targetPath: string): Promise<void>;
    toggleDir(path: string): void;
    expandDir(path: string): Promise<void>;
    collapseDir(path: string): void;
    setFocusedPath(path: string | null): void;
    setContextMenuPath(path: string | null): void;
    setOnOpenFile(callback: ((path: string) => void) | null): void;
    setDragOverPath(path: string | null): void;
    setPendingMove(move: PendingMove): void;
    clearPendingMove(): void;
}

let fileChangeSubscriptionReady = false;
let fileChangeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const pendingRecursiveDirs = new Set<string>();
const pendingChangedDirs = new Set<string>();
/**
 * Directories asked for again while their listing was still being answered:
 * that listing may predate the change, so they are listed once more after it.
 */
const relistDirs = new Set<string>();
let diffStoreUnsubscribe: (() => void) | null = null;
let treeRequestId = 0;
function isWatchOf(watch: WatchedPath | null, backendId: string, path: string): boolean {
    return watch?.backendId === backendId && watch.path === path;
}

/**
 * One backend watch, counted by its holders. The backend keeps one watch per
 * client and path, so a second FILE_WATCH adds nothing and one FILE_UNWATCH
 * ends it for every holder: the count decides when either is sent.
 */
interface WatchEntry extends WatchedPath {
    count: number;
    /** The backend holds this watch for the current connection. */
    held: boolean;
    /** Bumped when the connection came back: an answer sent before says nothing about it. */
    epoch: number;
    syncing: boolean;
    /** Its machine was detached; holders still releasing it change nothing. */
    dropped: boolean;
}

const watches = new Map<string, WatchEntry>();

function watchKey(backendId: string, path: string): string {
    return JSON.stringify([backendId, path]);
}

/**
 * Brings the backend to what the count wants, one request at a time, and
 * checks again after each answer: a release while a watch is on its way is
 * sent once it lands, and a watch asked for while an unwatch is answered is
 * sent after it, so the backend never handles them out of order.
 */
async function syncWatch(entry: WatchEntry): Promise<void> {
    if (entry.syncing) return;
    entry.syncing = true;
    try {
        while (!entry.dropped && entry.count > 0 !== entry.held) {
            const epoch = entry.epoch;
            if (entry.count > 0) {
                const landed = await sendRequest(entry.backendId, MSG.FILE_WATCH, {
                    path: entry.path,
                }).then(
                    () => true,
                    () => false,
                );
                if (entry.dropped) return;
                // Sent over the connection that went away: send it again.
                if (epoch !== entry.epoch) continue;
                // Refused or unreachable: the next holder or reconnect asks again.
                if (!landed) return;
                entry.held = true;
            } else {
                entry.held = false;
                // A machine that cannot be reached has no watch left to release.
                await sendRequest(entry.backendId, MSG.FILE_UNWATCH, { path: entry.path }).catch(
                    () => {},
                );
            }
        }
    } finally {
        entry.syncing = false;
        const key = watchKey(entry.backendId, entry.path);
        if (entry.count === 0 && !entry.held && watches.get(key) === entry) watches.delete(key);
    }
}

function retainWatch(backendId: string, path: string): () => void {
    const key = watchKey(backendId, path);
    let entry = watches.get(key);
    if (!entry) {
        entry = {
            backendId,
            path,
            count: 0,
            held: false,
            epoch: 0,
            syncing: false,
            dropped: false,
        };
        watches.set(key, entry);
    }
    const counted = entry;
    counted.count += 1;
    void syncWatch(counted);
    let released = false;
    return () => {
        if (released || counted.dropped) return;
        released = true;
        counted.count -= 1;
        void syncWatch(counted);
    };
}

// A reconnected socket, or a restarted backend, holds no watches: ask again.
onBackendReady((backendId) => {
    for (const entry of watches.values()) {
        if (entry.backendId !== backendId || entry.count === 0) continue;
        entry.epoch += 1;
        entry.held = false;
        void syncWatch(entry);
    }
});

/** The explorer's hold on `watched`. */
let releaseExplorerWatch: (() => void) | null = null;

function stopFollowingDiffStats(): void {
    if (diffStoreUnsubscribe) {
        diffStoreUnsubscribe();
        diffStoreUnsubscribe = null;
    }
}
let gitStatusRequestId = 0;
/** The machine `gitStatus` came from: the same path on another machine is another repo. */
let gitStatusBackendId: string | null = null;

const emptyLoadingDirs = new Set<string>();

export const useFileStore = create<FileStore>((set, get) => ({
    tree: null,
    treePath: null,
    treeBackendId: null,
    gitignorePatterns: [],
    gitStatus: null,
    gitStatusPath: null,
    watched: null,
    loading: false,
    loadingDirs: emptyLoadingDirs,
    expandedDirs: new Set<string>(),
    focusedPath: null,
    contextMenuPath: null,
    onOpenFile: null,
    dragOverPath: null,
    pendingMove: null,
    async fetchTree(backendId, path) {
        const requestId = ++treeRequestId;
        set((state) => {
            const same = state.treePath === path && state.treeBackendId === backendId;
            return {
                loading: true,
                tree: same ? state.tree : null,
                treePath: same ? state.treePath : null,
                treeBackendId: same ? state.treeBackendId : null,
                gitignorePatterns: same ? state.gitignorePatterns : [],
                loadingDirs: emptyLoadingDirs,
            };
        });
        const { entries, gitignorePatterns } = await sendRequest<FileListDirResponse>(
            backendId,
            MSG.FILE_LIST_DIR,
            { path },
        );
        if (requestId !== treeRequestId) return;
        const rootNode: FileNode = {
            name: path.split("/").pop() ?? path,
            path,
            type: "directory",
            children: entries,
            loaded: true,
        };
        set({
            tree: rootNode,
            treePath: path,
            treeBackendId: backendId,
            gitignorePatterns,
            loading: false,
            expandedDirs: new Set([path]),
        });
    },
    async fetchDir(dirPath) {
        const backendId = get().treeBackendId;
        if (!backendId) return;
        if (get().loadingDirs.has(dirPath)) {
            relistDirs.add(dirPath);
            return;
        }
        const newLoading = new Set(get().loadingDirs);
        newLoading.add(dirPath);
        set({ loadingDirs: newLoading });
        try {
            const { entries } = await sendRequest<FileListDirResponse>(
                backendId,
                MSG.FILE_LIST_DIR,
                { path: dirPath },
            );
            set((state) => {
                // The explorer moved to another machine while this was answered.
                if (state.treeBackendId !== backendId) {
                    const updatedLoading = new Set(state.loadingDirs);
                    updatedLoading.delete(dirPath);
                    return { loadingDirs: updatedLoading };
                }
                const updatedLoading = new Set(state.loadingDirs);
                updatedLoading.delete(dirPath);
                const newTree = state.tree
                    ? setChildrenAtPath(state.tree, dirPath, entries)
                    : state.tree;
                return {
                    tree: newTree,
                    loadingDirs: updatedLoading,
                };
            });
            if (relistDirs.delete(dirPath) && get().treeBackendId === backendId) {
                await get().fetchDir(dirPath);
            }
        } catch {
            relistDirs.delete(dirPath);
            set((state) => {
                const updatedLoading = new Set(state.loadingDirs);
                updatedLoading.delete(dirPath);
                return { loadingDirs: updatedLoading };
            });
        }
    },
    async fetchGitStatus(backendId, path) {
        const requestId = ++gitStatusRequestId;
        const same = gitStatusBackendId === backendId;
        set((state) => ({
            gitStatus: same && state.gitStatusPath === path ? state.gitStatus : null,
            gitStatusPath: same && state.gitStatusPath === path ? state.gitStatusPath : null,
        }));
        const { status } = await sendRequest<GitStatusResponse>(backendId, MSG.GIT_STATUS, {
            path,
        });
        if (requestId !== gitStatusRequestId) return;
        gitStatusBackendId = backendId;
        set({ gitStatus: status, gitStatusPath: path });
    },
    retainWatch,
    watchPath(backendId, path) {
        if (isWatchOf(get().watched, backendId, path)) return;
        if (!fileChangeSubscriptionReady) {
            fileChangeSubscriptionReady = true;
            onEvent(MSG.FILE_CHANGED, (payload, fromBackendId) => {
                const event = payload as FileChangeEvent;
                const watched = get().watched;
                if (!watched || fromBackendId !== watched.backendId) return;
                const { backendId: watchedBackendId, path: watchedPath } = watched;
                if (!isSameOrChild(event.path, watchedPath)) return;
                if (event.recursive) {
                    pendingRecursiveDirs.add(event.path);
                    // The collapsed directory itself may be gone; its parent's listing shows that.
                    if (event.path !== watchedPath) {
                        pendingChangedDirs.add(
                            event.path.substring(0, event.path.lastIndexOf("/")),
                        );
                    }
                } else {
                    pendingChangedDirs.add(event.path.substring(0, event.path.lastIndexOf("/")));
                }
                if (fileChangeRefreshTimer) clearTimeout(fileChangeRefreshTimer);
                fileChangeRefreshTimer = setTimeout(() => {
                    const tree = get().tree;
                    if (tree) {
                        const dirs = new Set<string>();
                        for (const dir of pendingChangedDirs) {
                            if (isDirLoaded(tree, dir)) dirs.add(dir);
                        }
                        for (const dir of pendingRecursiveDirs) collectLoadedDirs(tree, dir, dirs);
                        for (const dir of dirs) get().fetchDir(dir).catch(console.error);
                    }
                    pendingChangedDirs.clear();
                    pendingRecursiveDirs.clear();
                    get().fetchGitStatus(watchedBackendId, watchedPath).catch(console.error);
                }, 150);
            });
        }
        // Released on the machine that holds it, which may not be the new one.
        releaseExplorerWatch?.();
        releaseExplorerWatch = retainWatch(backendId, path);
        diffStoreUnsubscribe ??= useDiffStore.subscribe((state, prevState) => {
            if (state.statsByProject !== prevState.statsByProject) {
                const watched = get().watched;
                if (watched) {
                    get().fetchGitStatus(watched.backendId, watched.path).catch(console.error);
                }
            }
        });
        set({ watched: { backendId, path } });
    },
    unwatchPath(backendId, path) {
        if (!isWatchOf(get().watched, backendId, path)) return;
        releaseExplorerWatch?.();
        releaseExplorerWatch = null;
        stopFollowingDiffStats();
        set({ watched: null });
    },
    clearExplorerState() {
        treeRequestId += 1;
        gitStatusRequestId += 1;
        gitStatusBackendId = null;
        set({
            tree: null,
            treePath: null,
            treeBackendId: null,
            gitignorePatterns: [],
            gitStatus: null,
            gitStatusPath: null,
            loading: false,
            loadingDirs: emptyLoadingDirs,
            expandedDirs: new Set<string>(),
            focusedPath: null,
            contextMenuPath: null,
        });
    },
    async expandToPathAndLoad(targetPath) {
        const treePath = get().treePath;
        if (!treePath) return;
        // A Windows backend lists the root's nodes with forward slashes while
        // the root keeps the spelling it was asked for (`C:\Repo`).
        const root = targetPath.startsWith(treePath) ? treePath : treePath.replace(/\\/g, "/");
        if (!targetPath.startsWith(root)) return;

        // Collect ancestor directories from root to target
        const dirsToLoad: string[] = [];
        let current = targetPath;
        while (current !== root && current.length > root.length) {
            const lastSlash = current.lastIndexOf("/");
            if (lastSlash <= 0) break;
            current = current.slice(0, lastSlash);
            if (current.length >= root.length) {
                dirsToLoad.unshift(current === root ? treePath : current);
            }
        }

        // Load directories sequentially (each depends on parent being in the tree)
        for (const dir of dirsToLoad) {
            const tree = get().tree;
            if (tree && !isDirLoaded(tree, dir)) {
                await get().fetchDir(dir);
            }
        }

        // After loading dirs, expand all ancestors + target
        const expandedDirs = new Set(get().expandedDirs);
        for (const dir of dirsToLoad) {
            expandedDirs.add(dir);
        }
        set({ expandedDirs });
    },
    async readFile(backendId, path) {
        const response = await sendRequest<FileDiskReadResponse>(backendId, MSG.FILE_READ, {
            path,
        });
        if (response.state) throw new FilePreviewError(response.state);
        return { content: response.content, hash: response.hash };
    },
    async writeFile(backendId, path, content, expected) {
        const result = await sendRequest<FileWriteResponse>(backendId, MSG.FILE_WRITE, {
            path,
            content,
            expected,
        });
        const watched = get().watched;
        if (result.success && watched?.backendId === backendId && path.startsWith(watched.path)) {
            await get().fetchGitStatus(backendId, watched.path);
        }
        return result;
    },
    async renameFile(backendId, oldPath, newPath) {
        await sendRequest(backendId, MSG.FILE_RENAME, { oldPath, newPath });
    },
    async deleteFile(backendId, path) {
        await sendRequest(backendId, MSG.FILE_DELETE_FILE, { path });
    },
    async createFile(backendId, path) {
        await sendRequest(backendId, MSG.FILE_CREATE, { path });
    },
    async createDirectory(backendId, path) {
        await sendRequest(backendId, MSG.FILE_MKDIR, { path });
    },
    async openExternal(backendId, path) {
        await sendRequest(backendId, MSG.FILE_OPEN_EXTERNAL, { path });
    },
    async revealInFinder(backendId, path) {
        await sendRequest(backendId, MSG.FILE_REVEAL, { path });
    },
    toggleDir(path) {
        const { expandedDirs } = get();
        const next = new Set(expandedDirs);
        if (next.has(path)) {
            next.delete(path);
        } else {
            next.add(path);
        }
        set({ expandedDirs: next });
        // If we just expanded and children aren't loaded, fetch them
        const tree = get().tree;
        if (next.has(path) && tree && !isDirLoaded(tree, path)) {
            void get().fetchDir(path);
        }
    },
    async expandDir(path) {
        const { expandedDirs } = get();
        if (expandedDirs.has(path)) return;
        const next = new Set(expandedDirs);
        next.add(path);
        set({ expandedDirs: next });
        const tree = get().tree;
        if (tree && !isDirLoaded(tree, path)) {
            await get().fetchDir(path);
        }
    },
    collapseDir(path) {
        const { expandedDirs } = get();
        if (!expandedDirs.has(path)) return;
        const next = new Set(expandedDirs);
        next.delete(path);
        set({ expandedDirs: next });
    },
    setFocusedPath(path) {
        set({ focusedPath: path });
    },
    setContextMenuPath(path) {
        set({ contextMenuPath: path });
    },
    setOnOpenFile(callback) {
        set({ onOpenFile: callback });
    },
    setDragOverPath(path) {
        set({ dragOverPath: path });
    },
    setPendingMove(move) {
        set({ pendingMove: move, dragOverPath: null });
    },
    clearPendingMove() {
        set({ pendingMove: null });
    },
}));

registerBackendReset("file-store", (backendId) => {
    // The connection is gone and its watches with it, so there is nothing to
    // unwatch, and a holder releasing one later must not touch a new count.
    for (const [key, entry] of watches) {
        if (entry.backendId !== backendId) continue;
        entry.dropped = true;
        watches.delete(key);
    }
    if (useFileStore.getState().watched?.backendId !== backendId) return;
    // The tree it listed belongs to a workspace that no longer exists.
    releaseExplorerWatch = null;
    stopFollowingDiffStats();
    if (fileChangeRefreshTimer) {
        clearTimeout(fileChangeRefreshTimer);
        fileChangeRefreshTimer = null;
    }
    pendingChangedDirs.clear();
    pendingRecursiveDirs.clear();
    useFileStore.setState({ watched: null });
    useFileStore.getState().clearExplorerState();
});
