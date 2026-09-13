import type { AttachedBackend } from "./attached-backends";

interface BackendNotification {
    id: string;
    projectId: string;
    sessionId: string;
    taskId?: string;
    message: string;
    read: boolean;
    createdAt: string;
}

interface NotificationsResponse {
    notifications: BackendNotification[];
    /** The backend's clock when it answered (its `Date` header), in ms; null when absent. */
    serverTime: number | null;
}

interface NotificationPollerDeps {
    getAttachedBackends: () => AttachedBackend[];
    fetchNotifications: (origin: string) => Promise<NotificationsResponse>;
    /**
     * Shows one notification. `backendId` names its machine when called, not when
     * shown: a record renamed at its first handshake keeps its origin, so the id is
     * looked up from the origin at click time. Null once that machine is gone.
     */
    notify: (notification: BackendNotification, backendId: () => string | null) => void;
    /** This machine's clock in ms; injectable for tests. */
    now?: () => number;
}

const POLL_INTERVAL_MS = 3000;

function fetchBackendNotifications(origin: string): Promise<NotificationsResponse> {
    return fetch(`${origin}/api/notifications`, { signal: AbortSignal.timeout(2000) }).then(
        async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const { notifications } = (await response.json()) as {
                notifications: BackendNotification[];
            };
            const date = Date.parse(response.headers.get("date") ?? "");
            return { notifications, serverTime: Number.isNaN(date) ? null : date };
        },
    );
}

function createNotificationPoller(deps: NotificationPollerDeps) {
    const now = deps.now ?? Date.now;
    /**
     * The newest `createdAt` delivered per origin, compared only with that origin's
     * own stamps: machines' clocks differ, and one shared watermark dropped a
     * machine's notification whenever another machine had delivered a newer one.
     * Keyed by origin, not record id, because the id changes at the first handshake
     * while the tunnel and its origin stay. `null` means seen, nothing yet.
     */
    const watermarks = new Map<string, string | null>();
    /**
     * When (this machine's clock) an origin with no watermark yet was first polled
     * and failed. Its first answer cannot then stand for "what it already held":
     * anything raised since the failure is new.
     */
    const failedSince = new Map<string, number>();
    let timer: ReturnType<typeof setInterval> | null = null;
    let polling = false;

    function backendIdFor(origin: string): string | null {
        return deps.getAttachedBackends().find((entry) => entry.origin === origin)?.id ?? null;
    }

    async function pollOrigin(origin: string): Promise<void> {
        const startedAt = now();
        let response: NotificationsResponse;
        try {
            response = await deps.fetchNotifications(origin);
        } catch {
            // Transient failure; the next poll retries from the same watermark.
            if (!watermarks.has(origin) && !failedSince.has(origin)) {
                failedSince.set(origin, startedAt);
            }
            return;
        }
        // Detached while the request was out: its watermark is gone, so do not revive it.
        if (!deps.getAttachedBackends().some((entry) => entry.origin === origin)) return;

        const { notifications, serverTime } = response;
        const newest = (list: BackendNotification[], from: string | null) =>
            list.reduce<string | null>(
                (acc, n) => (!acc || n.createdAt > acc ? n.createdAt : acc),
                from,
            );

        if (!watermarks.has(origin)) {
            const since = failedSince.get(origin) ?? startedAt;
            failedSince.delete(origin);
            if (serverTime === null) {
                // No clock to compare with: what it holds at its first answer is not new.
                watermarks.set(origin, newest(notifications, null));
                return;
            }
            // Anything raised since the first failed poll, or since this one left, is
            // new: that time, moved onto the origin's clock. `Date` has whole-second
            // resolution, so the cutoff errs early and shows rather than drops.
            watermarks.set(origin, new Date(since + serverTime - now()).toISOString());
        }

        const watermark = watermarks.get(origin) ?? null;
        const fresh = notifications.filter(
            (n) => !n.read && (!watermark || n.createdAt > watermark),
        );
        for (const n of fresh) {
            deps.notify(n, () => backendIdFor(origin));
        }
        watermarks.set(origin, newest(fresh, watermark));
    }

    async function poll(): Promise<void> {
        if (polling) return;
        polling = true;
        try {
            const origins = new Set(deps.getAttachedBackends().map((entry) => entry.origin));
            // A tunnel's local port can be reused by another machine later.
            for (const map of [watermarks, failedSince]) {
                for (const origin of map.keys()) {
                    if (!origins.has(origin)) map.delete(origin);
                }
            }
            await Promise.all([...origins].map((origin) => pollOrigin(origin)));
        } finally {
            polling = false;
        }
    }

    return {
        poll,
        start(): void {
            if (timer) return;
            void poll();
            timer = setInterval(() => {
                void poll();
            }, POLL_INTERVAL_MS);
        },
        stop(): void {
            if (!timer) return;
            clearInterval(timer);
            timer = null;
        },
    };
}

export { createNotificationPoller, fetchBackendNotifications };
export type { BackendNotification };
