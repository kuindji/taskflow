import { MSG } from "@taskflow/shared";
import type {
    FlowDefinition,
    FlowDefinitionDeletePayload,
    FlowActionDeletePayload,
    FlowStartPayload,
    FlowOwnerFlowPayload,
    FlowJumpToActionPayload,
    FlowOwnerPayload,
    ActionDefinition,
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
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T narrows payload inside each handler callback
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

    router.register(MSG.FLOW_ACTIONS_LIST, async () => {
        return { actions: await flowStore.getActions() };
    });

    router.register(
        MSG.FLOW_DEFINITION_SAVE,
        typed<FlowDefinition>(async (payload) => {
            await flowStore.saveFlow(payload);
            return payload;
        }),
    );

    router.register(
        MSG.FLOW_ACTION_SAVE,
        typed<ActionDefinition>(async (payload) => {
            await flowStore.saveAction(payload);
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
        MSG.FLOW_ACTION_DELETE,
        typed<FlowActionDeletePayload>(async (payload) => {
            const referencingFlows = await flowStore.getFlowsReferencingAction(payload.id);
            if (referencingFlows.length > 0) {
                throw new Error(
                    `Cannot delete action "${payload.id}" because it is used by: ${referencingFlows.map((flow) => flow.name).join(", ")}`,
                );
            }
            await flowStore.deleteAction(payload.id);
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
            const owner = payload.taskId
                ? { taskId: payload.taskId } as const
                : { projectId: payload.projectId! } as const;
            return await flowRunner.startFlow(owner, flow);
        }),
    );

    router.register(
        MSG.FLOW_STOP,
        typed<FlowOwnerFlowPayload>(async (payload) => {
            await flowRunner.stopFlow(payload.ownerId, payload.flowId);
            return { success: true };
        }),
    );

    router.register(
        MSG.FLOW_PAUSE,
        typed<FlowOwnerFlowPayload>(async (payload) => {
            await flowRunner.pauseFlow(payload.ownerId, payload.flowId);
            return { success: true };
        }),
    );

    router.register(
        MSG.FLOW_RESUME,
        typed<FlowOwnerFlowPayload>(async (payload) => {
            await flowRunner.resumeFlow(payload.ownerId, payload.flowId);
            return { success: true };
        }),
    );

    router.register(
        MSG.FLOW_SKIP_ACTION,
        typed<FlowOwnerFlowPayload>(async (payload) => {
            await flowRunner.skipAction(payload.ownerId, payload.flowId);
            return { success: true };
        }),
    );

    router.register(
        MSG.FLOW_JUMP_TO_ACTION,
        typed<FlowJumpToActionPayload>(async (payload) => {
            await flowRunner.jumpToAction(payload.ownerId, payload.flowId, payload.actionIndex);
            return { success: true };
        }),
    );

    router.register(
        MSG.FLOW_RUN_GET,
        typed<FlowOwnerFlowPayload>(async (payload) => {
            return await flowStore.getFlowRun(payload.ownerId, payload.flowId);
        }),
    );

    router.register(
        MSG.FLOW_RUNS_LIST,
        typed<FlowOwnerPayload>(async (payload) => {
            return { runs: await flowStore.getFlowRunsForOwner(payload.ownerId) };
        }),
    );
}

export { registerFlowHandlers };
export type { FlowHandlerDeps };
