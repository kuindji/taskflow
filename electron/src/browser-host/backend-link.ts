import type { BrowserHostEvent, BrowserHostHeartbeat } from "@taskflow/shared";
import type { BackendFetch } from "../backend-fetch";
import { backendOrigin } from "../backend-url";

interface BackendLinkDeps {
    getBackendPort(): number | null;
    heartbeat(): Promise<BrowserHostHeartbeat>;
    backendFetch: BackendFetch;
    schedule(fn: () => Promise<void>, ms: number): () => void;
    log(message: string): void;
}

type QueuedPost = { event: BrowserHostEvent; failures: number } | { heartbeat: true };

export function createBackendLink(deps: BackendLinkDeps) {
    const queue: QueuedPost[] = [];
    let active: Promise<void> | undefined;
    let blocked = false;
    let stopped = false;

    async function drain(): Promise<void> {
        while (!stopped && !blocked && queue.length) {
            const post = queue[0];
            const port = deps.getBackendPort();
            if (port === null) {
                blocked = true;
                break;
            }
            try {
                const isEvent = "event" in post;
                const body = isEvent ? post.event : await deps.heartbeat();
                const response = await deps.backendFetch(
                    backendOrigin(port),
                    `/api/browser/host${isEvent ? "/events" : ""}`,
                    {
                        method: isEvent ? "POST" : "PUT",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify(body),
                        signal: AbortSignal.timeout(10000),
                    },
                );
                if (isEvent && response.status >= 500 && response.status <= 599) {
                    post.failures++;
                    if (post.failures < 3) {
                        blocked = true;
                        break;
                    }
                    deps.log(
                        `Dropping browser host event after 3 HTTP 5xx responses: ${post.event.type}`,
                    );
                }
            } catch {
                if ("event" in post) {
                    blocked = true;
                    break;
                }
            }
            queue.shift();
        }
    }

    function pump(): Promise<void> {
        if (stopped || blocked) return Promise.resolve();
        active ??= drain().finally(() => {
            active = undefined;
        });
        return active;
    }

    function flush(): Promise<void> {
        if (stopped) return Promise.resolve();
        // A heartbeat is built when sent, so one still waiting at the tail covers this one.
        // While draining, the head is in flight and already built.
        const last = queue.at(-1);
        const waiting = last && "heartbeat" in last && (queue.length > 1 || !active);
        if (!waiting) queue.push({ heartbeat: true });
        return pump();
    }

    const cancel = deps.schedule(() => {
        blocked = false;
        return flush();
    }, 5000);
    return {
        flush,
        event(event: BrowserHostEvent): Promise<void> {
            if (stopped) return Promise.resolve();
            queue.push({ event, failures: 0 });
            return pump();
        },
        stop(): void {
            stopped = true;
            cancel();
            queue.length = 0;
        },
    };
}
