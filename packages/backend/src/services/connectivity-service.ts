import { Resolver } from "dns";

const DNS_HOSTS = ["dns.google", "one.one.one.one", "dns.quad9.net"];
const POLL_INTERVAL_MS = 15_000;
const TIMEOUT_MS = 5_000;

type ChangeListener = (online: boolean) => void;

function checkHost(hostname: string): Promise<boolean> {
    return new Promise((res) => {
        const timer = setTimeout(() => res(false), TIMEOUT_MS);
        const resolver = new Resolver();
        resolver.resolve(hostname, (err) => {
            clearTimeout(timer);
            res(!err);
        });
    });
}

async function checkConnectivity(): Promise<boolean> {
    for (const host of DNS_HOSTS) {
        if (await checkHost(host)) return true;
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
