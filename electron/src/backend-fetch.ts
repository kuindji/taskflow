type BackendFetch = (origin: string, path: string, init?: RequestInit) => Promise<Response>;

function createBackendFetch(deps: {
    tokenFor: (origin: string) => string | null;
    fetchImpl?: typeof fetch;
}): BackendFetch {
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    return (origin, path, init) => {
        if (!path.startsWith("/")) {
            throw new Error(`backendFetch path must start with "/": ${path}`);
        }
        const normalizedOrigin = new URL(origin).origin;
        const headers = new Headers(init?.headers);
        const token = deps.tokenFor(normalizedOrigin);
        if (token !== null) headers.set("Authorization", `Bearer ${token}`);
        return fetchImpl(normalizedOrigin + path, { ...init, headers });
    };
}

export { createBackendFetch };
export type { BackendFetch };
