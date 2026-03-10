import { useMemo, type ReactNode } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface AppShellProps {
  sidebar: ReactNode;
  fileExplorer: ReactNode;
  workspace: ReactNode;
  taskInfo: ReactNode;
}

export function AppShell({ sidebar, fileExplorer, workspace, taskInfo }: AppShellProps) {
  const { fileExplorerOpen, taskInfoOpen, sidebarWidth } = useUIStore();

  const collapsedPanelClasses = useMemo(
    () => cn(
      'w-6 bg-card flex items-center justify-center',
      'cursor-pointer [writing-mode:vertical-rl]',
      'text-[9px] text-muted-foreground tracking-widest select-none',
      'hover:bg-muted/50 transition-colors',
    ),
    [],
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <div
        className="min-w-[180px] max-w-[350px] bg-card flex flex-col"
        style={{ width: sidebarWidth }}
      >
        {sidebar}
      </div>

      <Separator orientation="vertical" />

      {fileExplorerOpen ? (
        <div className="w-[220px] bg-card flex flex-col">
          {fileExplorer}
        </div>
      ) : (
        <div
          onClick={() => useUIStore.getState().toggleFileExplorer()}
          className={cn(collapsedPanelClasses, 'rotate-180')}
        >
          FILES
        </div>
      )}

      <Separator orientation="vertical" />

      <div className="flex-1 flex flex-col overflow-hidden">{workspace}</div>

      <Separator orientation="vertical" />

      {taskInfoOpen ? (
        <div className="w-[220px] bg-card flex flex-col">
          {taskInfo}
        </div>
      ) : (
        <div
          onClick={() => useUIStore.getState().toggleTaskInfo()}
          className={collapsedPanelClasses}
        >
          TASK
        </div>
      )}
    </div>
  );
}
