import { randomUUID } from "crypto";
import {
    ALL_AGENT_TYPES,
    CLAUDE_EFFORT_LEVELS,
    CLAUDE_PERMISSION_MODES,
    CODEX_APPROVAL_POLICIES,
    CODEX_REASONING_EFFORTS,
    CODEX_SANDBOX_MODES,
    KIMI_PERMISSION_MODES,
} from "@taskflow/shared";
import type {
    ActionDefinition,
    ActionInline,
    AgentLaunchOptions,
    FlowActionEntry,
    FlowDefinition,
    FlowInputDefinition,
    Schedule,
    ScheduleCreatePayload,
    ScheduleSessionType,
    ScheduleUpdatePayload,
    SessionType,
} from "@taskflow/shared";
import { stringify } from "yaml";
import {
    exactKeys,
    oneOf,
    optionalBoolean,
    optionalString,
    parseYamlMapping,
    positiveNumber,
    record,
    requiredBoolean,
    requiredString,
    validateAgentOptions,
} from "./validation";

interface ActionDraft {
    projectId?: string;
    name: string;
    prompt: string;
    sessionType: SessionType;
    agentOptions?: AgentLaunchOptions;
    standalone?: boolean;
}

interface FlowDraft {
    projectId?: string;
    name: string;
    description: string;
    actions: FlowActionEntry[];
    inputs?: FlowInputDefinition[];
    loop?: boolean;
}

interface ScheduleDraft {
    projectId?: string;
    name: string;
    prompt?: string;
    actionId?: string;
    agentType?: ScheduleSessionType;
    agentOptions?: AgentLaunchOptions;
    expression: string;
    expressionType: "cron" | "rate";
    timeout: number;
    enabled: boolean;
}

interface RecordValidationContext {
    projectId: string | null;
    projectIds?: readonly string[];
    visibleActions: readonly ActionDefinition[];
}

interface MetadataFactory {
    now(): string;
    uuid(): string;
}

const defaultMetadataFactory: MetadataFactory = {
    now: () => new Date().toISOString(),
    uuid: () => randomUUID(),
};

function validateProjectId(
    value: unknown,
    context: RecordValidationContext,
    allowListedProject = false,
): string | undefined {
    const projectId = optionalString(value, "projectId");
    if (allowListedProject && projectId && context.projectIds?.includes(projectId))
        return projectId;
    if (projectId !== undefined && projectId !== context.projectId) {
        throw new Error(
            `projectId must match the selected project "${context.projectId ?? "global"}"`,
        );
    }
    if (context.projectId === null && projectId !== undefined) {
        throw new Error("project records cannot be edited from the master workspace");
    }
    return projectId;
}

function parseActionDraft(source: string, context: RecordValidationContext): ActionDraft {
    const value = parseYamlMapping(source);
    exactKeys(
        value,
        ["projectId", "name", "prompt", "sessionType", "agentOptions", "standalone"],
        "action",
    );
    const sessionType = oneOf(value.sessionType, [...ALL_AGENT_TYPES, "shell"], "sessionType");
    return {
        projectId: validateProjectId(value.projectId, context),
        name: requiredString(value.name, "name"),
        prompt: requiredString(value.prompt, "prompt"),
        sessionType,
        agentOptions: validateAgentOptions(value.agentOptions, sessionType, "agentOptions"),
        standalone: optionalBoolean(value.standalone, "standalone"),
    };
}

function parseInlineAction(value: unknown, path: string): ActionInline {
    const inline = record(value, path);
    exactKeys(inline, ["name", "prompt", "sessionType", "agentOptions"], path);
    const sessionType = oneOf(
        inline.sessionType,
        [...ALL_AGENT_TYPES, "shell"],
        `${path}.sessionType`,
    );
    return {
        name: requiredString(inline.name, `${path}.name`),
        prompt: requiredString(inline.prompt, `${path}.prompt`),
        sessionType,
        agentOptions: validateAgentOptions(
            inline.agentOptions,
            sessionType,
            `${path}.agentOptions`,
        ),
    };
}

