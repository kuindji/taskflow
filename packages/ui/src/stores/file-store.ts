import { create } from "zustand";
import type {
    FileNode,
    GitStatusResult,
    FileChangeEvent,
    FileListDirResponse,
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

interface FileStore {
    tree: FileNode | null;
    treePath: string | null;
    gitignorePatterns: string[];
    gitStatus: GitStatusResult | null;
    gitStatusPath: string | null;
    watchedPath: string | null;
    loading: boolean;
    loadingDirs: Set<string>;
    expandToPath: string | null;
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
    setExpandToPath(path: string | null): void;
    expandToPathAndLoad(targetPath: string): Promise<void>;
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
    expandToPath: null,
    setExpandToPath(path) {
        set({ expandToPath: path });
    },
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
        set({ tree: rootNode, treePath: path, gitignorePatterns, loading: false });
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
        const { status } = await sendRequest<{ status: GitStatusResult }>(MSG.GIT_STATUS, { path });
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

        // Set expandToPath after all directories are loaded so the UI can latch them open
        set({ expandToPath: targetPath });
    },
    async readFile(path) {
        const { content } = await sendRequest<{ content: string }>(MSG.FILE_READ, { path });
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
}));
