import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useUIStore } from "@/stores/ui-store";
import type { PanelId } from "@/stores/ui-store";
import { useSettingsStore } from "@/stores/settings-store";
import { ResizeHandle } from "@/components/ResizeHandle";
import useIsElectron from "@/hooks/useIsElectron";
import { useCmdHeld } from "@/hooks/useCmdHeld";
import { cn } from "@/lib/utils";

interface AppShellProps {
    sidebar: ReactNode;
    fileExplorer: ReactNode;
    flowPanel?: ReactNode;
    workspace: ReactNode;
    taskInfo: ReactNode;
}

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 350;
const FILE_EXPLORER_MIN = 150;
const FILE_EXPLORER_MAX = 500;
const FLOW_PANEL_MIN = 150;
const FLOW_PANEL_MAX = 400;
const TASK_INFO_MIN = 150;
const TASK_INFO_MAX = 500;

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export function AppShell({ sidebar, fileExplorer, flowPanel, workspace, taskInfo }: AppShellProps) {
    const fileExplorerOpen = useUIStore((s) => s.fileExplorerOpen);
    const taskInfoOpen = useUIStore((s) => s.taskInfoOpen);
    const sidebarWidth = useUIStore((s) => s.sidebarWidth);
    const fileExplorerWidth = useUIStore((s) => s.fileExplorerWidth);
    const taskInfoWidth = useUIStore((s) => s.taskInfoWidth);
    const flowPanelWidth = useUIStore((s) => s.flowPanelWidth);
    const panelGap = useUIStore((s) => s.panelGap);
    const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
    const setFileExplorerWidth = useUIStore((s) => s.setFileExplorerWidth);
    const setTaskInfoWidth = useUIStore((s) => s.setTaskInfoWidth);
    const setFlowPanelWidth = useUIStore((s) => s.setFlowPanelWidth);
    const updateSettings = useSettingsStore((s) => s.updateSettings);
    const innerPanelGap = Math.max(panelGap - 3, 0);

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

    const handleFlowPanelResize = useCallback(
        (delta: number) => {
            const current = useUIStore.getState().flowPanelWidth;
            setFlowPanelWidth(clamp(current + delta, FLOW_PANEL_MIN, FLOW_PANEL_MAX));
        },
        [setFlowPanelWidth],
    );

    const handleTaskInfoResize = useCallback(
        (delta: number) => {
            const current = useUIStore.getState().taskInfoWidth;
            setTaskInfoWidth(clamp(current - delta, TASK_INFO_MIN, TASK_INFO_MAX));
        },
        [setTaskInfoWidth],
    );

    const handleResizeEnd = useCallback(() => {
        const { sidebarWidth, fileExplorerWidth, taskInfoWidth, flowPanelWidth } =
            useUIStore.getState();
        void updateSettings({
            layout: {
                panels: { sidebarWidth, fileExplorerWidth, taskInfoWidth, flowPanelWidth },
            },
        });
    }, [updateSettings]);

    const focusedPanel = useUIStore((s) => s.focusedPanel);
    const setFocusedPanel = useUIStore((s) => s.setFocusedPanel);
    const [showOutline, setShowOutline] = useState(false);
    const prevPanel = useRef(focusedPanel);
    const suppressNextOutlineRef = useRef(false);

    const handlePanelPointerDown = useCallback(() => {
        suppressNextOutlineRef.current = true;
    }, []);

    const handlePanelClick = useCallback(
        (panel: PanelId) => {
            setFocusedPanel(panel);
        },
        [setFocusedPanel],
    );

    useEffect(() => {
        if (focusedPanel !== prevPanel.current) {
            if (suppressNextOutlineRef.current) {
                suppressNextOutlineRef.current = false;
                setShowOutline(false);
            } else {
                setShowOutline(true);
            }
            prevPanel.current = focusedPanel;
            const timer = setTimeout(() => setShowOutline(false), 1500);
            return () => clearTimeout(timer);
        }
    }, [focusedPanel]);

    const { cmdShiftHeld } = useCmdHeld();
    const isElectron = useIsElectron();

    return (
        <div
            className={cn(
                "flex h-screen flex-col overflow-hidden",
                isElectron ? "bg-(--window-shell)" : "bg-[#2a2a2a]",
            )}>
            <div className="flex flex-1 overflow-hidden" style={{ padding: panelGap }}>
                <div
                    className={cn(
                        "mt-px flex shrink-0 flex-col overflow-hidden rounded-(--window-radius)",
                        (showOutline || cmdShiftHeld) &&
                            focusedPanel === "sidebar" &&
                            "ring-accent/50 ring-1 transition-shadow duration-500",
                    )}
                    data-panel="sidebar"
                    onPointerDown={handlePanelPointerDown}
                    onClick={() => handlePanelClick("sidebar")}
                    style={{
                        width: sidebarWidth,
                        ...(isElectron ? ({ WebkitAppRegion: "drag" } as React.CSSProperties) : {}),
                    }}>
                    {sidebar}
                </div>

                <ResizeHandle
                    onResize={handleSidebarResize}
                    onResizeEnd={handleResizeEnd}
                    panelGap={innerPanelGap+2}
                />

                {fileExplorerOpen && (
                    <div
                        className={cn(
                            "bg-card border-border/50 panel-shadow flex shrink-0 flex-col overflow-hidden rounded-(--window-radius) border",
                            (showOutline || cmdShiftHeld) &&
                                focusedPanel === "fileexplorer" &&
                                "ring-accent/50 ring-1 transition-shadow duration-500",
                        )}
                        data-panel="fileexplorer"
                        onPointerDown={handlePanelPointerDown}
                        onClick={() => handlePanelClick("fileexplorer")}
                        style={{ width: fileExplorerWidth }}>
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

                {flowPanel && (
                    <div
                        className="bg-card border-border/50 flex shrink-0 flex-col overflow-hidden rounded-(--window-radius) border shadow-lg shadow-black/20"
                        style={{ width: flowPanelWidth }}>
                        {flowPanel}
                    </div>
                )}

                {flowPanel && (
                    <ResizeHandle
                        onResize={handleFlowPanelResize}
                        onResizeEnd={handleResizeEnd}
                        panelGap={innerPanelGap}
                    />
                )}

                <div
                    className={cn(
                        "bg-card border-border/50 panel-shadow flex flex-1 flex-col overflow-hidden rounded-(--window-radius) border",
                        (showOutline || cmdShiftHeld) &&
                            focusedPanel === "workspace" &&
                            "ring-accent/50 ring-1 transition-shadow duration-500",
                    )}
                    data-panel="workspace"
                    onPointerDown={handlePanelPointerDown}
                    onClick={() => handlePanelClick("workspace")}>
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
                        className={cn(
                            "bg-card border-border/50 panel-shadow flex shrink-0 flex-col overflow-hidden rounded-(--window-radius) border",
                            (showOutline || cmdShiftHeld) &&
                                focusedPanel === "taskinfo" &&
                                "ring-accent/50 ring-1 transition-shadow duration-500",
                        )}
                        data-panel="taskinfo"
                        onPointerDown={handlePanelPointerDown}
                        onClick={() => handlePanelClick("taskinfo")}
                        style={{ width: taskInfoWidth }}>
                        {taskInfo}
                    </div>
                )}
            </div>
        </div>
    );
}
