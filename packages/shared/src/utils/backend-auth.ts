import type { TunnelFailure } from "../types/backend";

export const ACCESS_TOKEN_REJECTED = "Remote backend rejected the access token";
export const LOCAL_ACCESS_TOKEN_REJECTED = "The local backend rejected the access token";

export class BackendUnauthorizedError extends Error {
    constructor() {
        super("Unauthorized");
        this.name = "BackendUnauthorizedError";
    }
}

export function unauthorizedFailure(local: boolean): TunnelFailure {
    return {
        kind: "unauthorized",
        message: local ? LOCAL_ACCESS_TOKEN_REJECTED : ACCESS_TOKEN_REJECTED,
        stderr: "",
    };
}

interface TokenRefreshGate {
    unauthorized(id: string): "refresh" | "reject";
    authenticated(id: string): void;
}

export function createTokenRefreshGate(): TokenRefreshGate {
    const attempted = new Set<string>();
    return {
        unauthorized(id) {
            if (attempted.has(id)) return "reject";
            attempted.add(id);
            return "refresh";
        },
        authenticated(id) {
            attempted.delete(id);
        },
    };
}
