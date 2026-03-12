import { useCallback, type ReactNode } from "react";
import { useUIStore } from "@/stores/ui-store";
import { useSettingsStore } from "@/stores/settings-store";
import { ResizeHandle } from "@/components/ResizeHandle";
import useIsElectron from "@/hooks/useIsElectron";

interface AppShellProps {
    sidebar: ReactNode;
    fileExplorer: ReactNode;
    workspace: ReactNode;
    taskInfo: ReactNode;
}

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 350;
const FILE_EXPLORER_MIN = 150;
const FILE_EXPLORER_MAX = 500;
const TASK_INFO_MIN = 150;
const TASK_INFO_MAX = 500;

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export function AppShell({ sidebar, fileExplorer, workspace, taskInfo }: AppShellProps) {
    const fileExplorerOpen = useUIStore((s) => s.fileExplorerOpen);
    const taskInfoOpen = useUIStore((s) => s.taskInfoOpen);
    const sidebarWidth = useUIStore((s) => s.sidebarWidth);
    const fileExplorerWidth = useUIStore((s) => s.fileExplorerWidth);
    const taskInfoWidth = useUIStore((s) => s.taskInfoWidth);
    const panelGap = useUIStore((s) => s.panelGap);
    const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
    const setFileExplorerWidth = useUIStore((s) => s.setFileExplorerWidth);
    const setTaskInfoWidth = useUIStore((s) => s.setTaskInfoWidth);
    const updateSettings = useSettingsStore((s) => s.updateSettings);
    const innerPanelGap = Math.max(panelGap - 1, 0);

    const handleSidebarResize = useCallback(
        (delta: number) => {
            const current = useUIStore.getState().sidebarWidth;
            setSidebarWidth(clamp(current + delta, SIDEBAR_MIN, SIDEBAR_MAX));
        },
        [setSidebarWidth],
    );

    const handleFileExplorerResize = useCallback(
        (delta: number) => {
            const current = useUIStore.getState().fileExplorerWidth;
            setFileExplorerWidth(clamp(current + delta, FILE_EXPLORER_MIN, FILE_EXPLORER_MAX));
        },
        [setFileExplorerWidth],
    );

    const handleTaskInfoResize = useCallback(
        (delta: number) => {
            const current = useUIStore.getState().taskInfoWidth;
            setTaskInfoWidth(clamp(current - delta, TASK_INFO_MIN, TASK_INFO_MAX));
        },
        [setTaskInfoWidth],
    );

    const handleResizeEnd = useCallback(() => {
        const { sidebarWidth, fileExplorerWidth, taskInfoWidth } = useUIStore.getState();
        void updateSettings({
            layout: { panels: { sidebarWidth, fileExplorerWidth, taskInfoWidth } },
        });
    }, [updateSettings]);

    const isElectron = useIsElectron();

    return (
        <div className="bg-island-base flex h-screen flex-col overflow-hidden">
            <div className="flex flex-1 overflow-hidden" style={{ padding: panelGap }}>
                <div
                    className="bg-card flex shrink-0 flex-col overflow-hidden rounded-[var(--window-radius)] border border-border/50 shadow-lg shadow-black/20"
                    style={{
                        width: sidebarWidth,
                        ...(isElectron ? { WebkitAppRegion: "drag" } as React.CSSProperties : {}),
                    }}
                >
                    {sidebar}
                </div>

                <ResizeHandle
                    onResize={handleSidebarResize}
                    onResizeEnd={handleResizeEnd}
                    panelGap={innerPanelGap}
                />

                {fileExplorerOpen && (
                    <div
                        className="bg-card flex shrink-0 flex-col overflow-hidden rounded-[var(--window-radius)] border border-border/50 shadow-lg shadow-black/20"
                        style={{ width: fileExplorerWidth }}
                    >
                        {fileExplorer}
                    </div>
                )}

                {fileExplorerOpen && (
                    <ResizeHandle
                        onResize={handleFileExplorerResize}
                        onResizeEnd={handleResizeEnd}
                        panelGap={innerPanelGap}
                    />
                )}

                <div className="bg-card flex flex-1 flex-col overflow-hidden rounded-[var(--window-radius)] border border-border/50 shadow-lg shadow-black/20">
                    {workspace}
                </div>

                {taskInfoOpen && (
                    <ResizeHandle
                        onResize={handleTaskInfoResize}
                        onResizeEnd={handleResizeEnd}
                        panelGap={innerPanelGap}
                    />
                )}

                {taskInfoOpen && (
                    <div
                        className="bg-card flex shrink-0 flex-col overflow-hidden rounded-[var(--window-radius)] border border-border/50 shadow-lg shadow-black/20"
                        style={{ width: taskInfoWidth }}
                    >
                        {taskInfo}
                    </div>
                )}
            </div>
        </div>
    );
}
