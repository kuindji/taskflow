import type { PiThinkingLevel } from "../types/agent";

// Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): packages/provider-pi/src/server/thinkingCapabilities.ts
export function supportsPiXhigh(model: unknown): boolean {
    if (typeof model !== "object" || model === null || Array.isArray(model)) return false;
    const { reasoning, thinkingLevelMap } = model as {
        reasoning?: unknown;
        thinkingLevelMap?: unknown;
    };
    return (
        reasoning === true &&
        typeof thinkingLevelMap === "object" &&
        thinkingLevelMap !== null &&
        !Array.isArray(thinkingLevelMap) &&
        (thinkingLevelMap as Record<string, unknown>).xhigh != null
    );
}

export function normalizePiThinkingLevel(
    level: PiThinkingLevel,
    supportsXhigh: boolean,
): PiThinkingLevel {
    return level === "xhigh" && !supportsXhigh ? "high" : level;
}
