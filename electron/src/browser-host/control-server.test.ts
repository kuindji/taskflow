import { afterEach, expect, test } from "bun:test";
import { startControlServer } from "./control-server";

const servers: Awaited<ReturnType<typeof startControlServer>>[] = [];
afterEach(() => {
    for (const server of servers.splice(0)) server.close();
});

async function setup() {
    const calls: unknown[][] = [];
    const server = await startControlServer({
        ensure: async (req) => {
            calls.push(["ensure", req]);
            return { targetId: "target" };
        },
        close: (id) => {
            calls.push(["close", id]);
        },
    });
    servers.push(server);
    return { ...server, calls };
}

test("POST /tabs/ensure returns {targetId}", async () => {
    const { url, calls } = await setup();
    const body = { tabId: "a", url: "https://example.com/", parentId: "root" };
    const response = await fetch(`${url}/tabs/ensure`, {
        method: "POST",
        body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ targetId: "target" });
    expect(calls).toEqual([["ensure", body]]);
});

test("POST /tabs/close returns {ok:true}", async () => {
    const { url, calls } = await setup();
    const response = await fetch(`${url}/tabs/close`, {
        method: "POST",
        body: JSON.stringify({ tabId: "a" }),
    });
    expect(await response.json()).toEqual({ ok: true });
    expect(calls).toEqual([["close", "a"]]);
});

test("bad json is 400", async () => {
    const { url, calls } = await setup();
    expect((await fetch(`${url}/tabs/ensure`, { method: "POST", body: "{" })).status).toBe(400);
    expect(calls).toEqual([]);
});

test("unknown path is 404", async () => {
    const { url } = await setup();
    expect((await fetch(`${url}/unknown`)).status).toBe(404);
});

test("binds 127.0.0.1", async () => {
    const { url } = await setup();
    expect(new URL(url).hostname).toBe("127.0.0.1");
    expect(
        (await fetch(`${url}/tabs/close`, { method: "POST", body: '{"tabId":"a"}' })).status,
    ).toBe(200);
});

test("url ends with a secret path segment; a route without it is 404", async () => {
    const { url } = await setup();
    const parsed = new URL(url);
    expect(parsed.pathname).toMatch(/^\/[A-Za-z0-9_-]{43}$/);
    expect(
        (await fetch(`${parsed.origin}/tabs/ensure`, { method: "POST", body: "{}" })).status,
    ).toBe(404);
});

test("a request with an Origin header is 403", async () => {
    const { url, calls } = await setup();
    const response = await fetch(`${url}/tabs/ensure`, {
        method: "POST",
        headers: { Origin: "https://example.com" },
        body: "{}",
    });
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
});
