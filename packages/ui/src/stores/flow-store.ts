import { create } from "zustand";
import type {
    FlowDefinition,
    FlowRun,
    ActionDefinition,
    FlowDefinitionsListResponse,
    FlowActionsListResponse,
    FlowRunsListResponse,
    BuiltinActionDefinition,
    BuiltinActionId,
    BuiltinActionOverride,
    BuiltinActionsListResponse,
} from "@taskflow/shared";
import { MSG, getFlowRunOwnerId } from "@taskflow/shared";
import { createSlices, type Scoped } from "@/lib/backend-scope";
import { getPrimary, onEvent, sendRequest } from "@/lib/connection-registry";
import { registerBackendReset } from "./store-reset";
import { useSessionStore } from "./session-store";
import { useTaskStore } from "./task-store";
import { useUIStore } from "./ui-store";
import { getTaskWorkspaceKey, getProjectWorkspaceKey } from "@/hooks/useActiveWorkspace";

/**
 * Global definitions (no projectId) belong to a machine like any other. A
 * project's menu offers its own machine's globals plus its own definitions, and
 * never another machine's, because FLOW_START resolves ids locally.
 */
function filterByProject<T extends { projectId?: string }>(
    items: Scoped<T>[],
    projectId: string | null | undefined,
    backendId: string,
): Scoped<T>[] {
    const mine = items.filter((item) => item.backendId === backendId);
    if (!projectId) return mine.filter((item) => !item.projectId);
    return mine.filter((item) => !item.projectId || item.projectId === projectId);
}

/**
 * Where a saved definition goes: the machine already holding it, or primary for
 * a new one, since the app-level manager addresses primary.
 */
function definitionBackend(items: Scoped<{ id: string }>[], id: string): string {
    const existing = items.find((item) => item.id === id);
    if (existing) return existing.backendId;
    const primary = getPrimary();
    if (!primary) throw new Error("Not connected to a backend");
    return primary;
}

interface FlowStartParams {
    taskId?: string;
    projectId?: string;
    master?: true;
    flowId: string;
    inputValues?: Record<string, string>;
}

/**
 * A flow runs on the machine that owns its project; nothing here crosses
 * machines. Run controls name that machine first.
 */
interface FlowStore {
    flows: Scoped<FlowDefinition>[];
    actions: Scoped<ActionDefinition>[];
    /** Built-in action definitions (defaults merged with overrides), per machine. */
    builtinActions: Scoped<BuiltinActionDefinition>[];
    loadingDefinitions: boolean;
    definitionLoadCount: number;
    /** Keyed by owner id. The value carries its machine: nothing else knows it. */
    activeRuns: Record<string, Scoped<FlowRun>>;

    fetchFlows(backendId: string): Promise<void>;
    fetchActions(backendId: string): Promise<void>;
    saveFlow(backendId: string, flow: FlowDefinition): Promise<void>;
    saveAction(backendId: string, action: ActionDefinition): Promise<void>;
    deleteFlow(flow: Scoped<FlowDefinition>): Promise<void>;
    deleteAction(action: Scoped<ActionDefinition>): Promise<void>;
    fetchBuiltinActions(backendId: string): Promise<void>;
    saveBuiltinAction(backendId: string, override: BuiltinActionOverride): Promise<void>;
    resetBuiltinAction(backendId: string, id: BuiltinActionId): Promise<void>;

    startFlow(backendId: string, params: FlowStartParams): Promise<FlowRun>;
    stopFlow(backendId: string, ownerId: string, flowId: string): Promise<void>;
    pauseFlow(backendId: string, ownerId: string, flowId: string): Promise<void>;
    resumeFlow(backendId: string, ownerId: string, flowId: string): Promise<void>;
    skipAction(backendId: string, ownerId: string, flowId: string): Promise<void>;
    jumpToAction(
        backendId: string,
        ownerId: string,
        flowId: string,
        actionIndex: number,
    ): Promise<void>;
    fetchFlowRuns(backendId: string, ownerId: string): Promise<void>;
}

const slices = createSlices<FlowDefinition>();
const actionSlices = createSlices<ActionDefinition>();
const builtinSlices = createSlices<BuiltinActionDefinition>();

function publishDefinitions(): void {
    useFlowStore.setState({
        flows: slices.read(),
        actions: actionSlices.read(),
        builtinActions: builtinSlices.read(),
    });
}

