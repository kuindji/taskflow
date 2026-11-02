import { MSG } from "@taskflow/shared";

class DataDirChangingError extends Error {
    constructor() {
        super("Taskflow is changing its data folder and will restart. Try again afterwards.");
        this.name = "DataDirChangingError";
    }
}

/**
 * Held while the data folder changes, from the busy check until the restart.
 * Closing it refuses new work that could launch a session or write to the data
 * folder, then waits for the work already admitted to finish, so nothing
 * recreates a moved item halfway through the move.
 */
class DataDirGate {
    private closed = false;
    private inFlight = 0;
    private idleWaiters: (() => void)[] = [];

    get isClosed(): boolean {
        return this.closed;
    }

    /** Runs `work` counted as in flight; throws while the gate is closed. */
    run<T>(work: () => Promise<T>): Promise<T> {
        if (this.closed) return Promise.reject(new DataDirChangingError());
        return this.counted(work());
    }

    /** Like `run`, but a closed gate skips `work` and returns null. */
    tryRun<T>(work: () => Promise<T>): Promise<T> | null {
        return this.closed ? null : this.counted(work());
    }

    /**
     * Counts work that already-admitted work started and does not await (a
     * title or worktree set up in the background), even if the gate closed in
     * between: it belongs to a request the gate let through.
     */
    track<T>(work: Promise<T>): Promise<T> {
        return this.counted(work);
    }

    /**
     * Closes the gate and waits for admitted work to drain. Returns false, with
     * the gate open again, when it does not drain within `timeoutMs`.
     */
    async close(timeoutMs: number): Promise<boolean> {
        if (this.closed) throw new DataDirChangingError();
        this.closed = true;
        if (this.inFlight === 0) return true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onIdle: (() => void) | undefined;
        const drained = await Promise.race([
            new Promise<boolean>((resolve) => {
                onIdle = () => resolve(true);
                this.idleWaiters.push(onIdle);
            }),
            new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(false), timeoutMs);
            }),
        ]);
        clearTimeout(timer);
        this.idleWaiters = this.idleWaiters.filter((waiter) => waiter !== onIdle);
        if (!drained) this.closed = false;
        return drained;
    }

    open(): void {
        this.closed = false;
    }

    private async counted<T>(work: Promise<T>): Promise<T> {
        this.inFlight += 1;
        try {
            return await work;
        } finally {
            this.inFlight -= 1;
            if (this.inFlight === 0) {
                const waiters = this.idleWaiters;
                this.idleWaiters = [];
                for (const waiter of waiters) waiter();
            }
        }
    }
}

/**
 * Requests the gate lets through while closed: settings live in the base
 * folder, not the data folder (the desktop app saves window state through them
 * on quit), and the data folder change runs its own gating.
 */
const UNGATED_MESSAGES = new Set<string>([
    MSG.SETTINGS_GET,
    MSG.SETTINGS_UPDATE,
    MSG.SETTINGS_GET_DATA_DIR,
    MSG.SETTINGS_UPDATE_DATA_DIR,
]);
const UNGATED_API_PATHS = new Set<string>(["/api/settings"]);

function isUngatedMessage(type: string): boolean {
    return UNGATED_MESSAGES.has(type);
}

function isUngatedApiPath(path: string): boolean {
    return UNGATED_API_PATHS.has(path);
}

export { DataDirGate, DataDirChangingError, isUngatedMessage, isUngatedApiPath };
