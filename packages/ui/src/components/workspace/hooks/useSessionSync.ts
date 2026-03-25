import { useEffect, useMemo, useState } from "react";
import type {
    ActionDefinition,
    AgentCommand,
    AgentCommandsListResponse,
    FlowDefinition,
    ScriptsListResponse,
    ShellListResponse,
} from "@taskflow/shared";
import { DEFAULT_TERMINAL_SHELL, MASTER_OWNER_ID, MSG } from "@taskflow/shared";
import type { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { sendRequest } from "@/hooks/useWebSocket";
import { useSessionStore } from "@/stores/session-store";
import type { Tab } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFlowStore, filterByProject } from "@/stores/flow-store";
import { resolveTerminalShellPath } from "@/lib/terminal-shells";

const emptyTabs: Tab[] = [];
const emptyScripts: Record<string, string> = {};
const emptyAgentCommands: AgentCommand[] = [];

type Workspace = ReturnType<typeof useActiveWorkspace>;

interface SessionSyncResult {
    tabs: Tab[];
    activeTab: Tab | undefined;
    activeTabId: string;
    scripts: Record<string, string>;
    agentCommands: AgentCommand[];
    defaultShellPath: string | null;
    flowRunsReady: boolean;
    flowDefinitions: FlowDefinition[];
    standaloneActions: ActionDefinition[];
    activeFlowRun: ReturnType<typeof useFlowStore.getState>["activeRuns"][string] | undefined;
    ownerId: string | undefined;
    hasScripts: boolean;
}

function useSessionSync(workspace: Workspace): SessionSyncResult {
    const tabs = useSessionStore((s) =>
        workspace.workspaceKey
            ? (s.tabsByWorkspace[workspace.workspaceKey] ?? emptyTabs)
            : emptyTabs,
    );
    const activeTabId = useSessionStore((s) =>
        workspace.workspaceKey ? (s.activeTabByWorkspace[workspace.workspaceKey] ?? "") : "",
    );
    const setActiveTab = useSessionStore((s) => s.setActiveTab);

    const [scripts, setScripts] = useState<Record<string, string>>(emptyScripts);
    const [agentCommands, setAgentCommands] = useState<AgentCommand[]>(emptyAgentCommands);
    const [defaultShellPath, setDefaultShellPath] = useState<string | null>(null);
    const [flowRunsHydratedOwnerId, setFlowRunsHydratedOwnerId] = useState<string | null>(null);

    const configuredShell = useSettingsStore(
        (s) => s.settings?.terminal.defaultShell ?? DEFAULT_TERMINAL_SHELL,
    );

    const taskId = workspace.scope === "task" ? workspace.task?.id : undefined;
    const ownerId =
        taskId ??
        workspace.project?.id ??
        (workspace.scope === "master" ? MASTER_OWNER_ID : undefined);
    const activeFlowRun = useFlowStore((s) => (ownerId ? s.activeRuns[ownerId] : undefined));
    const allFlows = useFlowStore((s) => s.flows);
    const allActions = useFlowStore((s) => s.actions);
    const currentProjectId = workspace.project?.id ?? null;
    const flowDefinitions = useMemo(
        () => filterByProject(allFlows, currentProjectId),
        [allFlows, currentProjectId],
    );
    const standaloneActions = useMemo(
        () => filterByProject(allActions, currentProjectId).filter((a) => a.standalone),
        [allActions, currentProjectId],
    );

    // Fetch flow/action definitions so the Run menu can show them
    useEffect(() => {
        const store = useFlowStore.getState();
        void store.fetchFlows();
        void store.fetchActions();
    }, [workspace.project?.id]);

    // Hydrate flow runs for current owner
    useEffect(() => {
        if (!ownerId) {
            setFlowRunsHydratedOwnerId(null);
            return;
        }

        let cancelled = false;
        setFlowRunsHydratedOwnerId(null);
        void useFlowStore
            .getState()
            .fetchFlowRuns(ownerId)
            .then(() => {
                if (!cancelled) {
                    setFlowRunsHydratedOwnerId(ownerId);
                }
            })
            .catch(() => {
                // Keep the start control hidden until we can confirm the current owner state.
            });

        return () => {
            cancelled = true;
        };
    }, [ownerId]);

    // Fetch scripts
    useEffect(() => {
        if (!workspace.workingDir || workspace.scope === "master") {
            setScripts(emptyScripts);
            return;
        }
        let cancelled = false;
        sendRequest<ScriptsListResponse>(MSG.SCRIPTS_LIST, { path: workspace.workingDir })
            .then((res) => {
                if (cancelled) return;
                setScripts(res.scripts);
            })
            .catch(() => {
                if (!cancelled) setScripts(emptyScripts);
            });
        return () => {
            cancelled = true;
        };
    }, [workspace.workingDir, workspace.scope]);

    // Fetch agent commands
    useEffect(() => {
        if (!workspace.workingDir) {
            setAgentCommands(emptyAgentCommands);
            return;
        }
        let cancelled = false;
        sendRequest<AgentCommandsListResponse>(MSG.AGENT_COMMANDS_LIST, {
            path: workspace.workingDir,
        })
            .then((res) => {
                if (cancelled) return;
                setAgentCommands(res.commands);
            })
            .catch(() => {
                if (!cancelled) setAgentCommands(emptyAgentCommands);
            });
        return () => {
            cancelled = true;
        };
    }, [workspace.workingDir, workspace.scope]);

    // Resolve default shell
    useEffect(() => {
        sendRequest<ShellListResponse>(MSG.SHELLS_LIST, {}).then(
            (res) =>
                setDefaultShellPath(
                    resolveTerminalShellPath(res.shells, res.systemShellPath, configuredShell),
                ),
            () => setDefaultShellPath(null),
        );
    }, [configuredShell]);

    // Sync active tab when tabs change
    const visibleTabs = tabs;
    const activeTab = visibleTabs.find((t) => t.id === activeTabId) ?? visibleTabs[0];

    useEffect(() => {
        if (!workspace.workspaceKey || !activeTab || activeTab.id === activeTabId) {
            return;
        }
        setActiveTab(workspace.workspaceKey, activeTab.id);
    }, [activeTab, activeTabId, setActiveTab, workspace.workspaceKey]);

    const flowRunsReady = flowRunsHydratedOwnerId === ownerId;
    const hasScripts = Object.keys(scripts).length > 0;

    return {
        tabs: visibleTabs,
        activeTab,
        activeTabId,
        scripts,
        agentCommands,
        defaultShellPath,
        flowRunsReady,
        flowDefinitions,
        standaloneActions,
        activeFlowRun,
        ownerId,
        hasScripts,
    };
}

export { useSessionSync };
export type { SessionSyncResult };
