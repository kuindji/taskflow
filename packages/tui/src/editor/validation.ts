import {
    ALL_AGENT_TYPES,
    CLAUDE_EFFORT_LEVELS,
    CLAUDE_PERMISSION_MODES,
    CODEX_APPROVAL_POLICIES,
    CODEX_REASONING_EFFORTS,
    CODEX_SANDBOX_MODES,
    KIMI_PERMISSION_MODES,
} from "@taskflow/shared";
import type { AgentLaunchOptions, SessionType } from "@taskflow/shared";
import { isAlias, parseDocument, visit } from "yaml";

function record(value: unknown, path = "document"): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${path} must be a mapping`);
    }
    return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
    const unknown = Object.keys(value).find((key) => !allowed.includes(key));
    if (unknown) throw new Error(`${path} has unknown key "${unknown}"`);
}

function requiredString(value: unknown, path: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${path} must be a non-empty string`);
    }
    return value;
}

function optionalString(value: unknown, path: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new Error(`${path} must be a string`);
    return value;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
    return value;
}

function requiredBoolean(value: unknown, path: string): boolean {
    if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
    return value;
}

function positiveNumber(value: unknown, path: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${path} must be a positive number`);
    }
    return value;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], path: string): T {
    if (typeof value !== "string" || !values.includes(value as T)) {
        throw new Error(`${path} must be one of: ${values.join(", ")}`);
    }
    return value as T;
}

function parseYamlMapping(source: string): Record<string, unknown> {
    const document = parseDocument(source, {
        prettyErrors: true,
        uniqueKeys: true,
    });
    if (document.errors.length > 0) throw new Error(document.errors[0]?.message ?? "Invalid YAML");
    let hasAlias = false;
    visit(document, (_key, node) => {
        if (isAlias(node)) hasAlias = true;
    });
    if (hasAlias) throw new Error("YAML aliases are not supported");
    return record(document.toJS({ maxAliasCount: 0 }));
}

function validateAgentOptions(
    value: unknown,
    sessionType: SessionType | undefined,
    path: string,
): AgentLaunchOptions | undefined {
    if (value === undefined) return undefined;
    if (!sessionType || sessionType === "shell") {
        throw new Error(`${path} is only valid for agent session types`);
    }
    const options = record(value, path);
    const type = oneOf(options.type, ALL_AGENT_TYPES, `${path}.type`);
    if (type !== sessionType) {
        throw new Error(`${path}.type must match sessionType "${sessionType}"`);
    }

    switch (type) {
        case "claude":
            exactKeys(options, ["type", "permissionMode", "model", "effort"], path);
            if (options.permissionMode !== undefined)
                oneOf(options.permissionMode, CLAUDE_PERMISSION_MODES, `${path}.permissionMode`);
            optionalString(options.model, `${path}.model`);
            if (options.effort !== undefined)
                oneOf(options.effort, CLAUDE_EFFORT_LEVELS, `${path}.effort`);
            break;
        case "codex":
            exactKeys(
                options,
                [
                    "type",
                    "model",
                    "reasoningEffort",
                    "sandbox",
                    "approvalPolicy",
                    "dangerouslyBypassApprovalsAndSandbox",
                ],
                path,
            );
            optionalString(options.model, `${path}.model`);
            if (options.reasoningEffort !== undefined)
                oneOf(options.reasoningEffort, CODEX_REASONING_EFFORTS, `${path}.reasoningEffort`);
            if (options.sandbox !== undefined)
                oneOf(options.sandbox, CODEX_SANDBOX_MODES, `${path}.sandbox`);
            if (options.approvalPolicy !== undefined)
                oneOf(options.approvalPolicy, CODEX_APPROVAL_POLICIES, `${path}.approvalPolicy`);
            optionalBoolean(
                options.dangerouslyBypassApprovalsAndSandbox,
                `${path}.dangerouslyBypassApprovalsAndSandbox`,
            );
            break;
        case "opencode":
            exactKeys(options, ["type", "model", "autoApprove"], path);
            optionalString(options.model, `${path}.model`);
            optionalBoolean(options.autoApprove, `${path}.autoApprove`);
            break;
        case "pi":
            exactKeys(options, ["type", "model", "thinking", "tools"], path);
            optionalString(options.model, `${path}.model`);
            if (options.thinking !== undefined)
                oneOf(
                    options.thinking,
                    ["off", "minimal", "low", "medium", "high", "xhigh"],
                    `${path}.thinking`,
                );
            optionalString(options.tools, `${path}.tools`);
            break;
        case "kimi":
            exactKeys(options, ["type", "model", "permissionMode"], path);
            optionalString(options.model, `${path}.model`);
            if (options.permissionMode !== undefined)
                oneOf(options.permissionMode, KIMI_PERMISSION_MODES, `${path}.permissionMode`);
            break;
    }
    return options as unknown as AgentLaunchOptions;
}

export {
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
};