function parseFlowDraft(source: string, context: RecordValidationContext): FlowDraft {
    const value = parseYamlMapping(source);
    exactKeys(value, ["projectId", "name", "description", "actions", "inputs", "loop"], "flow");
    if (!Array.isArray(value.actions) || value.actions.length === 0) {
        throw new Error("actions must contain at least one entry");
    }
    const actionEntryIds = new Set<string>();
    const actions = value.actions.map((raw, index): FlowActionEntry => {
        const path = `actions[${index}]`;
        const entry = record(raw, path);
        exactKeys(entry, ["id", "label", "actionId", "inline"], path);
        const id = requiredString(entry.id, `${path}.id`);
        if (actionEntryIds.has(id)) throw new Error(`actions has duplicate entry id "${id}"`);
        actionEntryIds.add(id);
        const label = optionalString(entry.label, `${path}.label`);
        const hasActionId = entry.actionId !== undefined;
        const hasInline = entry.inline !== undefined;
        if (hasActionId === hasInline) {
            throw new Error(`${path} must define exactly one of actionId or inline`);
        }
        if (hasActionId) {
            const actionId = requiredString(entry.actionId, `${path}.actionId`);
            if (!context.visibleActions.some((action) => action.id === actionId)) {
                throw new Error(`${path}.actionId references an action that is not visible`);
            }
            return { id, label, actionId };
        }
        return { id, label, inline: parseInlineAction(entry.inline, `${path}.inline`) };
    });

    let inputs: FlowInputDefinition[] | undefined;
    if (value.inputs !== undefined) {
        if (!Array.isArray(value.inputs)) throw new Error("inputs must be a sequence");
        const inputIds = new Set<string>();
        inputs = value.inputs.map((raw, index) => {
            const path = `inputs[${index}]`;
            const input = record(raw, path);
            exactKeys(input, ["id", "label", "type"], path);
            const id = requiredString(input.id, `${path}.id`);
            if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
                throw new Error(
                    `${path}.id may contain only letters, numbers, hyphens, and underscores`,
                );
            }
            if (inputIds.has(id)) throw new Error(`inputs has duplicate id "${id}"`);
            inputIds.add(id);
            return {
                id,
                label: requiredString(input.label, `${path}.label`),
                type: oneOf(input.type, ["text", "filepath"], `${path}.type`),
            };
        });
    }

    return {
        projectId: validateProjectId(value.projectId, context),
        name: requiredString(value.name, "name"),
        description: optionalString(value.description, "description") ?? "",
        actions,
        inputs,
        loop: optionalBoolean(value.loop, "loop"),
    };
}

function parseScheduleDraft(
    source: string,
    context: RecordValidationContext,
    creating: boolean,
): ScheduleDraft {
    const value = parseYamlMapping(source);
    exactKeys(
        value,
        [
            "projectId",
            "name",
            "prompt",
            "actionId",
            "agentType",
            "agentOptions",
            "expression",
            "expressionType",
            "timeout",
            "enabled",
        ],
        "schedule",
    );
    const projectId = validateProjectId(value.projectId, context, creating);
    if (creating && !projectId) throw new Error("projectId is required when creating a schedule");
    if (!creating && value.projectId !== undefined) {
        throw new Error("projectId is immutable and must be omitted when editing a schedule");
    }
    const prompt = optionalString(value.prompt, "prompt");
    const actionId = optionalString(value.actionId, "actionId");
    if (Boolean(prompt?.trim()) === Boolean(actionId?.trim())) {
        throw new Error("schedule must define exactly one of prompt or actionId");
    }
    const selectedAction = actionId
        ? context.visibleActions.find((action) => action.id === actionId)
        : undefined;
    const scheduleProjectId = projectId ?? context.projectId;
    if (
        actionId &&
        (!selectedAction ||
            !selectedAction.standalone ||
            (selectedAction.projectId !== undefined &&
                selectedAction.projectId !== scheduleProjectId))
    ) {
        throw new Error("actionId must reference a visible standalone action");
    }
    const agentType =
        value.agentType === undefined
            ? undefined
            : oneOf(value.agentType, [...ALL_AGENT_TYPES, "shell"], "agentType");
    return {
        projectId,
        name: requiredString(value.name, "name"),
        prompt: prompt?.trim() ? prompt : undefined,
        actionId,
        agentType,
        agentOptions: validateAgentOptions(value.agentOptions, agentType, "agentOptions"),
        expression: requiredString(value.expression, "expression"),
        expressionType: oneOf(value.expressionType, ["cron", "rate"], "expressionType"),
        timeout: positiveNumber(value.timeout, "timeout"),
        enabled: requiredBoolean(value.enabled, "enabled"),
    };
}

