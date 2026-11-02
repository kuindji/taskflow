import type { CodexLaunchOptions } from "@taskflow/shared";
import { fetchCodexModels } from "./runtime-detector";
import { LAUNCH_DISCOVERY_BUDGET_MS, discoverWithinBudget } from "./launch-discovery";

/**
 * Settings fill a Codex launch's unset model or effort at launch time, so a
 * run that pins one and inherits the other can pair them badly after a
 * Settings change (a saved action pinning a model that cannot run the new
 * Settings effort). Such a pair falls back to the model's own default effort.
 * A pair the run chose whole, or took whole from Settings, is left as is.
 */
async function normalizeCodexLaunchOptions(
    resolved: CodexLaunchOptions,
    explicit: CodexLaunchOptions | undefined,
    /** Built only when a probe runs (it resolves the run's account). */
    env: () => Record<string, string | undefined>,
    discover: typeof fetchCodexModels = fetchCodexModels,
    budgetMs = LAUNCH_DISCOVERY_BUDGET_MS,
): Promise<CodexLaunchOptions> {
    const effort = resolved.reasoningEffort;
    const pinsModel = explicit?.model !== undefined;
    const pinsEffort = explicit?.reasoningEffort !== undefined;
    if (!effort || pinsModel === pinsEffort) return resolved;

    const response = await discoverWithinBudget(
        async (signal) => discover(env(), {}, signal),
        budgetMs,
    );
    const models = response?.models ?? [];
    const model = resolved.model
        ? models.find((m) => m.model === resolved.model || m.id === resolved.model)
        : models.find((m) => m.isDefault);
    if (!model || model.supportedReasoningEfforts.some((e) => e.reasoningEffort === effort)) {
        return resolved;
    }
    return { ...resolved, reasoningEffort: model.defaultReasoningEffort };
}

export { normalizeCodexLaunchOptions };
