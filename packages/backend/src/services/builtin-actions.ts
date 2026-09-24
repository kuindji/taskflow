import {
    BUILTIN_ACTION_DEFAULTS,
    BUILTIN_ACTION_IDS,
    builtinActionFollowsDefaultAgent,
    isAgentType,
    isBuiltinActionId,
    missingPromptVariables,
} from "@taskflow/shared";
import type {
    AgentLaunchOptions,
    BuiltinActionDefinition,
    BuiltinActionId,
    BuiltinActionOverride,
} from "@taskflow/shared";
import type { FlowStore } from "./flow-store";

interface BuiltinActions {
    list(): Promise<BuiltinActionDefinition[]>;
    get(id: BuiltinActionId): Promise<BuiltinActionDefinition>;
    /** Validates `value` as an override, stamps updatedAt, persists it. */
    save(value: unknown): Promise<BuiltinActionDefinition>;
    reset(id: BuiltinActionId): Promise<BuiltinActionDefinition>;
}

interface BuiltinActionsDeps {
    flowStore: FlowStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/** An override in canonical shape, or an error message saying why it is unusable. */
function parseOverride(value: unknown): BuiltinActionOverride | string {
    if (!isRecord(value)) return "A built-in action override must be an object";
    const { id, prompt, sessionType, agentOptions, updatedAt } = value;
    if (!isBuiltinActionId(id)) return `Unknown built-in action "${String(id)}"`;
    if (typeof prompt !== "string" || prompt.trim() === "") return "The prompt must not be empty";
    const missing = missingPromptVariables(prompt, BUILTIN_ACTION_DEFAULTS[id].variables);
    if (missing.length > 0) {
        return `The prompt must include ${missing.map((name) => `{{${name}}}`).join(", ")}`;
    }
    if (sessionType === undefined) {
        if (!builtinActionFollowsDefaultAgent(id))
            return "Choose an agent for this built-in action";
        if (agentOptions !== undefined) return "Agent options need an agent";
        return { id, prompt, updatedAt: typeof updatedAt === "string" ? updatedAt : "" };
    }
    if (!isAgentType(sessionType))
        return `Unsupported agent "${typeof sessionType === "string" ? sessionType : typeof sessionType}"`;
    if (
        agentOptions !== undefined &&
        (!isRecord(agentOptions) || agentOptions.type !== sessionType)
    ) {
        return `Agent options must be for ${sessionType}`;
    }
    return {
        id,
        prompt,
        sessionType,
        // Checked above: an object whose type matches sessionType.
        agentOptions: agentOptions as AgentLaunchOptions | undefined,
        updatedAt: typeof updatedAt === "string" ? updatedAt : "",
    };
}

function merge(
    id: BuiltinActionId,
    override: BuiltinActionOverride | undefined,
): BuiltinActionDefinition {
    const def = BUILTIN_ACTION_DEFAULTS[id];
    if (!override) return { ...def, isModified: false };
    return {
        ...def,
        prompt: override.prompt,
        sessionType: override.sessionType,
        agentOptions: override.agentOptions,
        isModified: true,
        updatedAt: override.updatedAt,
    };
}

function createBuiltinActions({ flowStore }: BuiltinActionsDeps): BuiltinActions {
    async function readOverrides(): Promise<Map<BuiltinActionId, BuiltinActionOverride>> {
        const overrides = new Map<BuiltinActionId, BuiltinActionOverride>();
        for (const entry of await flowStore.getBuiltinActionOverrides()) {
            const parsed = parseOverride(entry);
            if (typeof parsed !== "string") overrides.set(parsed.id, parsed);
        }
        return overrides;
    }

    async function get(id: BuiltinActionId): Promise<BuiltinActionDefinition> {
        return merge(id, (await readOverrides()).get(id));
    }

    return {
        async list() {
            const overrides = await readOverrides();
            return BUILTIN_ACTION_IDS.map((id) => merge(id, overrides.get(id)));
        },
        get,
        async save(value) {
            const parsed = parseOverride(value);
            if (typeof parsed === "string") throw new Error(parsed);
            const override: BuiltinActionOverride = {
                ...parsed,
                updatedAt: new Date().toISOString(),
            };
            await flowStore.saveBuiltinActionOverride(override);
            return merge(override.id, override);
        },
        async reset(id) {
            await flowStore.deleteBuiltinActionOverride(id);
            return merge(id, undefined);
        },
    };
}

export { createBuiltinActions };
export type { BuiltinActions };
