import type { Tab } from "@/stores/session-store";
import type {
    ActionDefinition,
    AgentCommand,
    AgentLaunchOptions,
    FlowDefinition,
    FlowRun,
} from "@taskflow/shared";
import type { AgentType } from "@taskflow/shared";
import { cn } from "@/lib/utils";
import { useCmdHeld } from "@/hooks/useCmdHeld";
import { useUIStore } from "@/stores/ui-store";
import { AgentDropdownMenu } from "./AgentDropdownMenu";
import { TabItem } from "./TabItem";

interface TabBarProps {
    tabs: Tab[];
    activeTabId: string;
    onTabClick: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onTabRename: (tabId: string, newLabel: string) => void;
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
}

export function TabBar({
    tabs,
    activeTabId,
    onTabClick,
    onTabClose,
    onTabRename,
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
}: TabBarProps) {
    const { cmdHeld } = useCmdHeld();
    const focusedPanel = useUIStore((s) => s.focusedPanel);
    const showBadges = cmdHeld && focusedPanel === "workspace";

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
                        onTabClick={onTabClick}
                        onTabClose={onTabClose}
                        onTabRename={onTabRename}
                    />
                ))}
            </div>
        </div>
    );
}
