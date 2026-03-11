import { WebSocketProvider } from "@/providers/WebSocketProvider";
import { useWsStatus } from "@/providers/ws-context";
import { AppShell } from "@/components/AppShell";
import { DialogHost } from "@/components/DialogHost";
import { TaskSidebar } from "@/components/sidebar/TaskSidebar";
import { FileExplorer } from "@/components/panels/FileExplorer";
import { TaskInfoPanel } from "@/components/panels/TaskInfoPanel";
import { Workspace } from "@/components/workspace/Workspace";
import { TooltipProvider } from "@/components/ui/tooltip";

function ConnectionOverlay() {
    const { connected, error } = useWsStatus();
    if (connected) return null;
    return (
        <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
            <div className="space-y-2 text-center">
                <div className="text-foreground text-sm font-medium">
                    {error ? "Connection Failed" : "Connecting to backend..."}
                </div>
                {error && <div className="text-destructive text-xs">{error}</div>}
                {!error && <div className="text-muted-foreground text-xs">Reconnecting...</div>}
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
                    fileExplorer={<FileExplorer />}
                    workspace={<Workspace />}
                    taskInfo={<TaskInfoPanel />}
                />
            </TooltipProvider>
        </WebSocketProvider>
    );
}
