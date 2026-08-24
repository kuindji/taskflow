/**
 * Where the local backend listens. The backend binds `TASKFLOW_HOST` when it names a
 * loopback address and `127.0.0.1` when it is unset or empty
 * (see `packages/backend/src/ws/server.ts`) and inherits this process's environment,
 * so reading the same variable here keeps the main process pointed at the same socket.
 *
 * Deliberately duplicates `resolveBackendHost`/`hostForUrl` from `@taskflow/shared`
 * rather than importing them: the Electron main bundle does not depend on that
 * package, and pulling in its barrel would drag the themes and YAML deps with it.
 * The value needs no validation here — the backend refuses to start on a non-loopback
 * `TASKFLOW_HOST`, so an origin built from a rejected value is never reachable anyway.
 */
function backendOrigin(port: number): string {
    // An empty value is unset as far as the backend is concerned, so `??` is not enough.
    const host = process.env.TASKFLOW_HOST || "127.0.0.1";
    // A bare IPv6 literal has to be bracketed to be a legal URL authority.
    return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
}

export { backendOrigin };
