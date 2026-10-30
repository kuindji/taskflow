const handlers = new Set<(backendId: string) => void>();

export function notifyBackendReady(backendId: string): void {
    for (const handler of handlers) handler(backendId);
}

export function onBackendReady(handler: (backendId: string) => void): () => void {
    handlers.add(handler);
    return () => {
        handlers.delete(handler);
    };
}
