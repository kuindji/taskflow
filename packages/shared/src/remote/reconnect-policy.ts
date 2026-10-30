/** Retry timing shared by tunnel adapters. Socket retries remain with each client. */
export function createReconnectPolicy(deps: {
    attempt(): Promise<boolean>;
    schedule?: (run: () => void, delayMs: number) => () => void;
    random?: () => number;
}): {
    start(): void;
    retryNow(): void;
    setConnected(connected: boolean): void;
    stop(): void;
} {
    const schedule =
        deps.schedule ??
        ((run, delay) => {
            const timer = setTimeout(run, delay);
            return () => clearTimeout(timer);
        });
    const random = deps.random ?? Math.random;
    let stopped = false;
    let needed = false;
    let running = false;
    let wake = false;
    let connected = false;
    let attempt = 0;
    let cancelRetry: (() => void) | null = null;
    let cancelStable: (() => void) | null = null;

    function arm() {
        if (stopped || !needed || running || cancelRetry) return;
        const base = Math.min(1000 * 2 ** Math.min(attempt, 5), 30000);
        const delay = Math.min(30000, Math.round(base * (0.8 + 0.4 * random())));
        cancelRetry = schedule(() => {
            cancelRetry = null;
            void run();
        }, delay);
    }
    async function run() {
        if (stopped || !needed || running) return;
        running = true;
        attempt++;
        let success = false;
        try {
            success = await deps.attempt();
        } catch {
            /* The adapter retains the failure. */
        }
        running = false;
        if (stopped) return;
        if (success) {
            needed = false;
            wake = false;
            return;
        }
        if (wake) {
            wake = false;
            void run();
        } else arm();
    }
    return {
        start() {
            if (stopped) return;
            needed = true;
            arm();
        },
        retryNow() {
            if (stopped || !needed) return;
            if (running) {
                wake = true;
                return;
            }
            cancelRetry?.();
            cancelRetry = null;
            void run();
        },
        setConnected(value) {
            if (stopped || value === connected) return;
            connected = value;
            cancelStable?.();
            cancelStable = null;
            if (value)
                cancelStable = schedule(() => {
                    cancelStable = null;
                    attempt = 0;
                }, 60000);
        },
        stop() {
            stopped = true;
            needed = false;
            wake = false;
            cancelRetry?.();
            cancelRetry = null;
            cancelStable?.();
            cancelStable = null;
        },
    };
}
