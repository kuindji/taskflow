import type { Tab } from "@/stores/session-store";
import type { PaneId } from "@/stores/ui-store";
import type {
    ActionDefinition,
    AgentCommand,
    AgentLaunchOptions,
    FlowDefinition,
    FlowRun,
    AgentType,
} from "@taskflow/shared";
import { useSessionStore, isSessionExited } from "@/stores/session-store";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";
import { destroyTerminal } from "@/components/panes/TerminalPane";
import { isEditorDirty, clearEditorDirty } from "@/components/panes/editor-dirty-state";
import { confirm } from "@/stores/dialog-store";
import { cn } from "@/lib/utils";

interface WorkspacePaneProps {
    workspaceKey: string;
    paneId: PaneId;
    isFocused: boolean;
    onFocus: () => void;
    tabs: Tab[];
    activeTabId: string;
    projectPath?: string | null;
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
    isElectron?: boolean;
    externalDnd?: boolean;
    style?: React.CSSProperties;
    className?: string;
}

export type { WorkspacePaneProps };

export function WorkspacePane({
    workspaceKey,
    paneId,
    isFocused,
    onFocus,
    tabs,
    activeTabId,
    projectPath,
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
    isElectron,
    externalDnd,
    style,
    className,
}: WorkspacePaneProps) {
    const setActiveTab = useSessionStore((s) => s.setActiveTab);
    const closeTab = useSessionStore((s) => s.closeTab);
    const renameTab = useSessionStore((s) => s.renameTab);
    const reorderTabs = useSessionStore((s) => s.reorderTabs);

    const handleTabClose = (id: string) => {
        const tab = tabs.find((t) => t.id === id);

        const doClose = () => {
            if (tab?.filePath) clearEditorDirty(tab.filePath);
            if (tab?.sessionId) destroyTerminal(tab.sessionId);
            void closeTab(workspaceKey, id);
        };

        if (tab?.type === "editor" && tab.filePath && isEditorDirty(tab.filePath)) {
            void confirm({
                title: "Unsaved Changes",
                description: `"${tab.filePath.split("/").pop()}" has unsaved changes that will be lost.`,
                confirmLabel: "Close Without Saving",
                cancelLabel: "Cancel",
                variant: "destructive",
                onConfirm: async () => doClose(),
            });
            return;
        }

        if (tab?.type === "editor" && tab.sessionId && !isSessionExited(tab.sessionId)) {
            void confirm({
                title: "Editor Still Running",
                description: `"${tab.label}" is still running. Unsaved changes will be lost.`,
                confirmLabel: "Close Editor",
                cancelLabel: "Cancel",
                variant: "destructive",
                onConfirm: async () => doClose(),
            });
            return;
        }

        doClose();
    };

    const tabBarClassName = cn(
        !isFocused && "opacity-70",
        isElectron && paneId === "left" && "[-webkit-app-region:drag]",
    );

    return (
        <div
            className={cn("flex min-w-0 flex-1 flex-col", className)}
            style={style}
            onPointerDown={onFocus}>
            <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                projectPath={projectPath}
                onTabClick={(id) => setActiveTab(workspaceKey, id)}
                onTabClose={handleTabClose}
                onTabRename={(id, newLabel) => renameTab(workspaceKey, id, newLabel)}
                onTabReorder={(activeId, overId) => reorderTabs(workspaceKey, activeId, overId)}
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
                className={tabBarClassName}
                externalDnd={externalDnd}
            />
            <TabContent tabs={tabs} activeTabId={activeTabId} />
        </div>
    );
}
