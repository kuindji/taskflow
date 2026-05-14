import type { AgentLaunchOptions, AgentType } from "./agent";

type ScheduleSessionType = AgentType | "shell";

type ScheduleExecutionMode = "background" | "foreground";

interface Schedule {
    id: string;
    projectId: string;
    name: string;
    prompt: string;
    actionId?: string;
    agentType?: ScheduleSessionType;
    agentOptions?: AgentLaunchOptions;

    expression: string;
    expressionType: "cron" | "rate";
    timeout: number;
    enabled: boolean;
    executionMode?: ScheduleExecutionMode;

    lastRunAt: string | null;
    lastError: string | null;
    nextRunAt: string | null;
    runningSessionId: string | null;

    createdAt: string;
    updatedAt: string;
}

interface ScheduleCreatePayload {
    projectId: string;
    name?: string;
    prompt?: string;
    actionId?: string;
    agentType?: ScheduleSessionType;
    agentOptions?: AgentLaunchOptions;
    expression: string;
    expressionType: "cron" | "rate";
    timeout?: number;
    enabled?: boolean;
    executionMode?: ScheduleExecutionMode;
}

interface ScheduleUpdatePayload {
    id: string;
    name?: string;
    prompt?: string;
    actionId?: string | null;
    agentType?: ScheduleSessionType | null;
    agentOptions?: AgentLaunchOptions | null;
    expression?: string;
    expressionType?: "cron" | "rate";
    timeout?: number;
    enabled?: boolean;
    executionMode?: ScheduleExecutionMode;
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
    ScheduleExecutionMode,
    ScheduleCreatePayload,
    ScheduleUpdatePayload,
    ScheduleDeletePayload,
    ScheduleListPayload,
    ScheduleTriggerPayload,
};
