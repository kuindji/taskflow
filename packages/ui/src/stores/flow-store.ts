import { create } from "zustand";
import type { FlowDefinition, FlowRun, ActionDefinition } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest, onEvent } from "../hooks/useWebSocket";

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

    startFlow(taskId: string, flowId: string): Promise<FlowRun>;
    stopFlow(taskId: string, flowId: string): Promise<void>;
    pauseFlow(taskId: string, flowId: string): Promise<void>;
    resumeFlow(taskId: string, flowId: string): Promise<void>;
    skipAction(taskId: string, flowId: string): Promise<void>;
    jumpToAction(taskId: string, flowId: string, actionIndex: number): Promise<void>;
    fetchFlowRuns(taskId: string): Promise<void>;

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
            const { actions } = await sendRequest<{ actions: ActionDefinition[] }>(MSG.FLOW_ACTIONS_LIST);
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
                index >= 0
                    ? s.flows.map((f) => (f.id === flow.id ? flow : f))
                    : [...s.flows, flow];
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

    async startFlow(taskId, flowId) {
        const run = await sendRequest<FlowRun>(MSG.FLOW_START, { taskId, flowId });
        set((s) => ({ activeRuns: { ...s.activeRuns, [taskId]: run } }));
        return run;
    },

    async stopFlow(taskId, flowId) {
        await sendRequest(MSG.FLOW_STOP, { taskId, flowId });
    },

    async pauseFlow(taskId, flowId) {
        await sendRequest(MSG.FLOW_PAUSE, { taskId, flowId });
    },

    async resumeFlow(taskId, flowId) {
        await sendRequest(MSG.FLOW_RESUME, { taskId, flowId });
    },

    async skipAction(taskId, flowId) {
        await sendRequest(MSG.FLOW_SKIP_ACTION, { taskId, flowId });
    },

    async jumpToAction(taskId, flowId, actionIndex) {
        await sendRequest(MSG.FLOW_JUMP_TO_ACTION, { taskId, flowId, actionIndex });
    },

    async fetchFlowRuns(taskId) {
        const { runs } = await sendRequest<{ runs: FlowRun[] }>(MSG.FLOW_RUNS_LIST, { taskId });
        const activeRun = runs.find((r) => r.status === "running" || r.status === "paused");
        set((s) => {
            if (activeRun) {
                return { activeRuns: { ...s.activeRuns, [taskId]: activeRun } };
            }
            const { [taskId]: _removed, ...remaining } = s.activeRuns;
            return { activeRuns: remaining };
        });
    },

    applyRunUpdate(run) {
        set((s) => {
            if (run.status === "running" || run.status === "paused") {
                return { activeRuns: { ...s.activeRuns, [run.taskId]: run } };
            }
            const { [run.taskId]: _removed, ...remaining } = s.activeRuns;
            return { activeRuns: remaining };
        });
    },
}));

// Module-level event listener for flow run updates.
// Singleton store — registered once on import.
const _unsubFlowRunUpdated = onEvent(MSG.FLOW_RUN_UPDATED, (payload) => {
    if (payload && typeof payload === "object" && "taskId" in payload) {
        useFlowStore.getState().applyRunUpdate(payload as FlowRun);
    }
});

export { useFlowStore };
