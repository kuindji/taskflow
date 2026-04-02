import { useCallback, useRef, useState } from "react";
import {
    DndContext,
    DragOverlay,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import type { Tab } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { useUIStore } from "@/stores/ui-store";
import type { PaneId } from "@/stores/ui-store";
import { ResizeHandle } from "@/components/ResizeHandle";
import { WorkspacePane } from "./WorkspacePane";
import type { WorkspacePaneProps } from "./WorkspacePane";
import { TabItemOverlay } from "./TabItem";

type SharedPaneProps = Omit<
    WorkspacePaneProps,
    | "workspaceKey"
    | "paneId"
    | "isFocused"
    | "onFocus"
    | "tabs"
    | "activeTabId"
    | "className"
    | "style"
    | "externalDnd"
>;

interface SplitContainerProps extends SharedPaneProps {
    workspaceKey: string;
}

export type { SplitContainerProps };

const emptyTabs: Tab[] = [];

export function SplitContainer({ workspaceKey, ...sharedProps }: SplitContainerProps) {
    const split = useUIStore((s) => s.splitByWorkspace[workspaceKey]);
    const setSplitRatio = useUIStore((s) => s.setSplitRatio);
    const setActivePane = useUIStore((s) => s.setActivePane);

    const leftTabs = useSessionStore((s) => s.tabsByWorkspace[workspaceKey] ?? emptyTabs);
    const leftActiveTabId = useSessionStore((s) => s.activeTabByWorkspace[workspaceKey] ?? "");

    const rightKey = `${workspaceKey}:right`;
    const rightTabs = useSessionStore((s) => s.tabsByWorkspace[rightKey] ?? emptyTabs);
    const rightActiveTabId = useSessionStore((s) => s.activeTabByWorkspace[rightKey] ?? "");

    const containerRef = useRef<HTMLDivElement>(null);
    const [draggedTab, setDraggedTab] = useState<Tab | null>(null);

    const handleResize = useCallback(
        (delta: number) => {
            if (!containerRef.current) return;
            const currentSplit = useUIStore.getState().splitByWorkspace[workspaceKey];
            if (!currentSplit) return;
            const containerWidth = containerRef.current.offsetWidth;
            if (containerWidth === 0) return;
            const newRatio = currentSplit.ratio + delta / containerWidth;
            setSplitRatio(workspaceKey, newRatio);
        },
        [setSplitRatio, workspaceKey],
    );

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

    const handleDragStart = useCallback(
        (event: DragStartEvent) => {
            const activeId = String(event.active.id);
            const store = useSessionStore.getState();
            const lTabs = store.tabsByWorkspace[workspaceKey] ?? [];
            const rTabs = store.tabsByWorkspace[rightKey] ?? [];
            const tab =
                lTabs.find((t) => t.id === activeId) ?? rTabs.find((t) => t.id === activeId);
            setDraggedTab(tab ?? null);
        },
        [workspaceKey, rightKey],
    );

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            setDraggedTab(null);

            const { active, over } = event;
            if (!over) return;

            const activeId = String(active.id);
            const overId = String(over.id);

            const store = useSessionStore.getState();
            const lTabs = store.tabsByWorkspace[workspaceKey] ?? [];
            const rTabs = store.tabsByWorkspace[rightKey] ?? [];

            // Handle drop on pane content area
            if (overId.startsWith("pane-drop:")) {
                const targetKey = overId.slice("pane-drop:".length);
                const sourceKey = lTabs.some((t) => t.id === activeId)
                    ? workspaceKey
                    : rTabs.some((t) => t.id === activeId)
                      ? rightKey
                      : null;
                if (sourceKey && sourceKey !== targetKey) {
                    store.moveTabToPane(sourceKey, targetKey, activeId);
                    const targetPane: PaneId = targetKey.endsWith(":right") ? "right" : "left";
                    setActivePane(workspaceKey, targetPane);
                }
                return;
            }

            if (activeId === overId) return;

            const activeInLeft = lTabs.some((t) => t.id === activeId);
            const overInLeft = lTabs.some((t) => t.id === overId);
            const activeInRight = rTabs.some((t) => t.id === activeId);
            const overInRight = rTabs.some((t) => t.id === overId);

            const sourceKey = activeInLeft ? workspaceKey : activeInRight ? rightKey : null;
            const targetKey = overInLeft ? workspaceKey : overInRight ? rightKey : null;

            if (!sourceKey || !targetKey) return;

            if (sourceKey === targetKey) {
                store.reorderTabs(sourceKey, activeId, overId);
            } else {
                const targetTabs = store.tabsByWorkspace[targetKey] ?? [];
                const insertIndex = targetTabs.findIndex((t) => t.id === overId);
                store.moveTabToPane(
                    sourceKey,
                    targetKey,
                    activeId,
                    insertIndex >= 0 ? insertIndex : undefined,
                );
                const targetPane: PaneId = targetKey.endsWith(":right") ? "right" : "left";
                setActivePane(workspaceKey, targetPane);
            }
        },
        [workspaceKey, rightKey, setActivePane],
    );

    const handleDragCancel = useCallback(() => setDraggedTab(null), []);

    const isOpen = split?.open ?? false;
    const ratio = split?.ratio ?? 0.5;
    const activePane = split?.activePane ?? "left";

    const content = (
        <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 flex-row">
            <WorkspacePane
                {...sharedProps}
                workspaceKey={workspaceKey}
                paneId="left"
                isFocused={!isOpen || activePane === "left"}
                onFocus={() => isOpen && setActivePane(workspaceKey, "left")}
                tabs={leftTabs}
                activeTabId={leftActiveTabId}
                style={isOpen ? { flex: `0 0 ${ratio * 100}%` } : undefined}
                className={isOpen ? "border-border border-r" : undefined}
                externalDnd={isOpen}
            />
            {isOpen && (
                <>
                    <ResizeHandle
                        onResize={handleResize}
                        panelGap={6}
                        orientation="vertical"
                        className="z-10 -mx-[3px]"
                    />
                    <WorkspacePane
                        {...sharedProps}
                        workspaceKey={rightKey}
                        paneId="right"
                        isFocused={activePane === "right"}
                        onFocus={() => setActivePane(workspaceKey, "right")}
                        tabs={rightTabs}
                        activeTabId={rightActiveTabId}
                        externalDnd
                    />
                </>
            )}
        </div>
    );

    if (isOpen) {
        const draggedIsActive = draggedTab
            ? draggedTab.id === leftActiveTabId || draggedTab.id === rightActiveTabId
            : false;

        return (
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}>
                {content}
                <DragOverlay dropAnimation={null}>
                    {draggedTab && <TabItemOverlay tab={draggedTab} isActive={draggedIsActive} />}
                </DragOverlay>
            </DndContext>
        );
    }

    return content;
}
