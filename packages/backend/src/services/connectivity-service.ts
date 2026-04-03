const CHECK_URLS = [
    "https://dns.google/resolve?name=example.com&type=A",
    "https://one.one.one.one/dns-query?name=example.com&type=A",
    "https://httpbin.org/status/200",
];
const POLL_INTERVAL_MS = 15_000;
const TIMEOUT_MS = 5_000;

type ChangeListener = (online: boolean) => void;

async function checkUrl(url: string): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const resp = await fetch(url, {
            method: "HEAD",
            signal: controller.signal,
        });
        clearTimeout(timer);
        return resp.ok;
    } catch {
        return false;
    }
}

async function checkConnectivity(): Promise<boolean> {
    for (const url of CHECK_URLS) {
        if (await checkUrl(url)) return true;
    }
    return false;
}

class ConnectivityService {
    private online = true;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private listeners = new Set<ChangeListener>();

    get isOnline(): boolean {
        return this.online;
    }

    async init(): Promise<boolean> {
        this.online = await checkConnectivity();
        this.pollTimer = setInterval(() => {
            void this.poll();
        }, POLL_INTERVAL_MS);
        this.pollTimer.unref();
        return this.online;
    }

    onChange(listener: ChangeListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    shutdown(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.listeners.clear();
    }

    private async poll(): Promise<void> {
        const wasOnline = this.online;
        this.online = await checkConnectivity();
        if (this.online !== wasOnline) {
            for (const listener of this.listeners) {
                listener(this.online);
            }
        }
    }
}

export { ConnectivityService };
