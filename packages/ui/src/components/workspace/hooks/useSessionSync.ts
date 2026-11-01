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
import { useSessionStore } from "@/stores/session-store";
import type { Tab } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFlowStore, filterByProject } from "@/stores/flow-store";
import { resolveTerminalShellPath } from "@/lib/terminal-shells";
import { getPrimary, sendRequest } from "@/lib/connection-registry";
import { onBackendReady } from "@/lib/backend-ready";

const emptyTabs: Tab[] = [];
const emptyScripts: Record<string, string> = {};
const emptyAgentCommands: AgentCommand[] = [];

/** A default shell, tied to the machine and setting it was resolved for. */
interface ResolvedShell {
    backendId: string;
    configuredShell: string;
    path: string | null;
}

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
    /** The workspace's machine; the master workspace is primary's. */
    backendId: string | null;
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
    const [resolvedShell, setResolvedShell] = useState<ResolvedShell | null>(null);
    const [flowRunsHydratedOwnerId, setFlowRunsHydratedOwnerId] = useState<string | null>(null);

    const backendId =
        workspace.task?.backendId ??
        workspace.project?.backendId ??
        (workspace.scope === "master" ? getPrimary() : null);
    const configuredShell = useSettingsStore(
        (s) =>
            (backendId ? s.byBackend[backendId] : undefined)?.terminal.defaultShell ??
            DEFAULT_TERMINAL_SHELL,
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
        () => (backendId ? filterByProject(allFlows, currentProjectId, backendId) : []),
        [allFlows, currentProjectId, backendId],
    );
    const standaloneActions = useMemo(
        () =>
            backendId
                ? filterByProject(allActions, currentProjectId, backendId).filter(
                      (a) => a.standalone,
                  )
                : [],
        [allActions, currentProjectId, backendId],
    );

    // Fetch flow/action definitions so the Run menu can show them
    useEffect(() => {
        if (!backendId) return;
        const store = useFlowStore.getState();
        void store.fetchFlows(backendId);
        void store.fetchActions(backendId);
    }, [workspace.project?.id, backendId]);

    // Hydrate flow runs for current owner
    useEffect(() => {
        if (!ownerId || !backendId) {
            setFlowRunsHydratedOwnerId(null);
            return;
        }

        let cancelled = false;
        setFlowRunsHydratedOwnerId(null);
        const hydrate = () =>
            useFlowStore
                .getState()
                .fetchFlowRuns(backendId, ownerId)
                .then(() => {
                    if (!cancelled) {
                        setFlowRunsHydratedOwnerId(ownerId);
                    }
                })
                .catch(() => {
                    // Keep the start control hidden until we can confirm the current owner state.
                });
        void hydrate();
        // Run updates broadcast while the connection was down never arrived.
        const offReady = onBackendReady((readyId) => {
            if (readyId === backendId) void hydrate();
        });

        return () => {
            cancelled = true;
            offReady();
        };
    }, [ownerId, backendId]);

    // Fetch scripts. The working directory is only meaningful on the
    // workspace's machine.
    useEffect(() => {
        if (!workspace.workingDir || workspace.scope === "master" || !backendId) {
            setScripts(emptyScripts);
            return;
        }
        let cancelled = false;
        sendRequest<ScriptsListResponse>(backendId, MSG.SCRIPTS_LIST, {
            path: workspace.workingDir,
        })
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
    }, [workspace.workingDir, workspace.scope, backendId]);

    // Fetch agent commands
    useEffect(() => {
        if (!workspace.workingDir || !backendId) {
            setAgentCommands(emptyAgentCommands);
            return;
        }
        let cancelled = false;
        sendRequest<AgentCommandsListResponse>(backendId, MSG.AGENT_COMMANDS_LIST, {
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
    }, [workspace.workingDir, workspace.scope, backendId]);

    // Resolve default shell. A list answered after the workspace moved to
    // another machine names that machine's shells, so it is dropped; until the
    // new machine answers, the old machine's shell is not offered either.
    useEffect(() => {
        if (!backendId) return;
        let cancelled = false;
        const settle = (path: string | null) => {
            if (!cancelled) setResolvedShell({ backendId, configuredShell, path });
        };
        sendRequest<ShellListResponse>(backendId, MSG.SHELLS_LIST, {}).then(
            (res) =>
                settle(resolveTerminalShellPath(res.shells, res.systemShellPath, configuredShell)),
            () => settle(null),
        );
        return () => {
            cancelled = true;
        };
    }, [configuredShell, backendId]);
    const defaultShellPath =
        resolvedShell?.backendId === backendId && resolvedShell.configuredShell === configuredShell
            ? resolvedShell.path
            : null;

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
        backendId,
        hasScripts,
    };
}

export { useSessionSync };
export type { SessionSyncResult };
