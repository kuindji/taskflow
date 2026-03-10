import { useTaskStore } from '@/stores/task-store';
import { useProjectStore } from '@/stores/project-store';
import { useSessionStore } from '@/stores/session-store';
import { TaskHeader } from './TaskHeader';
import { TabBar } from './TabBar';
import { TabContent } from './TabContent';

export function Workspace() {
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const project = useProjectStore((s) => s.projects.find((p) => p.id === task?.projectId));
  const { getTabs, getActiveTab, setActiveTab, closeTab, createSession, addTab } = useSessionStore();

  if (!task) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Select a task from the sidebar</div>;
  }

  const tabs = getTabs(task.id);
  const activeTab = getActiveTab(task.id);

  const handleNewTab = async (type: 'claude' | 'codex' | 'changes' | 'browser') => {
    if (type === 'browser') {
      addTab(task.id, { id: crypto.randomUUID(), type: 'browser', label: 'New Tab', url: 'about:blank' });
    } else if (type === 'changes') {
      const existingChangesTab = tabs.find((tab) => tab.type === 'changes');
      if (existingChangesTab) {
        setActiveTab(task.id, existingChangesTab.id);
        return;
      }
      addTab(task.id, { id: crypto.randomUUID(), type: 'changes', label: 'Changes' });
    } else {
      await createSession(task.id, type);
    }
  };

  return (
    <>
      <TaskHeader task={task} project={project} />
      <TabBar tabs={tabs} activeTabId={activeTab?.id ?? ''} onTabClick={(id) => setActiveTab(task.id, id)} onTabClose={(id) => { void closeTab(task.id, id); }} onNewTab={handleNewTab} />
      <TabContent tabs={tabs} activeTabId={activeTab?.id ?? ''} />
    </>
  );
}
