import {
    normalizePiThinkingLevel,
    type PiLaunchOptions,
    type PiModelsResponse,
} from "@taskflow/shared";
import { fetchPiModels } from "./runtime-detector";

const PI_LAUNCH_DISCOVERY_BUDGET_MS = 10_000;

export async function normalizePiLaunchOptions(
    options: PiLaunchOptions,
    context: { env: Record<string, string | undefined>; cwd?: string },
    discover: typeof fetchPiModels = fetchPiModels,
    budgetMs = PI_LAUNCH_DISCOVERY_BUDGET_MS,
): Promise<PiLaunchOptions> {
    if (options.thinking !== "xhigh") return options;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: PiModelsResponse | undefined;
    try {
        const timeout = new Promise<undefined>((resolve) => {
            timer = setTimeout(() => {
                controller.abort();
                resolve(undefined);
            }, budgetMs);
        });
        response = await Promise.race([
            discover({ ...context, signal: controller.signal }),
            timeout,
        ]);
    } catch {
        // Capability discovery must not prevent a launch.
    } finally {
        clearTimeout(timer);
        controller.abort();
    }
    const key = options.model || response?.defaultModel;
    const model = response?.models.find((model) => `${model.provider}/${model.id}` === key);
    return {
        ...options,
        thinking: normalizePiThinkingLevel(options.thinking, model?.supportsXhigh === true),
    };
}
