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
            return {
                type: "claude",
                fullAccess: agentOptions.fullAccess || undefined,
                dontAskQuestions: agentOptions.dontAskQuestions || undefined,
                model: agentOptions.type === "claude" ? agentOptions.model : undefined,
            };
        case "codex":
            return {
                type: "codex",
                fullAccess: agentOptions.fullAccess || undefined,
                dontAskQuestions: agentOptions.dontAskQuestions || undefined,
            };
        case "opencode":
            return {
                type: "opencode",
                model: agentOptions.type === "opencode" ? agentOptions.model : undefined,
                agent: agentOptions.type === "opencode" ? agentOptions.agent : undefined,
                variant: agentOptions.type === "opencode" ? agentOptions.variant : undefined,
                autoApprove:
                    agentOptions.type === "opencode"
                        ? (agentOptions.autoApprove || undefined)
                        : undefined,
            };
        case "gemini":
            return {
                type: "gemini",
                fullAccess: agentOptions.fullAccess || undefined,
                dontAskQuestions: agentOptions.dontAskQuestions || undefined,
                model: agentOptions.type === "gemini" ? agentOptions.model : undefined,
            };
        case "cursor":
            return {
                type: "cursor",
                fullAccess: agentOptions.fullAccess || undefined,
                dontAskQuestions: agentOptions.dontAskQuestions || undefined,
                model: agentOptions.type === "cursor" ? agentOptions.model : undefined,
            };
        default:
            return undefined;
    }
}

export { normalizeAgentOptions };
