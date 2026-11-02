import { normalizePiThinkingLevel, type PiLaunchOptions } from "@taskflow/shared";
import { fetchPiModels } from "./runtime-detector";
import { LAUNCH_DISCOVERY_BUDGET_MS, discoverWithinBudget } from "./launch-discovery";

export async function normalizePiLaunchOptions(
    options: PiLaunchOptions,
    context: { env: Record<string, string | undefined>; cwd?: string },
    discover: typeof fetchPiModels = fetchPiModels,
    budgetMs = LAUNCH_DISCOVERY_BUDGET_MS,
): Promise<PiLaunchOptions> {
    if (options.thinking !== "xhigh") return options;
    const response = await discoverWithinBudget(
        (signal) => discover({ ...context, signal }),
        budgetMs,
    );
    const key = options.model || response?.defaultModel;
    const model = response?.models.find((model) => `${model.provider}/${model.id}` === key);
    return {
        ...options,
        thinking: normalizePiThinkingLevel(options.thinking, model?.supportsXhigh === true),
    };
}
