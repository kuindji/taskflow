import { create } from "zustand";
import type { FlowDefinition, FlowRun, ActionDefinition } from "@taskflow/shared";
import { MSG, getFlowRunOwnerId } from "@taskflow/shared";
import { sendRequest, onEvent } from "../hooks/useWebSocket";
import { useSessionStore } from "./session-store";
import { useTaskStore } from "./task-store";
import { useUIStore } from "./ui-store";
import { getTaskWorkspaceKey, getProjectWorkspaceKey } from "@/hooks/useActiveWorkspace";

/**
 * Returns global items (no projectId) when projectId is nullish,
 * or global + matching-project items when projectId is provided.
 */
function filterByProject<T extends { projectId?: string }>(
    items: T[],
    projectId: string | null | undefined,
): T[] {
    if (!projectId) return items.filter((item) => !item.projectId);
    return items.filter((item) => !item.projectId || item.projectId === projectId);
}

interface FlowStartParams {
    taskId?: string;
    projectId?: string;
    flowId: string;
}

interface FlowStore {
    flows: FlowDefinition[];
    actions: ActionDefinition[];
    loadingDefinitions: boolean;
    definitionLoadCount: number;
    activeRuns: Record<string, FlowRun>;

    fetchFlows(): Promise<void>;
    fetchActions(): Promise<void>;
    saveFlow(flow: FlowDefinition): Promise<void>;
    saveAction(action: ActionDefinition): Promise<void>;
    deleteFlow(id: string): Promise<void>;
    deleteAction(id: string): Promise<void>;

    startFlow(params: FlowStartParams): Promise<FlowRun>;
    stopFlow(ownerId: string, flowId: string): Promise<void>;
    pauseFlow(ownerId: string, flowId: string): Promise<void>;
    resumeFlow(ownerId: string, flowId: string): Promise<void>;
    skipAction(ownerId: string, flowId: string): Promise<void>;
    jumpToAction(ownerId: string, flowId: string, actionIndex: number): Promise<void>;
    fetchFlowRuns(ownerId: string): Promise<void>;

    applyRunUpdate(run: FlowRun): void;
}

const useFlowStore = create<FlowStore>((set) => ({
    flows: [],
    actions: [],
    loadingDefinitions: false,
    definitionLoadCount: 0,
    activeRuns: {},

    async fetchFlows() {
        set((state) => ({
            definitionLoadCount: state.definitionLoadCount + 1,
            loadingDefinitions: true,
        }));
        try {
            const { flows } = await sendRequest<{ flows: FlowDefinition[] }>(
                MSG.FLOW_DEFINITIONS_LIST,
            );
            set({ flows });
        } finally {
            set((state) => {
                const definitionLoadCount = Math.max(0, state.definitionLoadCount - 1);
                return {
                    definitionLoadCount,
                    loadingDefinitions: definitionLoadCount > 0,
                };
            });
        }
    },

    async fetchActions() {
        set((state) => ({
            definitionLoadCount: state.definitionLoadCount + 1,
            loadingDefinitions: true,
        }));
        try {
            const { actions } = await sendRequest<{ actions: ActionDefinition[] }>(
                MSG.FLOW_ACTIONS_LIST,
            );
            set({ actions });
        } finally {
            set((state) => {
                const definitionLoadCount = Math.max(0, state.definitionLoadCount - 1);
                return {
                    definitionLoadCount,
                    loadingDefinitions: definitionLoadCount > 0,
                };
            });
        }
    },

    async saveFlow(flow) {
        await sendRequest(MSG.FLOW_DEFINITION_SAVE, flow);
        set((s) => {
            const index = s.flows.findIndex((f) => f.id === flow.id);
            const flows =
                index >= 0 ? s.flows.map((f) => (f.id === flow.id ? flow : f)) : [...s.flows, flow];
            return { flows };
        });
    },

    async saveAction(action) {
        await sendRequest(MSG.FLOW_ACTION_SAVE, action);
        set((s) => {
            const index = s.actions.findIndex((a) => a.id === action.id);
            const actions =
                index >= 0
                    ? s.actions.map((a) => (a.id === action.id ? action : a))
                    : [...s.actions, action];
            return { actions };
        });
    },

    async deleteFlow(id) {
        await sendRequest(MSG.FLOW_DEFINITION_DELETE, { id });
        set((s) => ({ flows: s.flows.filter((f) => f.id !== id) }));
    },

    async deleteAction(id) {
        await sendRequest(MSG.FLOW_ACTION_DELETE, { id });
        set((s) => ({ actions: s.actions.filter((a) => a.id !== id) }));
    },

    async startFlow(params) {
        const run = await sendRequest<FlowRun>(MSG.FLOW_START, params);
        const ownerId = getFlowRunOwnerId(run);
        set((s) => ({ activeRuns: { ...s.activeRuns, [ownerId]: run } }));
        return run;
    },

    async stopFlow(ownerId, flowId) {
        await sendRequest(MSG.FLOW_STOP, { ownerId, flowId });
    },

    async pauseFlow(ownerId, flowId) {
        await sendRequest(MSG.FLOW_PAUSE, { ownerId, flowId });
    },

    async resumeFlow(ownerId, flowId) {
        await sendRequest(MSG.FLOW_RESUME, { ownerId, flowId });
    },

    async skipAction(ownerId, flowId) {
        await sendRequest(MSG.FLOW_SKIP_ACTION, { ownerId, flowId });
    },

    async jumpToAction(ownerId, flowId, actionIndex) {
        await sendRequest(MSG.FLOW_JUMP_TO_ACTION, { ownerId, flowId, actionIndex });
    },

    async fetchFlowRuns(ownerId) {
        const { runs } = await sendRequest<{ runs: FlowRun[] }>(MSG.FLOW_RUNS_LIST, { ownerId });
        const activeRun = runs.find((r) => r.status === "running" || r.status === "paused");
        set((s) => {
            if (activeRun) {
                return { activeRuns: { ...s.activeRuns, [ownerId]: activeRun } };
            }
            const { [ownerId]: _removed, ...remaining } = s.activeRuns;
            return { activeRuns: remaining };
        });
    },

    applyRunUpdate(run) {
        set((s) => {
            const ownerId = getFlowRunOwnerId(run);
            // Only update if we're already tracking this owner's run
            // (don't add completed runs we weren't watching)
            if (run.status === "running" || run.status === "paused" || s.activeRuns[ownerId]) {
                return { activeRuns: { ...s.activeRuns, [ownerId]: run } };
            }
            return s;
        });
    },
}));

// Module-level event listener for flow run updates.
// Singleton store — registered once on import.
const _unsubFlowRunUpdated = onEvent(MSG.FLOW_RUN_UPDATED, (payload) => {
    if (payload && typeof payload === "object" && "flowId" in payload) {
        const run = payload as FlowRun;
        useFlowStore.getState().applyRunUpdate(run);
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

export { useFlowStore, filterByProject };
