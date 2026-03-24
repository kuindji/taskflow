import { useEffect, useMemo, useRef } from "react";
import { WebSocketProvider } from "@/providers/WebSocketProvider";
import { useWsStatus } from "@/providers/ws-context";
import { useSettingsStore } from "@/stores/settings-store";
import { useTheme } from "@/hooks/useTheme";
import { useUIStore } from "@/stores/ui-store";
import "@/lib/monaco-theme"; // Ensure module-level defineTheme runs
import { AppShell } from "@/components/AppShell";
import { AgentOperationsHelpDialog } from "@/components/AgentOperationsHelpDialog";
import { DialogHost } from "@/components/DialogHost";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { FlowManagementDialog } from "@/components/flows/FlowManagementDialog";
import { ScheduleManagementDialog } from "@/components/schedules/ScheduleManagementDialog";
import { AppearanceDialog } from "@/components/appearance/AppearanceDialog";
import { TaskCreationDialogHost } from "@/components/sidebar/TaskCreationDialogHost";
import { TaskSidebar } from "@/components/sidebar/TaskSidebar";
import { FileExplorer } from "@/components/panels/FileExplorer";
import { TaskInfoPanel } from "@/components/panels/TaskInfoPanel";
import { FlowPanel } from "@/components/flows/FlowPanel";
import { Workspace } from "@/components/workspace/Workspace";
import { useTaskStore } from "@/stores/task-store";
import { useFlowStore } from "@/stores/flow-store";
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
    useTheme();
    const general = useSettingsStore((s) => s.settings?.general);
    const fileExplorerOpen = useUIStore((s) => s.fileExplorerOpen);
    const taskInfoOpen = useUIStore((s) => s.taskInfoOpen);
    const rootStyle = useMemo(
        () =>
            general
                ? ({
                      fontFamily: general.fontFamily,
                      fontSize: general.fontSize,
                  } as React.CSSProperties)
                : undefined,
        [general],
    );

    useEffect(() => {
        const cleanup = window.taskflow?.onToggleFileExplorer(() => {
            useUIStore.getState().toggleFileExplorer();
        });
        return cleanup;
    }, []);

    useEffect(() => {
        window.taskflow?.sendFileExplorerState(fileExplorerOpen);
    }, [fileExplorerOpen]);

    useEffect(() => {
        const cleanup = window.taskflow?.onToggleTaskInfo(() => {
            useUIStore.getState().toggleTaskInfo();
        });
        return cleanup;
    }, []);

    useEffect(() => {
        window.taskflow?.sendTaskInfoState(taskInfoOpen);
    }, [taskInfoOpen]);

    const activeTaskId = useTaskStore((s) => s.activeTaskId);
    const activeProjectId = useUIStore((s) => s.activeProjectId);
    const activeOwnerId = activeTaskId ?? activeProjectId;
    const activeFlowRun = useFlowStore((s) =>
        activeOwnerId ? s.activeRuns[activeOwnerId] : undefined,
    );
    const flowPanelOpen = useUIStore((s) => s.flowPanelOpen);

    // Auto-open flow panel when a flow run appears
    const prevFlowRunId = useRef<string | undefined>(undefined);
    useEffect(() => {
        const runId = activeFlowRun?.flowId;
        if (runId && runId !== prevFlowRunId.current) {
            useUIStore.getState().setFlowPanelOpen(true);
        }
        prevFlowRunId.current = runId;
    }, [activeFlowRun?.flowId]);

    const wordWrap = useSettingsStore((s) => s.settings?.editor?.wordWrap);
    const updateSettings = useSettingsStore((s) => s.updateSettings);

    useEffect(() => {
        const cleanup = window.taskflow?.onToggleWordWrap(() => {
            const current = useSettingsStore.getState().settings?.editor?.wordWrap ?? true;
            void updateSettings({ editor: { wordWrap: !current } });
        });
        return cleanup;
    }, [updateSettings]);

    useEffect(() => {
        if (wordWrap != null) {
            window.taskflow?.sendWordWrapState(wordWrap);
        }
    }, [wordWrap]);

    // Prevent Electron/browser default file-drop navigation globally.
    // Individual components (e.g. TerminalPane) opt-in to handle drops.
    useEffect(() => {
        function prevent(e: DragEvent) {
            e.preventDefault();
        }
        document.addEventListener("dragover", prevent);
        document.addEventListener("drop", prevent);
        return () => {
            document.removeEventListener("dragover", prevent);
            document.removeEventListener("drop", prevent);
        };
    }, []);

    return (
        <WebSocketProvider>
            <div style={rootStyle} className="contents">
                <ConnectionOverlay />
                <DialogHost />
                <AgentOperationsHelpDialog />
                <KeyboardShortcutsDialog />
                <SettingsModal />
                <FlowManagementDialog />
                <ScheduleManagementDialog />
                <AppearanceDialog />
                <TaskCreationDialogHost />
                <TooltipProvider>
                    <AppShell
                        sidebar={<TaskSidebar />}
                        fileExplorer={<FileExplorer />}
                        flowPanel={
                            flowPanelOpen && activeFlowRun && activeOwnerId ? (
                                <FlowPanel
                                    ownerId={activeOwnerId}
                                    onClose={() => useUIStore.getState().setFlowPanelOpen(false)}
                                />
                            ) : undefined
                        }
                        workspace={<Workspace />}
                        taskInfo={<TaskInfoPanel />}
                    />
                </TooltipProvider>
            </div>
        </WebSocketProvider>
    );
}
