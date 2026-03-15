import type { AgentLaunchOptions } from "./agent";

type SessionType = "claude" | "codex" | "shell";

interface ActionDefinition {
    id: string;
    name: string;
    prompt: string;
    sessionType: SessionType;
    agentOptions?: AgentLaunchOptions;
    standalone?: boolean;
    createdAt: string;
    updatedAt: string;
}

interface ActionInline {
    name: string;
    prompt: string;
    sessionType: SessionType;
    agentOptions?: AgentLaunchOptions;
}

interface FlowActionEntryBase {
    id: string;
    label?: string;
}

interface FlowActionReferenceEntry extends FlowActionEntryBase {
    actionId: string;
    inline?: never;
}

interface FlowActionInlineEntry extends FlowActionEntryBase {
    inline: ActionInline;
    actionId?: never;
}

type FlowActionEntry = FlowActionReferenceEntry | FlowActionInlineEntry;

interface FlowDefinition {
    id: string;
    name: string;
    description: string;
    actions: FlowActionEntry[];
    createdAt: string;
    updatedAt: string;
}

type FlowRunStatus = "running" | "paused" | "completed" | "failed";
type FlowActionStatus = "pending" | "running" | "completed" | "skipped" | "failed";

interface FlowActionState {
    actionEntryId: string;
    status: FlowActionStatus;
    sessionId?: string;
    startedAt?: string;
    completedAt?: string;
}

// When multiple artifacts share the same type, the latest one wins
interface FlowArtifact {
    type: string;
    path?: string;
    text?: string;
    actionEntryId: string;
    createdAt: string;
}

interface FlowRun {
    taskId: string;
    flowId: string;
    status: FlowRunStatus;
    currentActionIndex: number;
    actions: FlowActionState[];
    artifacts: FlowArtifact[];
    startedAt: string;
    completedAt?: string;
}

// --- Handler payload types ---
// Used by flow WebSocket handlers for type-safe payload access.

interface FlowDefinitionDeletePayload {
    id: string;
}

interface FlowActionDeletePayload {
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

interface FlowJumpToActionPayload {
    taskId: string;
    flowId: string;
    actionIndex: number;
}

interface FlowTaskPayload {
    taskId: string;
}

export type {
    SessionType,
    ActionDefinition,
    ActionInline,
    FlowActionEntry,
    FlowDefinition,
    FlowRunStatus,
    FlowActionStatus,
    FlowActionState,
    FlowArtifact,
    FlowRun,
    FlowDefinitionDeletePayload,
    FlowActionDeletePayload,
    FlowStartPayload,
    FlowTaskFlowPayload,
    FlowJumpToActionPayload,
    FlowTaskPayload,
};
