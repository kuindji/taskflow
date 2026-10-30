import { afterEach, describe, expect, it } from "bun:test";
import { createBrowserHostClient } from "../../src/services/browser-host-client";
import { BrowserHostUnavailableError } from "../../src/services/browser-tab-errors";
import { expectRejects } from "../expect-rejects";

describe("BrowserHostClient", () => {
    const servers: ReturnType<typeof Bun.serve>[] = [];
    const unavailable =
        "Browser not available on this machine: the Taskflow desktop app must be running here";
    const client = createBrowserHostClient();

    afterEach(async () => {
        await Promise.all(servers.splice(0).map((server) => server.stop(true)));
    });

    function serve(fetch: (request: Request) => Response | Promise<Response>): string {
        const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
        servers.push(server);
        return server.url.origin;
    }

    it("ensure posts {tabId,url,parentId} to /tabs/ensure and returns targetId", async () => {
        const requests: { path: string; method: string; body: unknown }[] = [];
        const url = serve(async (request) => {
            requests.push({
                path: new URL(request.url).pathname,
                method: request.method,
                body: await request.json(),
            });
            return Response.json({ targetId: "target-1" });
        });
        const input = { tabId: "tab-1", url: "https://example.com", parentId: "parent-1" };
        expect(await client.ensure(url, input)).toEqual({ targetId: "target-1" });
        expect(requests).toEqual([{ path: "/tabs/ensure", method: "POST", body: input }]);
    });

    it("close posts {tabId} to /tabs/close", async () => {
        const requests: { path: string; method: string; body: unknown }[] = [];
        const url = serve(async (request) => {
            requests.push({
                path: new URL(request.url).pathname,
                method: request.method,
                body: await request.json(),
            });
            return Response.json({ ok: true });
        });
        await client.close(url, "tab-1");
        expect(requests).toEqual([
            { path: "/tabs/close", method: "POST", body: { tabId: "tab-1" } },
        ]);
    });

    async function expectUnavailable(promise: Promise<unknown>): Promise<void> {
        await expectRejects(
            promise.catch((error: unknown) => {
                expect(error).toBeInstanceOf(BrowserHostUnavailableError);
                throw error;
            }),
            unavailable,
        );
    }

    it("a 500 throws BrowserHostUnavailableError", async () => {
        const url = serve(() => new Response("failed", { status: 500 }));
        await expectUnavailable(client.ensure(url, { tabId: "tab-1", url: "https://example.com" }));
        await expectUnavailable(client.close(url, "tab-1"));
    });

    it("a refused connection throws BrowserHostUnavailableError", async () => {
        const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
        const url = server.url.origin;
        await server.stop(true);
        await expectUnavailable(client.ensure(url, { tabId: "tab-1", url: "https://example.com" }));
        await expectUnavailable(client.close(url, "tab-1"));
    });
});
