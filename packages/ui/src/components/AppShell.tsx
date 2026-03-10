import { useMemo, type ReactNode } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { PanelLeftClose, PanelRightClose } from 'lucide-react';

interface AppShellProps {
  sidebar: ReactNode;
  fileExplorer: ReactNode;
  workspace: ReactNode;
  taskInfo: ReactNode;
}

export function AppShell({ sidebar, fileExplorer, workspace, taskInfo }: AppShellProps) {
  const {
    fileExplorerOpen,
    taskInfoOpen,
    sidebarWidth,
    toggleFileExplorer,
    toggleTaskInfo,
  } = useUIStore();

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
          <div className="flex items-center justify-end border-b border-border px-1.5 py-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleFileExplorer}
              aria-label="Collapse file explorer"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </Button>
          </div>
          {fileExplorer}
        </div>
      ) : (
        <div
          onClick={toggleFileExplorer}
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
          <div className="flex items-center justify-start border-b border-border px-1.5 py-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleTaskInfo}
              aria-label="Collapse task info"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </Button>
          </div>
          {taskInfo}
        </div>
      ) : (
        <div
          onClick={toggleTaskInfo}
          className={collapsedPanelClasses}
        >
          TASK
        </div>
      )}
    </div>
  );
}
