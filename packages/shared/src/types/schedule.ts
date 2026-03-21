import type { AgentLaunchOptions, AgentType } from "./agent";

interface Schedule {
    id: string;
    projectId: string;
    name: string;
    prompt: string;
    agentType?: AgentType;
    agentOptions?: AgentLaunchOptions;

    expression: string;
    expressionType: "cron" | "rate";
    timeout: number;
    enabled: boolean;

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
    prompt: string;
    agentType?: AgentType;
    agentOptions?: AgentLaunchOptions;
    expression: string;
    expressionType: "cron" | "rate";
    timeout?: number;
    enabled?: boolean;
}

interface ScheduleUpdatePayload {
    id: string;
    name?: string;
    prompt?: string;
    agentType?: AgentType | null;
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
    ScheduleCreatePayload,
    ScheduleUpdatePayload,
    ScheduleDeletePayload,
    ScheduleListPayload,
    ScheduleTriggerPayload,
};
