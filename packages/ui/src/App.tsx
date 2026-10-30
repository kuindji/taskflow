import { useEffect, useMemo, useRef } from "react";
import { WebSocketProvider } from "@/providers/WebSocketProvider";
import { ConnectionOverlay } from "@/components/ConnectionOverlay";
import { useSettingsStore } from "@/stores/settings-store";
import { useTheme } from "@/hooks/useTheme";
import { useUIStore } from "@/stores/ui-store";
import "@/lib/monaco-theme"; // Ensure module-level defineTheme runs
import { AppShell } from "@/components/AppShell";
import { AgentOperationsHelpDialog } from "@/components/AgentOperationsHelpDialog";
import { DialogHost } from "@/components/DialogHost";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { CommandPaletteDialog } from "@/components/CommandPaletteDialog";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { FlowManagementDialog } from "@/components/flows/FlowManagementDialog";
import { ScheduleManagementDialog } from "@/components/schedules/ScheduleManagementDialog";
import { AppearanceDialog } from "@/components/appearance/AppearanceDialog";
import { TaskCreationDialogHost } from "@/components/sidebar/TaskCreationDialogHost";
import { TaskSidebar } from "@/components/sidebar/TaskSidebar";
import { FileExplorer } from "@/components/panels/FileExplorer";
import { SearchPanel } from "@/components/panels/SearchPanel";
import { WikiPanel } from "@/components/panels/WikiPanel";
import { TaskInfoPanel } from "@/components/panels/TaskInfoPanel";
import { FlowPanel } from "@/components/flows/FlowPanel";
import { Workspace } from "@/components/workspace/Workspace";
import { useBackendStore } from "@/stores/backend-store";
import { useTaskStore } from "@/stores/task-store";
import { useFlowStore } from "@/stores/flow-store";
import { TooltipProvider } from "@/components/ui/tooltip";

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
    const shellKey = useBackendStore((s) => s.shellKey);

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
                <CommandPaletteDialog />
                <SettingsModal />
                <FlowManagementDialog />
                <ScheduleManagementDialog />
                <AppearanceDialog />
                <TaskCreationDialogHost />
                <TooltipProvider>
                    <AppShell
                        key={shellKey}
                        sidebar={<TaskSidebar />}
                        fileExplorer={<FileExplorer />}
                        searchPanel={<SearchPanel />}
                        wikiPanel={<WikiPanel />}
                        flowPanel={
                            flowPanelOpen && activeFlowRun && activeOwnerId ? (
                                <FlowPanel
                                    ownerId={activeOwnerId}
                                    backendId={activeFlowRun.backendId}
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
