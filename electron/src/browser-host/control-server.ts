import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { TabHost } from "./tab-host";

export async function startControlServer(
    tabHost: Pick<TabHost, "ensure" | "close">,
): Promise<{ url: string; close(): void }> {
    const prefix = `/${randomBytes(32).toString("base64url")}`;
    const server = createServer((req, res) => {
        const send = (status: number, body: unknown) => {
            res.writeHead(status, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
        };
        if (req.headers.origin !== undefined) return send(403, { error: "Forbidden" });
        if (
            req.method !== "POST" ||
            (req.url !== `${prefix}/tabs/ensure` && req.url !== `${prefix}/tabs/close`)
        )
            return send(404, { error: "Not found" });
        void (async () => {
            let body: unknown;
            try {
                let content = "";
                for await (const chunk of req) content += String(chunk);
                body = JSON.parse(content) as unknown;
            } catch {
                return send(400, { error: "Bad JSON" });
            }
            if (
                typeof body !== "object" ||
                body === null ||
                !("tabId" in body) ||
                typeof body.tabId !== "string"
            )
                return send(400, { error: "Missing tabId" });
            if (req.url === `${prefix}/tabs/close`) {
                tabHost.close(body.tabId);
                return send(200, { ok: true });
            }
            if (
                !("url" in body) ||
                typeof body.url !== "string" ||
                ("parentId" in body && typeof body.parentId !== "string")
            )
                return send(400, { error: "Invalid tab request" });
            const parentId =
                "parentId" in body && typeof body.parentId === "string" ? body.parentId : undefined;
            send(200, await tabHost.ensure({ tabId: body.tabId, url: body.url, parentId }));
        })().catch((error: unknown) => {
            send(500, { error: error instanceof Error ? error.message : String(error) });
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.removeListener("error", reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Browser control server has no TCP address");
    return {
        url: `http://127.0.0.1:${address.port}${prefix}`,
        close: () => {
            server.close();
            server.closeAllConnections();
        },
    };
}
