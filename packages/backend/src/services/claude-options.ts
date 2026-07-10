import {
    CLAUDE_EFFORT_LEVELS,
    CLAUDE_PERMISSION_MODES,
    type ClaudeEffortLevel,
    type ClaudeLaunchOptions,
    type ClaudePermissionMode,
} from "@taskflow/shared";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isClaudePermissionMode(value: unknown): value is ClaudePermissionMode {
    return (CLAUDE_PERMISSION_MODES as readonly unknown[]).includes(value);
}

function isClaudeEffortLevel(value: unknown): value is ClaudeEffortLevel {
    return (CLAUDE_EFFORT_LEVELS as readonly unknown[]).includes(value);
}

/** Validate untrusted API/action data and migrate legacy Claude launch options. */
function normalizeClaudeLaunchOptions(value: unknown): ClaudeLaunchOptions | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value) || value.type !== "claude") {
        throw new Error('Claude agentOptions must be an object with type "claude"');
    }

    const result: ClaudeLaunchOptions = { type: "claude" };
    const legacySkip = value.dangerouslySkipPermissions;
    if (legacySkip !== undefined && typeof legacySkip !== "boolean") {
        throw new Error('Claude option "dangerouslySkipPermissions" must be a boolean');
    }

    if (value.permissionMode !== undefined && value.permissionMode !== "default") {
        if (!isClaudePermissionMode(value.permissionMode)) {
            throw new Error(
                `Claude option "permissionMode" must be one of: ${CLAUDE_PERMISSION_MODES.join(", ")}`,
            );
        }
        result.permissionMode = value.permissionMode;
    } else if (legacySkip === true) {
        result.permissionMode = "bypassPermissions";
    }

    if (value.model !== undefined) {
        if (typeof value.model !== "string") {
            throw new Error('Claude option "model" must be a string');
        }
        const model = value.model.trim();
        if (model && model !== "default") result.model = model;
    }

    if (value.effort !== undefined) {
        if (!isClaudeEffortLevel(value.effort)) {
            throw new Error(
                `Claude option "effort" must be one of: ${CLAUDE_EFFORT_LEVELS.join(", ")}`,
            );
        }
        result.effort = value.effort;
    }

    return result;
}

export { isClaudePermissionMode, isClaudeEffortLevel, normalizeClaudeLaunchOptions };
