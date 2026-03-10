import { create } from 'zustand';
import { MSG } from '@taskflow/shared';
import { sendRequest, sendFireAndForget } from '../hooks/useWebSocket';
import { useTaskStore } from './task-store';

interface Tab {
  id: string;
  type: 'claude' | 'codex' | 'editor' | 'changes' | 'browser';
  label: string;
  sessionId?: string;
  filePath?: string;
  url?: string;
}

interface SessionStore {
  tabsByTask: Record<string, Tab[]>;
  activeTabByTask: Record<string, string>;
  createSession(taskId: string, type: 'claude' | 'codex', label?: string): Promise<string>;
  closeSession(sessionId: string): Promise<void>;
  sendInput(sessionId: string, data: string): void;
  resizeTerminal(sessionId: string, cols: number, rows: number): void;
  addTab(taskId: string, tab: Tab): void;
  closeTab(taskId: string, tabId: string): Promise<void>;
  setActiveTab(taskId: string, tabId: string): void;
  getTabs(taskId: string): Tab[];
  getActiveTab(taskId: string): Tab | undefined;
}

export type { Tab };

export const useSessionStore = create<SessionStore>((set, get) => ({
  tabsByTask: {},
  activeTabByTask: {},
  async createSession(taskId, type, label) {
    const { sessionId } = await sendRequest<{ sessionId: string }>(MSG.SESSION_CREATE, { taskId, type, label });
    const tab: Tab = { id: sessionId, type, label: label ?? `${type} session`, sessionId };
    get().addTab(taskId, tab);
    await useTaskStore.getState().fetchTasks();
    return sessionId;
  },
  async closeSession(sessionId) {
    await sendRequest(MSG.SESSION_CLOSE, { sessionId });
    await useTaskStore.getState().fetchTasks();
  },
  sendInput(sessionId, data) { sendFireAndForget(MSG.SESSION_INPUT, { sessionId, data }); },
  resizeTerminal(sessionId, cols, rows) { sendFireAndForget(MSG.TERMINAL_RESIZE, { sessionId, cols, rows }); },
  addTab(taskId, tab) {
    set((s) => ({
      tabsByTask: { ...s.tabsByTask, [taskId]: [...(s.tabsByTask[taskId] ?? []), tab] },
      activeTabByTask: { ...s.activeTabByTask, [taskId]: tab.id },
    }));
  },
  async closeTab(taskId, tabId) {
    const tab = (get().tabsByTask[taskId] ?? []).find((entry) => entry.id === tabId);
    if (tab?.sessionId) {
      await get().closeSession(tab.sessionId);
    }
    set((s) => {
      const tabs = (s.tabsByTask[taskId] ?? []).filter((t) => t.id !== tabId);
      const activeId = s.activeTabByTask[taskId] === tabId ? tabs[tabs.length - 1]?.id ?? '' : s.activeTabByTask[taskId];
      return { tabsByTask: { ...s.tabsByTask, [taskId]: tabs }, activeTabByTask: { ...s.activeTabByTask, [taskId]: activeId } };
    });
  },
  setActiveTab(taskId, tabId) { set((s) => ({ activeTabByTask: { ...s.activeTabByTask, [taskId]: tabId } })); },
  getTabs(taskId) { return get().tabsByTask[taskId] ?? []; },
  getActiveTab(taskId) {
    const tabs = get().getTabs(taskId);
    return tabs.find((t) => t.id === get().activeTabByTask[taskId]);
  },
}));
