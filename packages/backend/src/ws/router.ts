/** Identifies one WebSocket connection, so per-client resources can be released when it closes. */
export interface ClientContext {
    clientId: string;
}

type Handler = (payload: unknown, ctx: ClientContext) => Promise<unknown>;

export class Router {
    private handlers = new Map<string, Handler>();

    register(type: string, handler: Handler): void {
        this.handlers.set(type, handler);
    }

    async handle(type: string, payload: unknown, ctx: ClientContext): Promise<unknown> {
        const handler = this.handlers.get(type);
        if (!handler) {
            throw new Error(`No handler for message type: ${type}`);
        }
        return handler(payload, ctx);
    }

    has(type: string): boolean {
        return this.handlers.has(type);
    }
}
