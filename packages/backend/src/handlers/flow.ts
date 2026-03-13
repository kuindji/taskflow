import { MSG } from "@taskflow/shared";
import type {
    FlowDefinition,
    FlowDefinitionDeletePayload,
    FlowStepDeletePayload,
    FlowStartPayload,
    FlowTaskFlowPayload,
    FlowJumpToStepPayload,
    FlowTaskPayload,
    StepDefinition,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { FlowStore } from "../services/flow-store";
import type { FlowRunner } from "../services/flow-runner";

interface FlowHandlerDeps {
    router: Router;
    flowStore: FlowStore;
    flowRunner: FlowRunner;
}

// Narrow payload types without `as any` — the router handler signature is
// (payload: unknown) => Promise<unknown>, so this cast is safe at the boundary.
function typed<T>(
    handler: (payload: T) => Promise<unknown>,
): (payload: unknown) => Promise<unknown> {
    return handler as (payload: unknown) => Promise<unknown>;
}

function registerFlowHandlers(deps: FlowHandlerDeps): void {
    const { router, flowStore, flowRunner } = deps;

    // --- Definitions ---

    router.register(MSG.FLOW_DEFINITIONS_LIST, async () => {
        return { flows: await flowStore.getFlows() };
    });

    router.register(MSG.FLOW_STEPS_LIST, async () => {
        return { steps: await flowStore.getSteps() };
    });

    router.register(
        MSG.FLOW_DEFINITION_SAVE,
        typed<FlowDefinition>(async (payload) => {
            await flowStore.saveFlow(payload);
            return payload;
        }),
    );

    router.register(
        MSG.FLOW_STEP_SAVE,
        typed<StepDefinition>(async (payload) => {
            await flowStore.saveStep(payload);
            return payload;
        }),
    );

    router.register(
        MSG.FLOW_DEFINITION_DELETE,
        typed<FlowDefinitionDeletePayload>(async (payload) => {
            await flowStore.deleteFlow(payload.id);
            return { success: true };
        }),
    );

    router.register(
        MSG.FLOW_STEP_DELETE,
        typed<FlowStepDeletePayload>(async (payload) => {
            const referencingFlows = await flowStore.getFlowsReferencingStep(payload.id);
            if (referencingFlows.length > 0) {
                throw new Error(
                    `Cannot delete step "${payload.id}" because it is used by: ${referencingFlows.map((flow) => flow.name).join(", ")}`,
                );
            }
            await flowStore.deleteStep(payload.id);
            return { success: true };
        }),
    );

    // --- Execution ---

    router.register(
        MSG.FLOW_START,
        typed<FlowStartPayload>(async (payload) => {
            const flows = await flowStore.getFlows();
            const flow = flows.find((f) => f.id === payload.flowId);
            if (!flow) throw new Error(`Flow not found: ${payload.flowId}`);
            return await flowRunner.startFlow(payload.taskId, flow);
        }),
    );

    router.register(
        MSG.FLOW_STOP,
        typed<FlowTaskFlowPayload>(async (payload) => {
            await flowRunner.stopFlow(payload.taskId, payload.flowId);
            return { success: true };
        }),
    );

    router.register(
        MSG.FLOW_PAUSE,
        typed<FlowTaskFlowPayload>(async (payload) => {
            await flowRunner.pauseFlow(payload.taskId, payload.flowId);
            return { success: true };
        }),
    );

    router.register(
        MSG.FLOW_RESUME,
        typed<FlowTaskFlowPayload>(async (payload) => {
            await flowRunner.resumeFlow(payload.taskId, payload.flowId);
            return { success: true };
        }),
    );

    router.register(
        MSG.FLOW_SKIP_STEP,
        typed<FlowTaskFlowPayload>(async (payload) => {
            await flowRunner.skipStep(payload.taskId, payload.flowId);
            return { success: true };
        }),
    );

    router.register(
        MSG.FLOW_JUMP_TO_STEP,
        typed<FlowJumpToStepPayload>(async (payload) => {
            await flowRunner.jumpToStep(payload.taskId, payload.flowId, payload.stepIndex);
            return { success: true };
        }),
    );

    router.register(
        MSG.FLOW_RUN_GET,
        typed<FlowTaskFlowPayload>(async (payload) => {
            return await flowStore.getFlowRun(payload.taskId, payload.flowId);
        }),
    );

    router.register(
        MSG.FLOW_RUNS_LIST,
        typed<FlowTaskPayload>(async (payload) => {
            return { runs: await flowStore.getFlowRunsForTask(payload.taskId) };
        }),
    );
}

export { registerFlowHandlers };
export type { FlowHandlerDeps };
