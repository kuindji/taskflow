import { WebSocketProvider, useWsStatus } from '@/providers/WebSocketProvider';
import { AppShell } from '@/components/AppShell';
import { DialogHost } from '@/components/DialogHost';

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
      <AppShell
        sidebar={<div className="p-3 text-muted-foreground">Task Sidebar</div>}
        fileExplorer={<div className="p-3 text-muted-foreground">File Explorer</div>}
        workspace={<div className="p-3 text-muted-foreground">Workspace</div>}
        taskInfo={<div className="p-3 text-muted-foreground">Task Info</div>}
      />
    </WebSocketProvider>
  );
}
