const CHECK_URLS = [
    "https://www.msftconnecttest.com/connecttest.txt",
    "https://connectivitycheck.gstatic.com/generate_204",
    "https://detectportal.firefox.com/success.txt",
];
const POLL_INTERVAL_MS = 15_000;
const TIMEOUT_MS = 5_000;

type ChangeListener = (online: boolean) => void;
type ConnectivityChecker = () => Promise<boolean>;

async function checkEndpoint(url: string): Promise<boolean> {
    try {
        const requestUrl = new URL(url);
        requestUrl.searchParams.set("_", String(Date.now()));
        const response = await fetch(requestUrl, {
            method: "GET",
            cache: "no-store",
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        void response.body?.cancel();
        return response.ok;
    } catch {
        return false;
    }
}

async function checkConnectivity(): Promise<boolean> {
    for (const url of CHECK_URLS) {
        if (await checkEndpoint(url)) return true;
    }
    return false;
}

const defaultCheckConnectivity: ConnectivityChecker = checkConnectivity;

class ConnectivityService {
    private online = true;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private listeners = new Set<ChangeListener>();
    private inFlightCheck: Promise<boolean> | null = null;
    private readonly checkConnectivity: ConnectivityChecker;

    constructor(checkConnectivity: ConnectivityChecker = defaultCheckConnectivity) {
        this.checkConnectivity = checkConnectivity;
    }

    get isOnline(): boolean {
        return this.online;
    }

    async init(): Promise<boolean> {
        this.online = await this.checkConnectivity();
        this.pollTimer = setInterval(() => {
            void this.refresh();
        }, POLL_INTERVAL_MS);
        this.pollTimer.unref?.();
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

    async refresh(): Promise<boolean> {
        if (this.inFlightCheck) {
            return this.inFlightCheck;
        }

        this.inFlightCheck = (async () => {
            const wasOnline = this.online;
            const nextOnline = await this.checkConnectivity();
            this.online = nextOnline;
            if (nextOnline !== wasOnline) {
                for (const listener of this.listeners) {
                    listener(nextOnline);
                }
            }
            return nextOnline;
        })().finally(() => {
            this.inFlightCheck = null;
        });

        return this.inFlightCheck;
    }
}

export { ConnectivityService };
