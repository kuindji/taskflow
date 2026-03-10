import type { Tab } from '@/stores/session-store';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { TerminalPane } from '@/components/panes/TerminalPane';
import { EditorPane } from '@/components/panes/EditorPane';
import { ChangesPane } from '@/components/panes/ChangesPane';
import { BrowserPane } from '@/components/panes/BrowserPane';
import { useTaskStore } from '@/stores/task-store';
import { useProjectStore } from '@/stores/project-store';

interface TabContentProps {
  tabs: Tab[];
  activeTabId: string;
}

function TabContent({ tabs, activeTabId }: TabContentProps) {
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const project = useProjectStore((s) => s.projects.find((p) => p.id === task?.projectId));

  if (tabs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        No active tab. Create a session with +
      </div>
    );
  }

  const workingDir = task?.worktree.enabled && task.worktree.path
    ? task.worktree.path : project?.path ?? '';

  return (
    <>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        let pane: React.ReactNode;
        let label: string;

        switch (tab.type) {
          case 'claude':
          case 'codex':
            label = `${tab.type} terminal`;
            // Terminal panes are always mounted but hidden when inactive
            // so PTY output is buffered and state is preserved across tab switches
            pane = tab.sessionId
              ? <TerminalPane sessionId={tab.sessionId} visible={isActive} />
              : <div className="p-3 text-muted-foreground">Session not found</div>;
            break;

          case 'editor':
            label = tab.filePath?.split('/').pop() ?? 'Editor';
            if (!isActive) return null;
            pane = tab.filePath
              ? <EditorPane filePath={tab.filePath} />
              : <div className="p-3 text-muted-foreground">No file specified</div>;
            break;

          case 'changes':
            label = 'Changes';
            if (!isActive) return null;
            pane = <ChangesPane repoPath={workingDir} />;
            break;

          case 'browser':
            label = 'Browser';
            if (!isActive) return null;
            pane = <BrowserPane initialUrl={tab.url ?? 'about:blank'} />;
            break;

          default:
            return null;
        }

        return (
          <ErrorBoundary key={tab.id} fallbackLabel={label}>
            <div style={{ display: isActive ? 'contents' : 'none' }}>
              {pane}
            </div>
          </ErrorBoundary>
        );
      })}
    </>
  );
}

export { TabContent };
