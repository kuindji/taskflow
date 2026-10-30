import { timingSafeEqual } from "crypto";
import { isLoopback } from "@taskflow/shared";

export const AUTH_ENFORCED = false;

interface AuthContext {
    token: string;
    allowedOrigins: ReadonlySet<string>;
}

export interface ServerAuth extends AuthContext {
    enforce: boolean;
    log?: (line: string) => void;
}

type AuthReason = "host" | "origin" | "credential";
type AuthVerdict = { ok: true } | { ok: false; reason: AuthReason };

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

export function isUpgradeRequest(req: Request): boolean {
    return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

function offeredProtocols(req: Request): string[] {
    return (
        req.headers
            .get("sec-websocket-protocol")
            ?.split(",")
            .map((part) => part.trim()) ?? []
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
    if (req.method === "GET" && url.pathname === "/" && !isUpgradeRequest(req)) return { ok: true };

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
    return candidates.some((candidate) => tokensEqual(candidate, ctx.token))
        ? { ok: true }
        : { ok: false, reason: "credential" };
}

export function createReportOnce(
    log: (line: string) => void,
): (reason: AuthReason, req: Request, url: URL) => void {
    const seen = new Set<string>();
    return (reason, req, url) => {
        const pattern = url.pathname.startsWith("/cdp/")
            ? "/cdp/*"
            : "/" + url.pathname.split("/").filter(Boolean).slice(0, 2).join("/");
        const origin = req.headers.get("origin");
        const client =
            origin !== null
                ? `origin=${origin}`
                : `ua=${req.headers.get("user-agent")?.split(/[/ ]/, 1)[0] || "none"}`;
        const key = JSON.stringify([reason, pattern, client]);
        if (seen.has(key)) return;
        seen.add(key);
        const method = isUpgradeRequest(req) ? "WS" : req.method;
        log(`[auth] report-only: would reject (${reason}) ${method} ${pattern} from ${client}`);
    };
}
