import { useCallback, useEffect, useMemo, useState } from "react";
import type {
    ActionDefinition,
    AgentCommand,
    AgentCommandsListResponse,
    AgentLaunchOptions,
    FlowInputDefinition,
    ScriptsListResponse,
    ShellListResponse,
} from "@taskflow/shared";
import { DEFAULT_TERMINAL_SHELL, MSG, type AgentType } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";
import { useAgentAvailability } from "@/hooks/useAgentAvailability";
import { useFlowStore, filterByProject } from "@/stores/flow-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";
import { resolveTerminalShellPath } from "@/lib/terminal-shells";
import { hasRunMenuItems, type RunMenuData, type RunMenuCallbacks } from "@/lib/run-menu";
import { useConnectivity } from "@/hooks/useConnectivity";

const emptyScripts: Record<string, string> = {};
const emptyAgentCommands: AgentCommand[] = [];

interface UseRunMenuOptions {
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

    const agents = useAgentAvailability();
    const online = useConnectivity();
    const defaultRuntime = useSettingsStore((s) => s.settings?.general.defaultRuntime ?? "bun");
    const configuredShell = useSettingsStore(
        (s) => s.settings?.terminal.defaultShell ?? DEFAULT_TERMINAL_SHELL,
    );

    const ownerId = taskId ?? projectId;
    const activeFlowRun = useFlowStore((s) => s.activeRuns[ownerId] ?? null);
    const allFlows = useFlowStore((s) => s.flows);
    const allActions = useFlowStore((s) => s.actions);

    const flowDefinitions = useMemo(
        () => filterByProject(allFlows, projectId),
        [allFlows, projectId],
    );
    const standaloneActions = useMemo(
        () => filterByProject(allActions, projectId).filter((a) => a.standalone),
        [allActions, projectId],
    );

    // Fetch scripts and agent commands lazily when context menu opens
    useEffect(() => {
        if (!enabled || !projectPath) {
            return;
        }
        let cancelled = false;

        sendRequest<ScriptsListResponse>(MSG.SCRIPTS_LIST, { path: projectPath })
            .then((res) => {
                if (!cancelled) setScripts(res.scripts);
            })
            .catch(() => {
                if (!cancelled) setScripts(emptyScripts);
            });

        sendRequest<AgentCommandsListResponse>(MSG.AGENT_COMMANDS_LIST, { path: projectPath })
            .then((res) => {
                if (!cancelled) setAgentCommands(res.commands);
            })
            .catch(() => {
                if (!cancelled) setAgentCommands(emptyAgentCommands);
            });

        return () => {
            cancelled = true;
        };
    }, [enabled, projectPath]);

    // Ensure flow/action definitions are loaded
    useEffect(() => {
        const store = useFlowStore.getState();
        void store.fetchFlows();
        void store.fetchActions();
    }, [projectId]);

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

    const owner = useMemo(() => (taskId ? { taskId } : { projectId }), [taskId, projectId]);

    const onRunScript = useCallback(
        (name: string) => {
            navigate(true);
            void (async () => {
                const res = await sendRequest<ShellListResponse>(MSG.SHELLS_LIST, {});
                const shell = resolveTerminalShellPath(
                    res.shells,
                    res.systemShellPath,
                    configuredShell,
                );
                if (!shell) return;
                const sessionId = await useSessionStore
                    .getState()
                    .createSession(owner, "shell", name, undefined, shell);
                useSessionStore.getState().sendInput(sessionId, `${defaultRuntime} run ${name}\r`);
            })();
        },
        [navigate, owner, configuredShell, defaultRuntime],
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
            void useSessionStore
                .getState()
                .createSession(
                    owner,
                    action.sessionType,
                    action.name,
                    action.prompt,
                    undefined,
                    action.sessionType !== "shell" ? action.agentOptions : undefined,
                );
        },
        [navigate, owner],
    );

    const onStartFlow = useCallback(
        (flowId: string) => {
            const flow = useFlowStore.getState().flows.find((f) => f.id === flowId);
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
            void useFlowStore.getState().startFlow(flowOwner);
        },
        [navigate, taskId, projectId],
    );

    const onRunTab = useCallback(
        (type: AgentType, agentOptions?: AgentLaunchOptions) => {
            if (!taskId) return;
            navigate(true);
            const task = useTaskStore.getState().tasks.find((t) => t.id === taskId);
            void useSessionStore
                .getState()
                .createSession(
                    { taskId },
                    type,
                    undefined,
                    task?.description || undefined,
                    undefined,
                    agentOptions,
                );
        },
        [navigate, taskId],
    );

    const onFlowInputSubmit = useCallback(
        (values: Record<string, string>) => {
            if (!flowInputState) return;
            navigate(true);
            void useFlowStore.getState().startFlow({
                ...flowInputState.owner,
                inputValues: values,
            });
            setFlowInputState(null);
        },
        [flowInputState, navigate],
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
