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

const IPV6_LOOPBACK = new Set(["::1", "0:0:0:0:0:0:0:1"]);
const IPV4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isLoopback(host: string): boolean {
    const bare = host.toLowerCase();
    if (bare === "localhost" || IPV6_LOOPBACK.has(bare)) return true;
    const octets = IPV4_LOOPBACK.exec(bare);
    return octets !== null && octets.slice(1).every((octet) => Number(octet) <= 255);
}

/** Throws when `TASKFLOW_HOST` names anything the backend must not bind. */
function resolveBackendHost(): string {
    const host = process.env.TASKFLOW_HOST;
    if (host === undefined || host === "") return DEFAULT_BACKEND_HOST;
    if (!isLoopback(host)) {
        throw new Error(
            `TASKFLOW_HOST must name a loopback address (127.x.x.x, ::1 or localhost). ` +
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

export { resolveBackendHost, hostForUrl };
