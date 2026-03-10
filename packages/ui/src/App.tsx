import { WebSocketProvider, useWsStatus } from '@/providers/WebSocketProvider';
import { AppShell } from '@/components/AppShell';
import { DialogHost } from '@/components/DialogHost';
import { TaskSidebar } from '@/components/sidebar/TaskSidebar';
import { Workspace } from '@/components/workspace/Workspace';
import { TooltipProvider } from '@/components/ui/tooltip';

function ConnectionOverlay() {
  const { connected, error } = useWsStatus();
  if (connected) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="text-center space-y-2">
        <div className="text-foreground text-sm font-medium">
          {error ? 'Connection Failed' : 'Connecting to backend...'}
        </div>
        {error && <div className="text-destructive text-xs">{error}</div>}
        {!error && (
          <div className="text-muted-foreground text-xs">Reconnecting...</div>
        )}
      </div>
    </div>
  );
}

export function App() {
  return (
    <WebSocketProvider>
      <ConnectionOverlay />
      <DialogHost />
      <TooltipProvider>
        <AppShell
          sidebar={<TaskSidebar />}
          fileExplorer={<div className="p-3 text-muted-foreground text-[11px]">File Explorer (coming in Chunk 7)</div>}
          workspace={<Workspace />}
          taskInfo={<div className="p-3 text-muted-foreground text-[11px]">Task Info (coming in Chunk 7)</div>}
        />
      </TooltipProvider>
    </WebSocketProvider>
  );
}
