import { create } from 'zustand';
import type { FileNode, GitStatusResult, FileChangeEvent } from '@taskflow/shared';
import { MSG } from '@taskflow/shared';
import { onEvent, sendRequest } from '../hooks/useWebSocket';

interface FileStore {
  tree: FileNode | null;
  gitStatus: GitStatusResult | null;
  watchedPath: string | null;
  loading: boolean;
  fetchTree(path: string): Promise<void>;
  fetchGitStatus(path: string): Promise<void>;
  watchPath(path: string): Promise<void>;
  unwatchPath(path: string): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

let fileChangeSubscriptionReady = false;
let fileChangeRefreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useFileStore = create<FileStore>((set, get) => ({
  tree: null, gitStatus: null, watchedPath: null, loading: false,
  async fetchTree(path) {
    set({ loading: true });
    const { tree } = await sendRequest<{ tree: FileNode }>(MSG.FILE_TREE, { path });
    set({ tree, loading: false });
  },
  async fetchGitStatus(path) {
    const { status } = await sendRequest<{ status: GitStatusResult }>(MSG.GIT_STATUS, { path });
    set({ gitStatus: status });
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
  async readFile(path) {
    const { content } = await sendRequest<{ content: string }>(MSG.FILE_READ, { path });
    return content;
  },
  async writeFile(path, content) {
    await sendRequest(MSG.FILE_WRITE, { path, content });
    const watchedPath = get().watchedPath;
    if (watchedPath && path.startsWith(watchedPath)) await get().fetchGitStatus(watchedPath);
  },
}));
