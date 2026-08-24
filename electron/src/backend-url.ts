/**
 * Where the local backend listens. The backend binds `TASKFLOW_HOST ?? "127.0.0.1"`
 * (see `packages/backend/src/ws/server.ts`) and inherits this process's environment,
 * so reading the same variable here keeps the main process pointed at the same socket.
 */
function backendOrigin(port: number): string {
    const host = process.env.TASKFLOW_HOST ?? "127.0.0.1";
    // A bare IPv6 literal has to be bracketed to be a legal URL authority.
    return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
}

export { backendOrigin };
