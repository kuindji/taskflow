import { useCallback, useEffect, useMemo, useState } from "react";
import type {
    ActionDefinition,
    AgentCommand,
    AgentCommandsListResponse,
    AgentLaunchOptions,
    FlowInputDefinition,
    ScriptsListResponse,
} from "@taskflow/shared";
import { DEFAULT_TERMINAL_SHELL, MSG, type AgentType } from "@taskflow/shared";
import { sendRequest } from "@/lib/connection-registry";
import { useAgentAvailability } from "@/hooks/useAgentAvailability";
import { useFlowStore, filterByProject } from "@/stores/flow-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";
import { runInShell } from "@/lib/run-in-shell";
import { hasRunMenuItems, type RunMenuData, type RunMenuCallbacks } from "@/lib/run-menu";
import { useConnectivity } from "@/hooks/useConnectivity";

const emptyScripts: Record<string, string> = {};
const emptyAgentCommands: AgentCommand[] = [];
/** How long a native menu waits for scripts before opening without them. */
const NATIVE_MENU_FETCH_TIMEOUT_MS = 3000;

interface UseRunMenuOptions {
    /** The row's machine: its flows, defaults and runs are that machine's. */
    backendId: string;
    projectId: string;
    projectPath: string;
    taskId?: string;
    showAgentOptions: boolean;
    enabled: boolean;
}

interface FlowInputState {
    flowId: string;
    flowName: string;
    inputs: FlowInputDefinition[];
    owner: { taskId?: string; projectId?: string; flowId: string };
}

interface UseRunMenuResult {
    data: RunMenuData;
    loadData: () => Promise<RunMenuData>;
    callbacks: RunMenuCallbacks;
    hasItems: boolean;
    flowInputState: FlowInputState | null;
    onFlowInputSubmit: (values: Record<string, string>) => void;
    onFlowInputCancel: () => void;
    runOptionsAgent: AgentType | null;
    handleRunOptionsConfirm: (agentType: AgentType, options: AgentLaunchOptions) => void;
    handleRunOptionsOpenChange: (open: boolean) => void;
}

