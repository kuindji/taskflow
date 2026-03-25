import type { AgentType, AgentLaunchOptions } from "@taskflow/shared";
import { normalizeAgentOptions } from "@/lib/normalize-agent-options";

function computeNextRunPreview(expression: string, expressionType: "cron" | "rate"): string | null {
    try {
        if (expressionType === "rate") {
            const match = expression.match(/^rate\((\d+)\s+(minutes?|hours?|days?)\)$/i);
            if (!match) return null;
            const value = parseInt(match[1], 10);
            const unit = match[2].toLowerCase().replace(/s$/, "");
            const msMap: Record<string, number> = {
                minute: 60000,
                hour: 3600000,
                day: 86400000,
            };
            const ms = msMap[unit];
            if (!ms) return null;
            return new Date(Date.now() + value * ms).toLocaleString();
        }
        return null; // cron preview needs backend cron-parser
    } catch {
        return null;
    }
}

function normalizeTimeout(timeout: string | number | undefined): number {
    const value = typeof timeout === "number" ? timeout : parseInt(timeout ?? "", 10);
    return Number.isFinite(value) && value > 0 ? value : 30;
}

function serializeScheduleState({
    includeProjectId,
    projectId,
    name,
    actionId,
    prompt,
    expression,
    expressionType,
    agentType,
    agentOptions,
    timeout,
    useAction,
}: {
    includeProjectId: boolean;
    projectId: string;
    name: string | undefined;
    actionId: string | undefined;
    prompt: string | undefined;
    expression: string;
    expressionType: "cron" | "rate";
    agentType: AgentType | "";
    agentOptions: AgentLaunchOptions | undefined;
    timeout: string | number | undefined;
    useAction: boolean;
}) {
    return JSON.stringify({
        projectId: includeProjectId ? projectId : undefined,
        name: name || undefined,
        actionId: actionId || undefined,
        prompt: useAction ? undefined : prompt,
        expression,
        expressionType,
        agentType: useAction ? undefined : agentType || undefined,
        agentOptions: useAction ? undefined : normalizeAgentOptions(agentType, agentOptions),
        timeout: normalizeTimeout(timeout),
    });
}

export { computeNextRunPreview, normalizeTimeout, serializeScheduleState };
