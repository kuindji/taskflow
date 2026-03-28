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
                fullAccess: agentOptions.type === "claude" ? agentOptions.fullAccess || undefined : undefined,
                dontAskQuestions: agentOptions.type === "claude" ? agentOptions.dontAskQuestions || undefined : undefined,
                model: agentOptions.type === "claude" ? agentOptions.model : undefined,
            };
        case "codex":
            return {
                type: "codex",
                fullAccess: agentOptions.type === "codex" ? agentOptions.fullAccess || undefined : undefined,
                dontAskQuestions: agentOptions.type === "codex" ? agentOptions.dontAskQuestions || undefined : undefined,
            };
        case "opencode":
            return {
                type: "opencode",
                fullAccess: agentOptions.type === "opencode" ? agentOptions.fullAccess || undefined : undefined,
                dontAskQuestions: agentOptions.type === "opencode" ? agentOptions.dontAskQuestions || undefined : undefined,
                model: agentOptions.type === "opencode" ? agentOptions.model : undefined,
            };
        case "gemini":
            return {
                type: "gemini",
                fullAccess: agentOptions.type === "gemini" ? agentOptions.fullAccess || undefined : undefined,
                dontAskQuestions: agentOptions.type === "gemini" ? agentOptions.dontAskQuestions || undefined : undefined,
                model: agentOptions.type === "gemini" ? agentOptions.model : undefined,
            };
        case "cursor":
            return {
                type: "cursor",
                yolo: agentOptions.type === "cursor" ? agentOptions.yolo || undefined : undefined,
                model: agentOptions.type === "cursor" ? agentOptions.model : undefined,
            };
        default:
            return undefined;
    }
}

export { normalizeAgentOptions };
