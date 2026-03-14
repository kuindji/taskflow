import { create } from "zustand";
import type { FileNode, GitStatusResult, FileChangeEvent, FileTreeResponse } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { onEvent, sendRequest } from "../hooks/useWebSocket";

interface FileStore {
    tree: FileNode | null;
    treePath: string | null;
    gitignorePatterns: string[];
    gitStatus: GitStatusResult | null;
    gitStatusPath: string | null;
    watchedPath: string | null;
    loading: boolean;
    expandToPath: string | null;
    fetchTree(path: string): Promise<void>;
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
}

let fileChangeSubscriptionReady = false;
let fileChangeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let treeRequestId = 0;
let gitStatusRequestId = 0;

export const useFileStore = create<FileStore>((set, get) => ({
    tree: null,
    treePath: null,
    gitignorePatterns: [],
    gitStatus: null,
    gitStatusPath: null,
    watchedPath: null,
    loading: false,
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
        }));
        const { tree, gitignorePatterns } = await sendRequest<FileTreeResponse>(MSG.FILE_TREE, { path });
        if (requestId !== treeRequestId) return;
        set({ tree, treePath: path, gitignorePatterns, loading: false });
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
                if (fileChangeRefreshTimer) clearTimeout(fileChangeRefreshTimer);
                fileChangeRefreshTimer = setTimeout(() => {
                    get().fetchTree(watchedPath).catch(console.error);
                    get().fetchGitStatus(watchedPath).catch(console.error);
                }, 150);
            });
        }
        if (previousPath) {
            await sendRequest(MSG.FILE_UNWATCH, { path: previousPath });
            set({ watchedPath: null });
        }
        await sendRequest(MSG.FILE_WATCH, { path });
        set({ watchedPath: path });
    },
    async unwatchPath(path) {
        if (get().watchedPath !== path) return;
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
        });
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
