import { createHmac, timingSafeEqual } from "crypto";
import { isLoopback } from "@taskflow/shared";

export interface AuthContext {
    token: string;
    allowedOrigins: ReadonlySet<string>;
}

type AuthReason = "host" | "origin" | "credential";
// `anonymous` marks the identity probe, which must never be upgraded.
type AuthVerdict = { ok: true; anonymous?: true } | { ok: false; reason: AuthReason };

export function parseUiOrigins(raw: string | undefined): Set<string> {
    const origins = new Set(["file://", "null"]);
    for (const entry of raw?.split(",") ?? []) {
        try {
            const origin = new URL(entry.trim()).origin;
            if (origin !== "null") origins.add(origin);
        } catch {
            // Invalid entries do not add an origin.
        }
    }
    return origins;
}

function tokensEqual(candidate: string, token: string): boolean {
    const a = Buffer.from(candidate, "utf-8");
    const b = Buffer.from(token, "utf-8");
    return a.length === b.length && timingSafeEqual(a, b);
}

export function cdpKey(token: string, tabId: string): string {
    return createHmac("sha256", token).update(`cdp:${tabId}`).digest("base64url");
}

// Bun upgrades when any comma-separated Upgrade token is websocket.
export function isUpgradeRequest(req: Request): boolean {
    return (
        req.headers
            .get("upgrade")
            ?.split(",")
            .some((part) => part.trim().toLowerCase() === "websocket") ?? false
    );
}

function offeredProtocols(req: Request): string[] {
    return (
        req.headers
            .get("sec-websocket-protocol")
            ?.split(",")
            .map((part) => part.trim()) ?? []
    );
}

// Bun echoes the first offered protocol when the upgrade sets none, so an
// auth entry offered without `taskflow` would come back in the response.
export function offersUnansweredToken(req: Request): boolean {
    const protocols = offeredProtocols(req);
    return (
        !protocols.includes("taskflow") &&
        protocols.some((protocol) => protocol.startsWith("taskflow.auth."))
    );
}

export function upgradeHeaders(req: Request): Record<string, string> | undefined {
    return offeredProtocols(req).includes("taskflow")
        ? { "Sec-WebSocket-Protocol": "taskflow" }
        : undefined;
}

export function checkRequest(req: Request, url: URL, ctx: AuthContext): AuthVerdict {
    const host = req.headers.get("host");
    if (!host) return { ok: false, reason: "host" };
    try {
        const hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "");
        if (!isLoopback(hostname)) return { ok: false, reason: "host" };
    } catch {
        return { ok: false, reason: "host" };
    }

    const origin = req.headers.get("origin");
    if (origin !== null && !ctx.allowedOrigins.has(origin)) return { ok: false, reason: "origin" };
    if (req.method === "GET" && url.pathname === "/" && !req.headers.has("upgrade"))
        return { ok: true, anonymous: true };

    const candidates: string[] = [];
    const bearer = /^Bearer (.+)$/i.exec(req.headers.get("authorization") ?? "");
    if (bearer) candidates.push(bearer[1]);
    if (isUpgradeRequest(req)) {
        const protocols = offeredProtocols(req);
        if (protocols.includes("taskflow")) {
            for (const protocol of protocols) {
                if (protocol.startsWith("taskflow.auth."))
                    candidates.push(protocol.slice("taskflow.auth.".length));
            }
        }
    }
    if (
        req.method === "GET" &&
        (url.pathname === "/api/file/raw" ||
            /^\/api\/flow\/artifact\/[^/]+\/[^/]+\/[^/]+\/raw$/.test(url.pathname))
    ) {
        const token = url.searchParams.get("token");
        if (token !== null) candidates.push(token);
    }
    const cdpPath = /^\/cdp\/([^/]+)\/([^/]+)(?:\/|$)/.exec(url.pathname);
    return candidates.some((candidate) => tokensEqual(candidate, ctx.token)) ||
        (cdpPath !== null && tokensEqual(cdpPath[2], cdpKey(ctx.token, cdpPath[1])))
        ? { ok: true }
        : { ok: false, reason: "credential" };
}
