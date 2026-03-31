import type { Tab } from "@/stores/session-store";
import type {
    ActionDefinition,
    AgentCommand,
    AgentLaunchOptions,
    FlowDefinition,
    FlowRun,
} from "@taskflow/shared";
import type { AgentType } from "@taskflow/shared";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui-store";
import { AgentDropdownMenu } from "./AgentDropdownMenu";
import { TabItem } from "./TabItem";

interface TabBarProps {
    tabs: Tab[];
    activeTabId: string;
    projectPath?: string | null;
    onTabClick: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onTabRename: (tabId: string, newLabel: string) => void;
    onTabReorder: (activeId: string, overId: string) => void;
    onNewTab: (
        type: AgentType | "browser" | "shell",
        shellPath?: string,
        agentOptions?: AgentLaunchOptions,
    ) => void;
    onRunTab: (type: AgentType, agentOptions?: AgentLaunchOptions) => void;
    onRunScript: (scriptName: string) => void;
    onRunAction: (action: ActionDefinition) => void;
    onRunAgentCommand: (command: AgentCommand) => void;
    onStartFlow: (flowId: string) => void;
    onManageFlows: () => void;
    scripts: Record<string, string>;
    defaultRuntime: string;
    flows: FlowDefinition[];
    standaloneActions: ActionDefinition[];
    agentCommands: AgentCommand[];
    activeFlowRun: FlowRun | null;
    showRunButton: boolean;
    showAgentOptions: boolean;
    allowSessionTabs: boolean;
    className?: string;
    externalDnd?: boolean;
}

export function TabBar({
    tabs,
    activeTabId,
    projectPath,
    onTabClick,
    onTabClose,
    onTabRename,
    onTabReorder,
    onNewTab,
    onRunTab,
    onRunScript,
    onRunAction,
    onRunAgentCommand,
    onStartFlow,
    onManageFlows,
    scripts,
    defaultRuntime,
    flows,
    standaloneActions,
    agentCommands,
    activeFlowRun,
    showRunButton,
    showAgentOptions,
    allowSessionTabs,
    className,
    externalDnd,
}: TabBarProps) {
    const cmdHeld = useUIStore((s) => s.cmdHeld);
    const focusedPanel = useUIStore((s) => s.focusedPanel);
    const showBadges = cmdHeld && focusedPanel === "workspace";

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

    const tabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            const { active, over } = event;
            if (over && active.id !== over.id) {
                onTabReorder(String(active.id), String(over.id));
            }
        },
        [onTabReorder],
    );

    return (
        <div
            className={cn(
                "bg-card border-border flex min-h-9 items-center gap-1 border-b px-1.5 py-1.5",
                className,
            )}>
            <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
                <AgentDropdownMenu
                    onNewTab={onNewTab}
                    onRunTab={onRunTab}
                    onRunScript={onRunScript}
                    onRunAction={onRunAction}
                    onRunAgentCommand={onRunAgentCommand}
                    onStartFlow={onStartFlow}
                    onManageFlows={onManageFlows}
                    scripts={scripts}
                    defaultRuntime={defaultRuntime}
                    flows={flows}
                    standaloneActions={standaloneActions}
                    agentCommands={agentCommands}
                    activeFlowRun={activeFlowRun}
                    showRunButton={showRunButton}
                    showAgentOptions={showAgentOptions}
                    allowSessionTabs={allowSessionTabs}
                />
            </div>
            {externalDnd ? (
                <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
                    <div
                        className="flex min-w-0 items-center gap-1 overflow-x-auto [-webkit-app-region:no-drag]"
                        style={{ scrollbarWidth: "none" }}>
                        {tabs.map((tab, index) => (
                            <TabItem
                                key={tab.id}
                                tab={tab}
                                isActive={tab.id === activeTabId}
                                index={index}
                                cmdHeld={showBadges}
                                projectPath={projectPath}
                                onTabClick={onTabClick}
                                onTabClose={onTabClose}
                                onTabRename={onTabRename}
                            />
                        ))}
                    </div>
                </SortableContext>
            ) : (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}>
                    <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
                        <div
                            className="flex min-w-0 items-center gap-1 overflow-x-auto [-webkit-app-region:no-drag]"
                            style={{ scrollbarWidth: "none" }}>
                            {tabs.map((tab, index) => (
                                <TabItem
                                    key={tab.id}
                                    tab={tab}
                                    isActive={tab.id === activeTabId}
                                    index={index}
                                    cmdHeld={showBadges}
                                    projectPath={projectPath}
                                    onTabClick={onTabClick}
                                    onTabClose={onTabClose}
                                    onTabRename={onTabRename}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            )}
        </div>
    );
}
