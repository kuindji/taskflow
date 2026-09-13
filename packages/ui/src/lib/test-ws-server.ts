/** A request as a test server received it. */
interface ReceivedRequest {
    type: string;
    payload: unknown;
}

export interface TestServer {
    origin: string;
    /** Every message, answered or fire-and-forget, in arrival order. */
    received: ReceivedRequest[];
    stop(): void;
    /** Push an event to every open socket; the payload defaults to `{ from: label }`. */
    broadcast(type: string, payload?: unknown): void;
}

/**
 * A minimal backend for tests that need real sockets. Each request is answered
 * with `respond(type, payload)`, by default `{ from: label }` — enough to tell
 * which server a request reached. A promise holds the answer back until it settles.
 */
export function startTestServer(
    label: string,
    respond: (type: string, payload: unknown) => unknown = () => ({ from: label }),
): TestServer {
    const sockets = new Set<{ send(data: string): void }>();
    const received: ReceivedRequest[] = [];
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("ok")),
        websocket: {
            open(ws) {
                sockets.add(ws);
            },
            close(ws) {
                sockets.delete(ws);
            },
            message(ws, raw) {
                const request = JSON.parse(String(raw)) as {
                    correlationId?: string;
                    type: string;
                    payload?: unknown;
                };
                received.push({ type: request.type, payload: request.payload });
                if (!request.correlationId) return;
                const answer = respond(request.type, request.payload);
                const reply = (payload: unknown) =>
                    ws.send(
                        JSON.stringify({
                            correlationId: request.correlationId,
                            type: request.type,
                            payload,
                        }),
                    );
                if (answer instanceof Promise) void answer.then(reply);
                else reply(answer);
            },
        },
    });
    return {
        origin: `http://127.0.0.1:${server.port}`,
        received,
        stop: () => void server.stop(true),
        broadcast: (type, payload = { from: label }) => {
            for (const ws of sockets) ws.send(JSON.stringify({ type, payload }));
        },
    };
}
