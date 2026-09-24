import type { AgentLaunchOptions, AgentType } from "./agent";

const BUILTIN_ACTION_IDS = [
    "builtin:task-title",
    "builtin:schedule-name",
    "builtin:commit-message",
    "builtin:commit",
] as const;

type BuiltinActionId = (typeof BUILTIN_ACTION_IDS)[number];

/** Built-ins that run one-shot and return text, as opposed to opening a session. */
type HeadlessBuiltinActionId = Exclude<BuiltinActionId, "builtin:commit">;

type BuiltinActionMode = "headless" | "session";

interface BuiltinActionVariable {
    /** Placeholder name, written as {{name}} in the prompt. */
    name: string;
    description: string;
}

/** What each built-in's prompt receives at run time, keyed by placeholder name. */
interface BuiltinActionVariableValues {
    "builtin:task-title": { description: string };
    "builtin:schedule-name": { prompt: string };
    "builtin:commit-message": { diff: string };
    "builtin:commit": { instructions: string };
}

/** Code-owned default. Never persisted. */
interface BuiltinActionDefault {
    id: BuiltinActionId;
    name: string;
    description: string;
    mode: BuiltinActionMode;
    prompt: string;
    /** Undefined means the machine's default agent (settings.general.defaultAgent). */
    sessionType?: AgentType;
    agentOptions?: AgentLaunchOptions;
    /** Every listed variable is required in the prompt. */
    variables: BuiltinActionVariable[];
}

/** The user's change, persisted as a full snapshot. Deleting it resets to the default. */
interface BuiltinActionOverride {
    id: BuiltinActionId;
    prompt: string;
    sessionType?: AgentType;
    agentOptions?: AgentLaunchOptions;
    updatedAt: string;
}

/** Effective definition: the default merged with the override, if any. */
interface BuiltinActionDefinition extends BuiltinActionDefault {
    isModified: boolean;
    updatedAt?: string;
}

interface BuiltinActionResetPayload {
    id: BuiltinActionId;
}

export type {
    BuiltinActionId,
    HeadlessBuiltinActionId,
    BuiltinActionMode,
    BuiltinActionVariable,
    BuiltinActionVariableValues,
    BuiltinActionDefault,
    BuiltinActionOverride,
    BuiltinActionDefinition,
    BuiltinActionResetPayload,
};
export { BUILTIN_ACTION_IDS };