function upsertById<T extends { id: string }>(items: Scoped<T>[], record: Scoped<T>): Scoped<T>[] {
    return items.some((item) => item.id === record.id)
        ? items.map((item) => (item.id === record.id ? record : item))
        : [...items, record];
}

/** Count a definition load for the duration of `load`. */
async function trackDefinitionLoad(load: () => Promise<boolean>): Promise<void> {
    useFlowStore.setState((state) => ({
        definitionLoadCount: state.definitionLoadCount + 1,
        loadingDefinitions: true,
    }));
    try {
        if (await load()) publishDefinitions();
    } finally {
        useFlowStore.setState((state) => {
            const definitionLoadCount = Math.max(0, state.definitionLoadCount - 1);
            return {
                definitionLoadCount,
                loadingDefinitions: definitionLoadCount > 0,
            };
        });
    }
}

function applyRunUpdate(backendId: string, run: FlowRun): void {
    // Every machine's master owner id is the same constant, and the master
    // workspace is primary's: another machine's master run has no place here.
    if (run.master && backendId !== getPrimary()) return;
    useFlowStore.setState((s) => {
        const ownerId = getFlowRunOwnerId(run);
        // Only update if we're already tracking this owner's run
        // (don't add completed runs we weren't watching)
        if (run.status === "running" || run.status === "paused" || s.activeRuns[ownerId]) {
            return { activeRuns: { ...s.activeRuns, [ownerId]: { ...run, backendId } } };
        }
        return s;
    });
}

const useFlowStore = create<FlowStore>((set) => ({
    flows: [],
    actions: [],
    builtinActions: [],
    loadingDefinitions: false,
    definitionLoadCount: 0,
    activeRuns: {},

    async fetchFlows(backendId) {
        await trackDefinitionLoad(() =>
            slices.load(backendId, async () => {
                const { flows } = await sendRequest<FlowDefinitionsListResponse>(
                    backendId,
                    MSG.FLOW_DEFINITIONS_LIST,
                );
                return flows;
            }),
        );
    },

    async fetchActions(backendId) {
        await trackDefinitionLoad(() =>
            actionSlices.load(backendId, async () => {
                const { actions } = await sendRequest<FlowActionsListResponse>(
                    backendId,
                    MSG.FLOW_ACTIONS_LIST,
                );
                return actions;
            }),
        );
    },

    async saveFlow(backendId, flow) {
        await sendRequest(backendId, MSG.FLOW_DEFINITION_SAVE, flow);
        slices.apply(backendId, (items) => upsertById(items, { ...flow, backendId }));
        publishDefinitions();
    },

    async saveAction(backendId, action) {
        await sendRequest(backendId, MSG.FLOW_ACTION_SAVE, action);
        actionSlices.apply(backendId, (items) => upsertById(items, { ...action, backendId }));
        publishDefinitions();
    },

    async deleteFlow(flow) {
        await sendRequest(flow.backendId, MSG.FLOW_DEFINITION_DELETE, { id: flow.id });
        slices.apply(flow.backendId, (items) => items.filter((f) => f.id !== flow.id));
        publishDefinitions();
    },

    async deleteAction(action) {
        await sendRequest(action.backendId, MSG.FLOW_ACTION_DELETE, { id: action.id });
        actionSlices.apply(action.backendId, (items) => items.filter((a) => a.id !== action.id));
        publishDefinitions();
    },

    async fetchBuiltinActions(backendId) {
        await trackDefinitionLoad(() =>
            builtinSlices.load(backendId, async () => {
                const { actions } = await sendRequest<BuiltinActionsListResponse>(
                    backendId,
                    MSG.BUILTIN_ACTIONS_LIST,
                );
                return actions;
            }),
        );
    },

    async saveBuiltinAction(backendId, override) {
        const saved = await sendRequest<BuiltinActionDefinition>(
            backendId,
            MSG.BUILTIN_ACTION_SAVE,
            override,
        );
        builtinSlices.apply(backendId, (items) => upsertById(items, { ...saved, backendId }));
        publishDefinitions();
    },

    async resetBuiltinAction(backendId, id) {
        const reset = await sendRequest<BuiltinActionDefinition>(
            backendId,
            MSG.BUILTIN_ACTION_RESET,
            { id },
        );
        builtinSlices.apply(backendId, (items) => upsertById(items, { ...reset, backendId }));
        publishDefinitions();
    },

    async startFlow(backendId, params) {
        const run = await sendRequest<FlowRun>(backendId, MSG.FLOW_START, params);
        const ownerId = getFlowRunOwnerId(run);
        set((s) => ({ activeRuns: { ...s.activeRuns, [ownerId]: { ...run, backendId } } }));
        return run;
    },

    async stopFlow(backendId, ownerId, flowId) {
        await sendRequest(backendId, MSG.FLOW_STOP, { ownerId, flowId });
    },

    async pauseFlow(backendId, ownerId, flowId) {
        await sendRequest(backendId, MSG.FLOW_PAUSE, { ownerId, flowId });
    },

    async resumeFlow(backendId, ownerId, flowId) {
        await sendRequest(backendId, MSG.FLOW_RESUME, { ownerId, flowId });
    },

    async skipAction(backendId, ownerId, flowId) {
        await sendRequest(backendId, MSG.FLOW_SKIP_ACTION, { ownerId, flowId });
    },

    async jumpToAction(backendId, ownerId, flowId, actionIndex) {
        await sendRequest(backendId, MSG.FLOW_JUMP_TO_ACTION, { ownerId, flowId, actionIndex });
    },

    async fetchFlowRuns(backendId, ownerId) {
        const { runs } = await sendRequest<FlowRunsListResponse>(backendId, MSG.FLOW_RUNS_LIST, {
            ownerId,
        });
        const activeRun = runs.find((r) => r.status === "running" || r.status === "paused");
        set((s) => {
            if (activeRun) {
                return { activeRuns: { ...s.activeRuns, [ownerId]: { ...activeRun, backendId } } };
            }
            // Another machine's run under this owner is not this answer's to clear.
            if (s.activeRuns[ownerId]?.backendId !== backendId) return s;
            const { [ownerId]: _removed, ...remaining } = s.activeRuns;
            return { activeRuns: remaining };
        });
    },
}));