function useRunMenu({
    backendId,
    projectId,
    projectPath,
    taskId,
    showAgentOptions,
    enabled,
}: UseRunMenuOptions): UseRunMenuResult {
    const [scripts, setScripts] = useState<Record<string, string>>(emptyScripts);
    const [agentCommands, setAgentCommands] = useState<AgentCommand[]>(emptyAgentCommands);
    const [flowInputState, setFlowInputState] = useState<FlowInputState | null>(null);
    const [runOptionsAgent, setRunOptionsAgent] = useState<AgentType | null>(null);

    const agents = useAgentAvailability(backendId);
    const online = useConnectivity();
    const defaultRuntime = useSettingsStore(
        (s) => s.byBackend[backendId]?.general.defaultRuntime ?? "bun",
    );
    const configuredShell = useSettingsStore(
        (s) => s.byBackend[backendId]?.terminal.defaultShell ?? DEFAULT_TERMINAL_SHELL,
    );

    const ownerId = taskId ?? projectId;
    const activeFlowRun = useFlowStore((s) => s.activeRuns[ownerId] ?? null);
    const allFlows = useFlowStore((s) => s.flows);
    const allActions = useFlowStore((s) => s.actions);

    const flowDefinitions = useMemo(
        () => filterByProject(allFlows, projectId, backendId),
        [allFlows, projectId, backendId],
    );
    const standaloneActions = useMemo(
        () => filterByProject(allActions, projectId, backendId).filter((a) => a.standalone),
        [allActions, projectId, backendId],
    );

    // The project's package scripts and agent commands, read from the row's
    // machine: the path is only meaningful there. A failed read lists none.
    const fetchMenuSources = useCallback(
        async (timeoutMs?: number) => {
            const [nextScripts, nextCommands] = await Promise.all([
                sendRequest<ScriptsListResponse>(
                    backendId,
                    MSG.SCRIPTS_LIST,
                    { path: projectPath },
                    timeoutMs,
                ).then(
                    (res) => res.scripts,
                    () => emptyScripts,
                ),
                sendRequest<AgentCommandsListResponse>(
                    backendId,
                    MSG.AGENT_COMMANDS_LIST,
                    { path: projectPath },
                    timeoutMs,
                ).then(
                    (res) => res.commands,
                    () => emptyAgentCommands,
                ),
            ]);
            return { scripts: nextScripts, agentCommands: nextCommands };
        },
        [backendId, projectPath],
    );

    // Fetch scripts and agent commands lazily when context menu opens
    useEffect(() => {
        if (!enabled || !projectPath || !backendId) {
            return;
        }
        let cancelled = false;
        void fetchMenuSources().then((sources) => {
            if (cancelled) return;
            setScripts(sources.scripts);
            setAgentCommands(sources.agentCommands);
        });
        return () => {
            cancelled = true;
        };
    }, [enabled, projectPath, backendId, fetchMenuSources]);

    // Ensure flow/action definitions are loaded
    useEffect(() => {
        if (!backendId) return;
        const store = useFlowStore.getState();
        void store.fetchFlows(backendId);
        void store.fetchActions(backendId);
    }, [projectId, backendId]);

    const data: RunMenuData = useMemo(
        () => ({
            scripts,
            defaultRuntime,
            agentCommands,
            flows: flowDefinitions,
            standaloneActions,
            activeFlowRun,
            agents,
            showAgentOptions,
            online,
        }),
        [
            scripts,
            defaultRuntime,
            agentCommands,
            flowDefinitions,
            standaloneActions,
            activeFlowRun,
            agents,
            showAgentOptions,
            online,
        ],
    );

    // A native menu is fixed once shown, so it is built from freshly read
    // scripts and agent commands rather than whatever the last opening fetched.
    const loadData = useCallback(async (): Promise<RunMenuData> => {
        if (!projectPath || !backendId) return data;
        return { ...data, ...(await fetchMenuSources(NATIVE_MENU_FETCH_TIMEOUT_MS)) };
    }, [data, projectPath, backendId, fetchMenuSources]);

    const navigate = useCallback(
        (focusWorkspace: boolean) => {
            if (taskId) {
                useTaskStore.getState().setActiveTask(taskId);
            }
            useUIStore.getState().setActiveProject(projectId);
            if (focusWorkspace) {
                useUIStore.getState().setFocusedPanel("workspace");
            }
        },
        [taskId, projectId],
    );

    // Sessions started from a row run on the row's machine, not wherever the
    // open workspace happens to be.
    const owner = useMemo(
        () => (taskId ? { taskId, backendId } : { projectId, backendId }),
        [taskId, projectId, backendId],
    );

    const onRunScript = useCallback(
        (name: string) => {
            navigate(true);
            void runInShell({
                backendId,
                owner,
                configuredShell,
                label: name,
                command: `${defaultRuntime} run ${name}\r`,
            });
        },
        [navigate, backendId, owner, configuredShell, defaultRuntime],
    );

    const onRunAgentCommand = useCallback(
        (cmd: AgentCommand) => {
            navigate(true);
            void useSessionStore
                .getState()
                .createSession(owner, "claude", cmd.name, `/${cmd.name}`);
        },
        [navigate, owner],
    );

    const onRunAction = useCallback(
        (action: ActionDefinition) => {
            navigate(true);
            if (action.sessionType === "shell") {
                void runInShell({
                    backendId,
                    owner,
                    configuredShell,
                    label: action.name,
                    command: action.prompt ? `${action.prompt}\r` : undefined,
                });
            } else {
                void useSessionStore
                    .getState()
                    .createSession(
                        owner,
                        action.sessionType,
                        action.name,
                        action.prompt,
                        undefined,
                        action.agentOptions,
                    );
            }
        },
        [navigate, backendId, owner, configuredShell],
    );

    const onStartFlow = useCallback(
        (flowId: string) => {
            const flow = useFlowStore
                .getState()
                .flows.find((f) => f.backendId === backendId && f.id === flowId);
            const flowOwner = taskId ? { taskId, flowId } : { projectId, flowId };

            if (flow?.inputs && flow.inputs.length > 0) {
                setFlowInputState({
                    flowId,
                    flowName: flow.name,
                    inputs: flow.inputs,
                    owner: flowOwner,
                });
                return;
            }

            navigate(true);
            void useFlowStore.getState().startFlow(backendId, flowOwner);
        },
        [navigate, taskId, projectId, backendId],
    );

    const onRunTab = useCallback(
        (type: AgentType, agentOptions?: AgentLaunchOptions) => {
            if (!taskId) return;
            navigate(true);
            const task = useTaskStore
                .getState()
                .tasks.find((t) => t.backendId === backendId && t.id === taskId);
            void useSessionStore
                .getState()
                .createSession(
                    { taskId, backendId },
                    type,
                    undefined,
                    task?.description || undefined,
                    undefined,
                    agentOptions,
                );
        },
        [navigate, taskId, backendId],
    );

    const onFlowInputSubmit = useCallback(
        (values: Record<string, string>) => {
            if (!flowInputState) return;
            navigate(true);
            void useFlowStore.getState().startFlow(backendId, {
                ...flowInputState.owner,
                inputValues: values,
            });
            setFlowInputState(null);
        },
        [flowInputState, navigate, backendId],
    );

    const onFlowInputCancel = useCallback(() => {
        setFlowInputState(null);
    }, []);

    const onRunTabWithOptions = useCallback((type: AgentType) => {
        setRunOptionsAgent(type);
    }, []);

    const handleRunOptionsConfirm = useCallback(
        (agentType: AgentType, options: AgentLaunchOptions) => {
            setRunOptionsAgent(null);
            onRunTab(agentType, options);
        },
        [onRunTab],
    );

    const handleRunOptionsOpenChange = useCallback((open: boolean) => {
        if (!open) setRunOptionsAgent(null);
    }, []);

    const callbacks: RunMenuCallbacks = useMemo(
        () => ({
            onRunScript,
            onRunAgentCommand,
            onRunAction,
            onStartFlow,
            onRunTab: showAgentOptions ? onRunTab : undefined,
            onRunTabWithOptions: showAgentOptions ? onRunTabWithOptions : undefined,
        }),
        [
            onRunScript,
            onRunAgentCommand,
            onRunAction,
            onStartFlow,
            showAgentOptions,
            onRunTab,
            onRunTabWithOptions,
        ],
    );

    return {
        data,
        loadData,
        callbacks,
        hasItems: hasRunMenuItems(data),
        flowInputState,
        onFlowInputSubmit,
        onFlowInputCancel,
        runOptionsAgent,
        handleRunOptionsConfirm,
        handleRunOptionsOpenChange,
    };
}

export { useRunMenu };
export type { FlowInputState };
