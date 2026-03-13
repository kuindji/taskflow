import type { AgentLaunchOptions } from "./agent";

type SessionType = "claude" | "codex" | "shell";

interface StepDefinition {
    id: string;
    name: string;
    prompt: string;
    sessionType: SessionType;
    agentOptions?: AgentLaunchOptions;
    createdAt: string;
    updatedAt: string;
}

interface StepInline {
    name: string;
    prompt: string;
    sessionType: SessionType;
    agentOptions?: AgentLaunchOptions;
}

interface FlowStepEntryBase {
    id: string;
    label?: string;
}

interface FlowStepReferenceEntry extends FlowStepEntryBase {
    stepId: string;
    inline?: never;
}

interface FlowStepInlineEntry extends FlowStepEntryBase {
    inline: StepInline;
    stepId?: never;
}

type FlowStepEntry = FlowStepReferenceEntry | FlowStepInlineEntry;

interface FlowDefinition {
    id: string;
    name: string;
    description: string;
    steps: FlowStepEntry[];
    createdAt: string;
    updatedAt: string;
}

type FlowRunStatus = "running" | "paused" | "completed" | "failed";
type FlowStepStatus = "pending" | "running" | "completed" | "skipped" | "failed";

interface FlowStepState {
    stepEntryId: string;
    status: FlowStepStatus;
    sessionId?: string;
    startedAt?: string;
    completedAt?: string;
}

// When multiple artifacts share the same type, the latest one wins
interface FlowArtifact {
    type: string;
    path?: string;
    text?: string;
    stepEntryId: string;
    createdAt: string;
}

interface FlowRun {
    taskId: string;
    flowId: string;
    status: FlowRunStatus;
    currentStepIndex: number;
    steps: FlowStepState[];
    artifacts: FlowArtifact[];
    startedAt: string;
    completedAt?: string;
}

// --- Handler payload types ---
// Used by flow WebSocket handlers for type-safe payload access.

interface FlowDefinitionDeletePayload {
    id: string;
}

interface FlowStepDeletePayload {
    id: string;
}

interface FlowStartPayload {
    taskId: string;
    flowId: string;
}

interface FlowTaskFlowPayload {
    taskId: string;
    flowId: string;
}

interface FlowJumpToStepPayload {
    taskId: string;
    flowId: string;
    stepIndex: number;
}

interface FlowTaskPayload {
    taskId: string;
}

export type {
    SessionType,
    StepDefinition,
    StepInline,
    FlowStepEntry,
    FlowDefinition,
    FlowRunStatus,
    FlowStepStatus,
    FlowStepState,
    FlowArtifact,
    FlowRun,
    FlowDefinitionDeletePayload,
    FlowStepDeletePayload,
    FlowStartPayload,
    FlowTaskFlowPayload,
    FlowJumpToStepPayload,
    FlowTaskPayload,
};
