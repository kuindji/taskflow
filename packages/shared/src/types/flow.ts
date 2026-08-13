import type { AgentLaunchOptions } from "./agent";

type SessionType = "claude" | "codex" | "opencode" | "pi" | "kimi" | "shell";

interface ActionDefinition {
    id: string;
    projectId?: string;
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

interface FlowInputDefinition {
    id: string;
    label: string;
    type: "text" | "filepath";
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
    projectId?: string;
    name: string;
    description: string;
    actions: FlowActionEntry[];
    inputs?: FlowInputDefinition[];
    // When true, the run restarts from the first action after the last completes
    loop?: boolean;
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
    // The run iteration that produced this value, copied from FlowRun.iteration
    // at save time. Undefined on a non-looped run, which has no iterations.
    // Lets a retry tell its own partial output apart from a completed value
    // carried over from an earlier iteration.
    iteration?: number;
    createdAt: string;
}

const MASTER_OWNER_ID = "__master__";

// Exactly one of taskId, projectId, or master must be set
type FlowOwner =
    | { taskId: string; projectId?: never; master?: never }
    | { projectId: string; taskId?: never; master?: never }
    | { master: true; taskId?: never; projectId?: never };

type FlowRun = FlowOwner & {
    flowId: string;
    status: FlowRunStatus;
    currentActionIndex: number;
    actions: FlowActionState[];
    artifacts: FlowArtifact[];
    inputValues?: Record<string, string>;
    // Snapshot of the definition's loop flag, taken at start. The runner reads
    // this, never the live definition, so editing a flow mid-run cannot change
    // the behaviour of a run already in flight.
    loop?: boolean;
    // 1-based; undefined means iteration 1
    iteration?: number;
    startedAt: string;
    completedAt?: string;
};

function getFlowRunOwnerId(run: FlowRun): string {
    if (run.taskId) return run.taskId;
    if (run.projectId) return run.projectId;
    if (run.master) return MASTER_OWNER_ID;
    throw new Error("FlowRun must have taskId, projectId, or master");
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
    master?: true;
    flowId: string;
    inputValues?: Record<string, string>;
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
    FlowInputDefinition,
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
export { MASTER_OWNER_ID, getFlowRunOwnerId };
