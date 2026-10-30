import { MSG, type TerminalOutputEvent, type WsEvent } from "@taskflow/shared";

export interface BroadcastOptions {
    dropOnBackpressure?: boolean;
}

const BACKPRESSURE_THRESHOLD = 1_048_576;

export function createTerminalBroadcaster<
    T extends {
        getBufferedAmount(): number;
        send(data: string): number;
    },
>(
    clients: Iterable<T>,
): {
    broadcast(event: WsEvent, opts?: BroadcastOptions): void;
    drain(client: T): void;
    forget(client: T): void;
    clear(): void;
} {
    const dirty = new Map<T, Set<string>>();
    return {
        broadcast(event, opts) {
            const data = JSON.stringify(event);
            for (const client of clients) {
                if (
                    opts?.dropOnBackpressure &&
                    client.getBufferedAmount() > BACKPRESSURE_THRESHOLD
                ) {
                    if (event.type === MSG.TERMINAL_OUTPUT) {
                        let sessions = dirty.get(client);
                        if (!sessions) dirty.set(client, (sessions = new Set()));
                        sessions.add((event.payload as TerminalOutputEvent).sessionId);
                    }
                    continue;
                }
                client.send(data);
            }
        },
        drain(client) {
            const sessions = dirty.get(client);
            if (!sessions?.size) return;
            if (
                client.send(
                    JSON.stringify({
                        type: MSG.TERMINAL_RESYNC,
                        payload: { sessionIds: [...sessions] },
                    }),
                ) !== 0
            ) {
                dirty.delete(client);
            }
        },
        forget(client) {
            dirty.delete(client);
        },
        clear() {
            dirty.clear();
        },
    };
}
