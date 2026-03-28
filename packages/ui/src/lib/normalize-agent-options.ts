import type { AgentLaunchOptions, AgentType } from "@taskflow/shared";
import type { SessionType } from "@taskflow/shared";

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
        case "claude":
            if (agentOptions.type !== "claude") return undefined;
            return {
                type: "claude",
                dangerouslySkipPermissions:
                    agentOptions.dangerouslySkipPermissions || undefined,
                permissionMode: agentOptions.permissionMode,
                model: agentOptions.model,
                effort: agentOptions.effort,
            };
        case "codex":
            if (agentOptions.type !== "codex") return undefined;
            return {
                type: "codex",
                model: agentOptions.model,
                sandbox: agentOptions.sandbox,
                approvalPolicy: agentOptions.approvalPolicy,
                fullAuto: agentOptions.fullAuto || undefined,
            };
        case "opencode":
            if (agentOptions.type !== "opencode") return undefined;
            return {
                type: "opencode",
                model: agentOptions.model,
                agent: agentOptions.agent,
                variant: agentOptions.variant,
                autoApprove: agentOptions.autoApprove || undefined,
            };
        case "gemini":
            if (agentOptions.type !== "gemini") return undefined;
            return {
                type: "gemini",
                approvalMode: agentOptions.approvalMode,
                sandbox: agentOptions.sandbox,
                model: agentOptions.model,
            };
        case "cursor":
            if (agentOptions.type !== "cursor") return undefined;
            return {
                type: "cursor",
                yolo: agentOptions.yolo || undefined,
                model: agentOptions.model,
            };
        default:
            return undefined;
    }
}

export { normalizeAgentOptions };
