import { create } from "zustand";
import type {
    FileNode,
    FileChangeEvent,
    FileListDirResponse,
    GitStatusResult,
    GitStatusResponse,
    FileReadResponse,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { onEvent, sendRequest } from "@/lib/connection-registry";
import { useDiffStore } from "./diff-store";
import { registerBackendReset } from "./store-reset";

function setChildrenAtPath(root: FileNode, targetPath: string, children: FileNode[]): FileNode {
    if (root.path === targetPath) {
        return { ...root, children, loaded: true };
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
    watchPath(backendId: string, path: string): Promise<void>;
    unwatchPath(backendId: string, path: string): Promise<void>;
    clearExplorerState(): void;
    readFile(backendId: string, path: string): Promise<string>;
    writeFile(backendId: string, path: string, content: string): Promise<void>;
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
let diffStoreUnsubscribe: (() => void) | null = null;
let treeRequestId = 0;
/** Bumped by every watch, unwatch and detach: a watch that lands late is not recorded. */
let watchGeneration = 0;
/** The newest watch asked for and not since unwatched or detached, landed or not. */
let requestedWatch: WatchedPath | null = null;

function isWatchOf(watch: WatchedPath | null, backendId: string, path: string): boolean {
    return watch?.backendId === backendId && watch.path === path;
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
        if (!backendId || get().loadingDirs.has(dirPath)) return;
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
        } catch {
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
    async watchPath(backendId, path) {
        const previous = get().watched;
        if (isWatchOf(previous, backendId, path)) return;
        const generation = ++watchGeneration;
        requestedWatch = { backendId, path };
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
        if (previous) {
            // Forgotten before it is released, so a move cancelled meanwhile
            // does not leave a watch recorded that the backend no longer holds.
            set({ watched: null });
            // Released on the machine that holds it, which may not be the new one.
            // A machine that cannot be reached has no watch left to release.
            await sendRequest(previous.backendId, MSG.FILE_UNWATCH, {
                path: previous.path,
            }).catch(() => {});
            if (generation !== watchGeneration) return;
        }
        if (diffStoreUnsubscribe) {
            diffStoreUnsubscribe();
            diffStoreUnsubscribe = null;
        }
        diffStoreUnsubscribe = useDiffStore.subscribe((state, prevState) => {
            if (state.statsByProject !== prevState.statsByProject) {
                const watched = get().watched;
                if (watched) {
                    get().fetchGitStatus(watched.backendId, watched.path).catch(console.error);
                }
            }
        });
        await sendRequest(backendId, MSG.FILE_WATCH, { path });
        if (generation !== watchGeneration) {
            // The backend holds this watch for us now. Release it unless a newer
            // request wants the same one: the backend keeps one per client and path.
            if (!isWatchOf(requestedWatch, backendId, path)) {
                await sendRequest(backendId, MSG.FILE_UNWATCH, { path }).catch(() => {});
            }
            return;
        }
        set({ watched: { backendId, path } });
    },
    async unwatchPath(backendId, path) {
        const watched = get().watched;
        if (!isWatchOf(watched, backendId, path)) {
            // Still on its way: let it land stale, and be released then.
            if (isWatchOf(requestedWatch, backendId, path)) {
                watchGeneration++;
                requestedWatch = null;
            }
            return;
        }
        watchGeneration++;
        if (isWatchOf(requestedWatch, backendId, path)) requestedWatch = null;
        if (diffStoreUnsubscribe) {
            diffStoreUnsubscribe();
            diffStoreUnsubscribe = null;
        }
        await sendRequest(backendId, MSG.FILE_UNWATCH, { path });
        // A watch that landed while this was answered is the newer one: keep it.
        if (isWatchOf(get().watched, backendId, path)) set({ watched: null });
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
        if (!treePath || !targetPath.startsWith(treePath)) return;

        // Collect ancestor directories from root to target
        const dirsToLoad: string[] = [];
        let current = targetPath;
        while (current !== treePath && current.length > treePath.length) {
            const lastSlash = current.lastIndexOf("/");
            if (lastSlash <= 0) break;
            current = current.slice(0, lastSlash);
            if (current.length >= treePath.length) {
                dirsToLoad.unshift(current);
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
        const { content } = await sendRequest<FileReadResponse>(backendId, MSG.FILE_READ, {
            path,
        });
        return content;
    },
    async writeFile(backendId, path, content) {
        await sendRequest(backendId, MSG.FILE_WRITE, { path, content });
        const watched = get().watched;
        if (watched?.backendId === backendId && path.startsWith(watched.path)) {
            await get().fetchGitStatus(backendId, watched.path);
        }
    },
    async renameFile(backendId, oldPath, newPath) {
        await sendRequest(backendId, MSG.FILE_RENAME, { oldPath, newPath });
    },
    async deleteFile(backendId, path) {
        await sendRequest(backendId, MSG.FILE_DELETE_FILE, { path });
    },
    async createFile(backendId, path) {
        await sendRequest(backendId, MSG.FILE_WRITE, { path, content: "" });
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
    if (requestedWatch?.backendId === backendId) {
        // Its connection is gone: a watch still on its way lands on nothing.
        watchGeneration++;
        requestedWatch = null;
    }
    if (useFileStore.getState().watched?.backendId !== backendId) return;
    // The connection is gone and its watches with it, so there is nothing to
    // unwatch; the tree it listed belongs to a workspace that no longer exists.
    watchGeneration++;
    if (diffStoreUnsubscribe) {
        diffStoreUnsubscribe();
        diffStoreUnsubscribe = null;
    }
    if (fileChangeRefreshTimer) {
        clearTimeout(fileChangeRefreshTimer);
        fileChangeRefreshTimer = null;
    }
    pendingChangedDirs.clear();
    pendingRecursiveDirs.clear();
    useFileStore.setState({ watched: null });
    useFileStore.getState().clearExplorerState();
});