registerBackendReset("flow-store", (backendId) => {
    slices.drop(backendId);
    actionSlices.drop(backendId);
    builtinSlices.drop(backendId);
    // A detached machine's runs go with it, or the panel keeps offering
    // controls for a machine that is no longer attached.
    useFlowStore.setState((s) => ({
        flows: slices.read(),
        actions: actionSlices.read(),
        builtinActions: builtinSlices.read(),
        activeRuns: Object.fromEntries(
            Object.entries(s.activeRuns).filter(([, run]) => run.backendId !== backendId),
        ),
    }));
});

// Module-level event listener for flow run updates.
// Singleton store — registered once on import.
const _unsubFlowRunUpdated = onEvent(MSG.FLOW_RUN_UPDATED, (payload, backendId) => {
    if (payload && typeof payload === "object" && "flowId" in payload) {
        const run = payload as FlowRun;
        applyRunUpdate(backendId, run);
        focusRunningActionTab(run);
    }
});

/** If the flow's current action has a sessionId and its workspace is active, focus the tab. */
function focusRunningActionTab(run: FlowRun): void {
    if (run.status !== "running") return;
    const action = run.actions[run.currentActionIndex];
    if (!action?.sessionId || action.status !== "running") return;

    const workspaceKey = run.taskId
        ? getTaskWorkspaceKey(run.taskId)
        : run.projectId
          ? getProjectWorkspaceKey(run.projectId)
          : null;
    if (!workspaceKey) return;

    // Only focus if the workspace owning this flow is currently active
    const activeTaskId = useTaskStore.getState().activeTaskId;
    const activeProjectId = useUIStore.getState().activeProjectId;
    const isActive = run.taskId
        ? activeTaskId === run.taskId
        : activeProjectId === run.projectId && !activeTaskId;
    if (!isActive) return;

    const sessionStore = useSessionStore.getState();
    const tabs = sessionStore.getTabs(workspaceKey);
    const tab = tabs.find((t) => t.sessionId === action.sessionId);
    if (tab) {
        sessionStore.setActiveTab(workspaceKey, tab.id);
    }
}

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        _unsubFlowRunUpdated();
    });
}

export { useFlowStore, filterByProject, definitionBackend };
