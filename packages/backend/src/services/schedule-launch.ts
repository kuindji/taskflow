import { isAgentType } from "@taskflow/shared";
import type {
    ActionDefinition,
    AgentLaunchOptions,
    AppSettings,
    Schedule,
    ScheduleSessionType,
} from "@taskflow/shared";

interface ScheduleLaunch {
    prompt: string;
    sessionType: ScheduleSessionType;
    agentOptions: AgentLaunchOptions | undefined;
}

interface ScheduleLaunchDeps {
    getActions: () => Promise<ActionDefinition[]>;
    getSettings: () => Promise<AppSettings>;
}

/**
 * What a schedule run launches: its action's prompt and agent, or its own.
 * A schedule without an agent runs the machine's Settings default agent.
 */
async function resolveScheduleLaunch(
    schedule: Schedule,
    deps: ScheduleLaunchDeps,
): Promise<ScheduleLaunch> {
    let prompt = schedule.prompt;
    let agentType: string | undefined = schedule.agentType;
    let agentOptions = schedule.agentOptions;

    if (schedule.actionId) {
        const actions = await deps.getActions();
        const action = actions.find((a) => a.id === schedule.actionId);
        // Running the schedule's own (usually empty) prompt instead
        // would launch a session nobody asked for.
        if (!action) throw new Error(`Action not found: ${schedule.actionId}`);
        prompt = action.prompt;
        agentType = action.sessionType;
        agentOptions = action.agentOptions;
    }

    agentType ??= (await deps.getSettings()).general.defaultAgent;
    if (agentType !== "shell" && !isAgentType(agentType)) {
        // Persisted schedules may reference removed agent types;
        // the scheduler records this as the run's lastError.
        throw new Error(`Unsupported agent type: ${agentType}`);
    }
    return { prompt, sessionType: agentType, agentOptions };
}

export { resolveScheduleLaunch };
