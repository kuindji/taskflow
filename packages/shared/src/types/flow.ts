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

// Exactly one of taskId or projectId must be set
type FlowOwner = { taskId: string; projectId?: never } | { projectId: string; taskId?: never };

interface FlowRun {
    taskId?: string;
    projectId?: string;
    flowId: string;
    status: FlowRunStatus;
    currentActionIndex: number;
    actions: FlowActionState[];
    artifacts: FlowArtifact[];
    startedAt: string;
    completedAt?: string;
}

function getFlowRunOwnerId(run: FlowRun): string {
    const id = run.taskId ?? run.projectId;
    if (!id) throw new Error("FlowRun must have either taskId or projectId");
    return id;
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
    taskId?: string;
    projectId?: string;
    flowId: string;
}

interface FlowOwnerFlowPayload {
    ownerId: string;
    flowId: string;
}

interface FlowJumpToActionPayload {
    ownerId: string;
    flowId: string;
    actionIndex: number;
}

interface FlowOwnerPayload {
    ownerId: string;
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
    FlowOwner,
    FlowRun,
    FlowDefinitionDeletePayload,
    FlowActionDeletePayload,
    FlowStartPayload,
    FlowOwnerFlowPayload,
    FlowJumpToActionPayload,
    FlowOwnerPayload,
};
export { getFlowRunOwnerId };
