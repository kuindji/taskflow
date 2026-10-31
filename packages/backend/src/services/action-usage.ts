import type { FlowStore } from "./flow-store";
import type { ScheduleStore } from "./schedule-store";

/**
 * Why the action cannot be deleted, or null when nothing runs it. Schedules
 * count too: a schedule whose action is gone has nothing to run.
 */
async function getActionInUseError(
    flowStore: FlowStore,
    scheduleStore: ScheduleStore,
    actionId: string,
): Promise<string | null> {
    const [flows, schedules] = await Promise.all([
        flowStore.getFlowsReferencingAction(actionId),
        scheduleStore.getAll(),
    ]);
    const users = [
        ...flows.map((flow) => flow.name),
        ...schedules
            .filter((schedule) => schedule.actionId === actionId)
            .map((schedule) => `schedule "${schedule.name}"`),
    ];
    if (users.length === 0) return null;
    return `Cannot delete action "${actionId}" because it is used by: ${users.join(", ")}`;
}

export { getActionInUseError };
