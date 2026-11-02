/** How long a launch waits for an agent CLI to list its models. */
const LAUNCH_DISCOVERY_BUDGET_MS = 10_000;

/**
 * Runs a model-capability probe for a launch. Gives up (undefined) after
 * `budgetMs` or on failure: discovery must never block or fail a launch.
 */
async function discoverWithinBudget<T>(
    discover: (signal: AbortSignal) => Promise<T>,
    budgetMs: number = LAUNCH_DISCOVERY_BUDGET_MS,
): Promise<T | undefined> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const timeout = new Promise<undefined>((resolve) => {
            timer = setTimeout(() => {
                controller.abort();
                resolve(undefined);
            }, budgetMs);
        });
        return await Promise.race([discover(controller.signal), timeout]);
    } catch {
        return undefined;
    } finally {
        clearTimeout(timer);
        controller.abort();
    }
}

export { LAUNCH_DISCOVERY_BUDGET_MS, discoverWithinBudget };
