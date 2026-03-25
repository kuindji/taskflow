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

    const base = {
        fullAccess: agentOptions.fullAccess || undefined,
        dontAskQuestions: agentOptions.dontAskQuestions || undefined,
    };

    switch (agentType) {
        case "claude":
            return {
                ...base,
                type: "claude",
                model: agentOptions.type === "claude" ? agentOptions.model : undefined,
            };
        case "codex":
            return { ...base, type: "codex" };
        case "opencode":
            return {
                ...base,
                type: "opencode",
                model: agentOptions.type === "opencode" ? agentOptions.model : undefined,
            };
        case "gemini":
            return {
                ...base,
                type: "gemini",
                model: agentOptions.type === "gemini" ? agentOptions.model : undefined,
            };
        case "cursor":
            return {
                ...base,
                type: "cursor",
                model: agentOptions.type === "cursor" ? agentOptions.model : undefined,
            };
        default:
            return undefined;
    }
}

export { normalizeAgentOptions };
