import type { AgentLaunchOptions, AgentType } from "./agent";

type ScheduleSessionType = AgentType | "shell";

interface Schedule {
    id: string;
    projectId: string;
    name: string;
    prompt: string;
    /** Shell script: exit 0 runs, exit 1 skips, other exits fail the check. */
    conditionScript?: string;
    actionId?: string;
    agentType?: ScheduleSessionType;
    agentOptions?: AgentLaunchOptions;

    // Timing tuple: expressionType, expression and enabled. Other edits keep the due time.
    expression: string;
    expressionType: "cron" | "rate";
    timeout: number;
    enabled: boolean;

    lastRunAt: string | null;
    lastError: string | null;
    // Persisted wall-clock due time; authoritative until a run attempt or timing edit.
    nextRunAt: string | null;
    runningSessionId: string | null;

    createdAt: string;
    updatedAt: string;
}

interface ScheduleCreatePayload {
    projectId: string;
    name?: string;
    prompt?: string;
    conditionScript?: string;
    actionId?: string;
    agentType?: ScheduleSessionType;
    agentOptions?: AgentLaunchOptions;
    expression: string;
    expressionType: "cron" | "rate";
    timeout?: number;
    enabled?: boolean;
}

interface ScheduleUpdatePayload {
    id: string;
    projectId?: string;
    name?: string;
    prompt?: string;
    conditionScript?: string | null;
    actionId?: string | null;
    agentType?: ScheduleSessionType | null;
    agentOptions?: AgentLaunchOptions | null;
    expression?: string;
    expressionType?: "cron" | "rate";
    timeout?: number;
    enabled?: boolean;
}

interface ScheduleDeletePayload {
    id: string;
}

interface ScheduleListPayload {
    projectId?: string;
}

interface ScheduleTriggerPayload {
    id: string;
}

export type {
    Schedule,
    ScheduleSessionType,
    ScheduleCreatePayload,
    ScheduleUpdatePayload,
    ScheduleDeletePayload,
    ScheduleListPayload,
    ScheduleTriggerPayload,
};
