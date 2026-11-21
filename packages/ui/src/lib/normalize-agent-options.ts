import type { AgentLaunchOptions, AgentType } from "@taskflow/shared";
import type { SessionType } from "@taskflow/shared";
import {
    ANTIGRAVITY_EFFORT_LEVELS,
    ANTIGRAVITY_MODES,
    KIMI_PERMISSION_MODES,
} from "@taskflow/shared";

/**
 * Normalize agent options for a given agent/session type.
 * Accepts both `AgentType` (schedule context) and `SessionType` (flow context).
 * Returns `undefined` for "shell" or empty type, or when the current options
 * don't match the requested type.
 */
function normalizeAgentOptions(
    agentType: AgentType | SessionType | "",
    agentOptions: AgentLaunchOptions | undefined,
): AgentLaunchOptions | undefined {
    if (!agentType || agentType === "shell") return undefined;
    if (!agentOptions || agentOptions.type !== agentType) return undefined;

    switch (agentType) {
        case "claude": {
            if (agentOptions.type !== "claude") return undefined;
            const legacyClaudeOptions = agentOptions as typeof agentOptions & {
                dangerouslySkipPermissions?: unknown;
            };
            return {
                type: "claude",
                permissionMode:
                    agentOptions.permissionMode ??
                    (legacyClaudeOptions.dangerouslySkipPermissions === true
                        ? "bypassPermissions"
                        : undefined),
                model: agentOptions.model,
                effort: agentOptions.effort,
                account: agentOptions.account,
            };
        }
        case "codex":
            if (agentOptions.type !== "codex") return undefined;
            return {
                type: "codex",
                model: agentOptions.model,
                reasoningEffort: agentOptions.reasoningEffort,
                sandbox: agentOptions.sandbox,
                approvalPolicy: agentOptions.approvalPolicy,
                // An explicit false must survive: omitted falls back to the machine default.
                dangerouslyBypassApprovalsAndSandbox:
                    agentOptions.dangerouslyBypassApprovalsAndSandbox,
                account: agentOptions.account,
            };
        case "opencode":
            if (agentOptions.type !== "opencode") return undefined;
            return {
                type: "opencode",
                model: agentOptions.model,
                autoApprove: agentOptions.autoApprove,
            };
        case "pi":
            if (agentOptions.type !== "pi") return undefined;
            return {
                type: "pi",
                model: agentOptions.model,
                thinking: agentOptions.thinking,
                tools: agentOptions.tools,
            };
        case "kimi":
            if (agentOptions.type !== "kimi") return undefined;
            return {
                type: "kimi",
                model: agentOptions.model,
                permissionMode:
                    agentOptions.permissionMode &&
                    (KIMI_PERMISSION_MODES as readonly string[]).includes(
                        agentOptions.permissionMode,
                    )
                        ? agentOptions.permissionMode
                        : undefined,
            };
        case "antigravity":
            if (agentOptions.type !== "antigravity") return undefined;
            return {
                type: "antigravity",
                model: agentOptions.model,
                effort:
                    agentOptions.effort &&
                    (ANTIGRAVITY_EFFORT_LEVELS as readonly string[]).includes(agentOptions.effort)
                        ? agentOptions.effort
                        : undefined,
                mode:
                    agentOptions.mode &&
                    (ANTIGRAVITY_MODES as readonly string[]).includes(agentOptions.mode)
                        ? agentOptions.mode
                        : undefined,
                sandbox: agentOptions.sandbox,
                dangerouslySkipPermissions: agentOptions.dangerouslySkipPermissions,
            };
        default:
            return undefined;
    }
}

/** Snapshot shape for change detection: agent types always yield an object. */
function agentOptionsSnapshot(
    sessionType: SessionType,
    agentOptions: AgentLaunchOptions | undefined,
): AgentLaunchOptions | undefined {
    if (sessionType === "shell") return undefined;
    return normalizeAgentOptions(sessionType, agentOptions) ?? { type: sessionType };
}

export { normalizeAgentOptions, agentOptionsSnapshot };