function actionRecord(
    draft: ActionDraft,
    existing?: ActionDefinition,
    metadata: MetadataFactory = defaultMetadataFactory,
): ActionDefinition {
    const now = metadata.now();
    return {
        id: existing?.id ?? metadata.uuid(),
        ...draft,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
}

function flowRecord(
    draft: FlowDraft,
    existing?: FlowDefinition,
    metadata: MetadataFactory = defaultMetadataFactory,
): FlowDefinition {
    const now = metadata.now();
    return {
        id: existing?.id ?? metadata.uuid(),
        ...draft,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
}

function schedulePayload(
    draft: ScheduleDraft,
    existing?: Schedule,
): ScheduleCreatePayload | ScheduleUpdatePayload {
    if (!existing) {
        if (!draft.projectId) throw new Error("projectId is required when creating a schedule");
        return { ...draft, projectId: draft.projectId };
    }
    return {
        id: existing.id,
        name: draft.name,
        prompt: draft.prompt ?? "",
        actionId: draft.actionId ?? null,
        agentType: draft.agentType ?? null,
        agentOptions: draft.agentOptions ?? null,
        expression: draft.expression,
        expressionType: draft.expressionType,
        timeout: draft.timeout,
        enabled: draft.enabled,
    };
}

const ENUM_COMMENTS = [
    `# sessionType and agentType: ${[...ALL_AGENT_TYPES, "shell"].join(", ")}`,
    `# Claude permissionMode: ${CLAUDE_PERMISSION_MODES.join(", ")}`,
    `# Claude effort: ${CLAUDE_EFFORT_LEVELS.join(", ")}`,
    `# Codex reasoningEffort: ${CODEX_REASONING_EFFORTS.join(", ")}`,
    `# Codex sandbox: ${CODEX_SANDBOX_MODES.join(", ")}`,
    `# Codex approvalPolicy: ${CODEX_APPROVAL_POLICIES.join(", ")}`,
    `# Kimi permissionMode: ${KIMI_PERMISSION_MODES.join(", ")}`,
];

function yamlWithComments(value: object, comments: readonly string[]): string {
    return `${comments.join("\n")}\n${stringify(value, { lineWidth: 0 })}`;
}

function serializeAction(recordValue: ActionDraft | ActionDefinition): string {
    const { projectId, name, prompt, sessionType, agentOptions, standalone } = recordValue;
    return yamlWithComments(
        { projectId, name, prompt, sessionType, agentOptions, standalone },
        ENUM_COMMENTS,
    );
}

function serializeFlow(
    recordValue: FlowDraft | FlowDefinition,
    visibleActions: readonly ActionDefinition[],
): string {
    const { projectId, name, description, actions, inputs, loop } = recordValue;
    const actionComments = visibleActions.map((action) => `# action ${action.id}: ${action.name}`);
    return yamlWithComments({ projectId, name, description, inputs, loop, actions }, [
        ...ENUM_COMMENTS,
        "# input type: text, filepath",
        ...actionComments,
    ]);
}

function serializeSchedule(recordValue: ScheduleDraft | Schedule, creating: boolean): string {
    const {
        projectId,
        name,
        prompt,
        actionId,
        agentType,
        agentOptions,
        expression,
        expressionType,
        timeout,
        enabled,
    } = recordValue;
    return yamlWithComments(
        {
            projectId: creating ? projectId : undefined,
            name,
            prompt: prompt || undefined,
            actionId,
            agentType,
            agentOptions,
            expression,
            expressionType,
            timeout,
            enabled,
        },
        [...ENUM_COMMENTS, "# expressionType: cron, rate"],
    );
}

export {
    actionRecord,
    flowRecord,
    parseActionDraft,
    parseFlowDraft,
    parseScheduleDraft,
    schedulePayload,
    serializeAction,
    serializeFlow,
    serializeSchedule,
};
export type { ActionDraft, FlowDraft, MetadataFactory, RecordValidationContext, ScheduleDraft };
