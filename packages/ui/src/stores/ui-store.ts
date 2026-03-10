import { create } from 'zustand';

interface UIStore {
  fileExplorerOpen: boolean;
  taskInfoOpen: boolean;
  sidebarWidth: number;
  toggleFileExplorer(): void;
  toggleTaskInfo(): void;
  setSidebarWidth(width: number): void;
}

export const useUIStore = create<UIStore>((set) => ({
  fileExplorerOpen: false,
  taskInfoOpen: false,
  sidebarWidth: 220,
  toggleFileExplorer() { set((s) => ({ fileExplorerOpen: !s.fileExplorerOpen })); },
  toggleTaskInfo() { set((s) => ({ taskInfoOpen: !s.taskInfoOpen })); },
  setSidebarWidth(width) { set({ sidebarWidth: width }); },
}));
