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
import { onEvent, sendRequest } from "../hooks/useWebSocket";
import { useDiffStore } from "./diff-store";

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

interface PendingMove {
    sourcePath: string;
    destinationDir: string;
}

interface FileStore {
    tree: FileNode | null;
    treePath: string | null;
    gitignorePatterns: string[];
    gitStatus: GitStatusResult | null;
    gitStatusPath: string | null;
    watchedPath: string | null;
    loading: boolean;
    loadingDirs: Set<string>;
    expandedDirs: Set<string>;
    focusedPath: string | null;
    contextMenuPath: string | null;
    onOpenFile: ((path: string) => void) | null;
    dragOverPath: string | null;
    pendingMove: PendingMove | null;
    fetchTree(path: string): Promise<void>;
    fetchDir(dirPath: string): Promise<void>;
    fetchGitStatus(path: string): Promise<void>;
    watchPath(path: string): Promise<void>;
    unwatchPath(path: string): Promise<void>;
    clearExplorerState(): void;
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    renameFile(oldPath: string, newPath: string): Promise<void>;
    deleteFile(path: string): Promise<void>;
    createFile(path: string): Promise<void>;
    createDirectory(path: string): Promise<void>;
    openExternal(path: string): Promise<void>;
    revealInFinder(path: string): Promise<void>;
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
const pendingChangedDirs = new Set<string>();
let diffStoreUnsubscribe: (() => void) | null = null;
let treeRequestId = 0;
let gitStatusRequestId = 0;

const emptyLoadingDirs = new Set<string>();

export const useFileStore = create<FileStore>((set, get) => ({
    tree: null,
    treePath: null,
    gitignorePatterns: [],
    gitStatus: null,
    gitStatusPath: null,
    watchedPath: null,
    loading: false,
    loadingDirs: emptyLoadingDirs,
    expandedDirs: new Set<string>(),
    focusedPath: null,
    contextMenuPath: null,
    onOpenFile: null,
    dragOverPath: null,
    pendingMove: null,
    async fetchTree(path) {
        const requestId = ++treeRequestId;
        set((state) => ({
            loading: true,
            tree: state.treePath === path ? state.tree : null,
            treePath: state.treePath === path ? state.treePath : null,
            gitignorePatterns: state.treePath === path ? state.gitignorePatterns : [],
            loadingDirs: emptyLoadingDirs,
        }));
        const { entries, gitignorePatterns } = await sendRequest<FileListDirResponse>(
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
            gitignorePatterns,
            loading: false,
            expandedDirs: new Set([path]),
        });
    },
    async fetchDir(dirPath) {
        if (get().loadingDirs.has(dirPath)) return;
        const newLoading = new Set(get().loadingDirs);
        newLoading.add(dirPath);
        set({ loadingDirs: newLoading });
        try {
            const { entries } = await sendRequest<FileListDirResponse>(MSG.FILE_LIST_DIR, {
                path: dirPath,
            });
            set((state) => {
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
    async fetchGitStatus(path) {
        const requestId = ++gitStatusRequestId;
        set((state) => ({
            gitStatus: state.gitStatusPath === path ? state.gitStatus : null,
            gitStatusPath: state.gitStatusPath === path ? state.gitStatusPath : null,
        }));
        const { status } = await sendRequest<GitStatusResponse>(MSG.GIT_STATUS, { path });
        if (requestId !== gitStatusRequestId) return;
        set({ gitStatus: status, gitStatusPath: path });
    },
    async watchPath(path) {
        const previousPath = get().watchedPath;
        if (previousPath === path) return;
        if (!fileChangeSubscriptionReady) {
            fileChangeSubscriptionReady = true;
            onEvent(MSG.FILE_CHANGED, (payload) => {
                const event = payload as FileChangeEvent;
                const watchedPath = get().watchedPath;
                if (!watchedPath || !event.path.startsWith(watchedPath)) return;
                const parentDir = event.path.substring(0, event.path.lastIndexOf("/"));
                pendingChangedDirs.add(parentDir);
                if (fileChangeRefreshTimer) clearTimeout(fileChangeRefreshTimer);
                fileChangeRefreshTimer = setTimeout(() => {
                    const tree = get().tree;
                    for (const dir of pendingChangedDirs) {
                        if (tree && isDirLoaded(tree, dir)) {
                            get().fetchDir(dir).catch(console.error);
                        }
                    }
                    pendingChangedDirs.clear();
                    get().fetchGitStatus(watchedPath).catch(console.error);
                }, 150);
            });
        }
        if (previousPath) {
            await sendRequest(MSG.FILE_UNWATCH, { path: previousPath });
            set({ watchedPath: null });
        }
        if (diffStoreUnsubscribe) {
            diffStoreUnsubscribe();
            diffStoreUnsubscribe = null;
        }
        diffStoreUnsubscribe = useDiffStore.subscribe((state, prevState) => {
            if (state.statsByProject !== prevState.statsByProject) {
                const watchedPath = get().watchedPath;
                if (watchedPath) {
                    get().fetchGitStatus(watchedPath).catch(console.error);
                }
            }
        });
        await sendRequest(MSG.FILE_WATCH, { path });
        set({ watchedPath: path });
    },
    async unwatchPath(path) {
        if (get().watchedPath !== path) return;
        if (diffStoreUnsubscribe) {
            diffStoreUnsubscribe();
            diffStoreUnsubscribe = null;
        }
        await sendRequest(MSG.FILE_UNWATCH, { path });
        set({ watchedPath: null });
    },
    clearExplorerState() {
        treeRequestId += 1;
        gitStatusRequestId += 1;
        set({
            tree: null,
            treePath: null,
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
    async readFile(path) {
        const { content } = await sendRequest<FileReadResponse>(MSG.FILE_READ, { path });
        return content;
    },
    async writeFile(path, content) {
        await sendRequest(MSG.FILE_WRITE, { path, content });
        const watchedPath = get().watchedPath;
        if (watchedPath && path.startsWith(watchedPath)) await get().fetchGitStatus(watchedPath);
    },
    async renameFile(oldPath, newPath) {
        await sendRequest(MSG.FILE_RENAME, { oldPath, newPath });
    },
    async deleteFile(path) {
        await sendRequest(MSG.FILE_DELETE_FILE, { path });
    },
    async createFile(path) {
        await sendRequest(MSG.FILE_WRITE, { path, content: "" });
    },
    async createDirectory(path) {
        await sendRequest(MSG.FILE_MKDIR, { path });
    },
    async openExternal(path) {
        await sendRequest(MSG.FILE_OPEN_EXTERNAL, { path });
    },
    async revealInFinder(path) {
        await sendRequest(MSG.FILE_REVEAL, { path });
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
