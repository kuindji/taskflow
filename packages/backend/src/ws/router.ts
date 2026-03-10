type Handler = (payload: unknown) => Promise<unknown>;

export class Router {
  private handlers = new Map<string, Handler>();

  register(type: string, handler: Handler): void {
    this.handlers.set(type, handler);
  }

  async handle(type: string, payload: unknown): Promise<unknown> {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`No handler for message type: ${type}`);
    }
    return handler(payload);
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }
}
