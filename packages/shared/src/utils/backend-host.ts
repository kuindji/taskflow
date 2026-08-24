/**
 * The address the backend binds, and the one every local client dials.
 *
 * `Bun.serve` defaults to every interface, so the backend pins loopback
 * (`packages/backend/src/ws/server.ts`). `TASKFLOW_HOST` exists only for the
 * unusual host where `localhost` resolves to `::1` alone — it is deliberately
 * not a way to publish the backend, which has no authentication of any kind, to
 * the network. Anything that is not a loopback address is refused rather than
 * honoured; remote access goes through an SSH tunnel.
 */

const DEFAULT_BACKEND_HOST = "127.0.0.1";

/**
 * Only the addresses `localhost` itself resolves to. The rest of 127/8 is loopback
 * too, but the desktop renderer (`packages/ui/src/hooks/useWebSocket.ts`) and every
 * spawned agent dial the backend by name, so binding e.g. `127.0.0.2` would leave
 * them unable to reach it. Widening this set means teaching those clients the host.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);

function isLoopback(host: string): boolean {
    return LOOPBACK_HOSTS.has(host.toLowerCase());
}

/** Throws when `TASKFLOW_HOST` names anything the backend must not bind. */
function resolveBackendHost(): string {
    const host = process.env.TASKFLOW_HOST;
    if (host === undefined || host === "") return DEFAULT_BACKEND_HOST;
    if (!isLoopback(host)) {
        throw new Error(
            `TASKFLOW_HOST must name a loopback address reachable as \`localhost\` ` +
                `(127.0.0.1, ::1 or localhost). ` +
                `Refusing to bind the unauthenticated backend to "${host}" — ` +
                `use an SSH tunnel to reach it from another machine.`,
        );
    }
    return host;
}

/** Brackets a bare IPv6 literal so the result is a legal URL authority. */
function hostForUrl(host: string): string {
    return host.includes(":") ? `[${host}]` : host;
}

/** The backend's HTTP origin, for anything handed a URL rather than a port. */
function backendHttpOrigin(port: number): string {
    return `http://${hostForUrl(resolveBackendHost())}:${String(port)}`;
}

export { resolveBackendHost, hostForUrl, backendHttpOrigin };
