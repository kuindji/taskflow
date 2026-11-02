/** Identifies one WebSocket connection, so per-client resources can be released when it closes. */
export interface ClientContext {
    clientId: string;
}

type Handler = (payload: unknown, ctx: ClientContext) => Promise<unknown>;

/** Wraps every dispatched handler, e.g. to refuse requests while the data folder moves. */
type Guard = (type: string, run: () => Promise<unknown>) => Promise<unknown>;

export class Router {
    private handlers = new Map<string, Handler>();
    private guard: Guard | null = null;

    setGuard(guard: Guard): void {
        this.guard = guard;
    }

    register(type: string, handler: Handler): void {
        this.handlers.set(type, handler);
    }

    async handle(type: string, payload: unknown, ctx: ClientContext): Promise<unknown> {
        const handler = this.handlers.get(type);
        if (!handler) {
            throw new Error(`No handler for message type: ${type}`);
        }
        const run = () => handler(payload, ctx);
        return this.guard ? this.guard(type, run) : run();
    }

    has(type: string): boolean {
        return this.handlers.has(type);
    }
}
