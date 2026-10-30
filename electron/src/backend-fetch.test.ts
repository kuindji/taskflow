import { expect, test } from "bun:test";
import { createBackendFetch } from "./backend-fetch";

function recorder(tokenFor: (origin: string) => string | null) {
    const calls: { url: unknown; init?: RequestInit }[] = [];
    const fetchImpl = Object.assign(
        async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url, init });
            return new Response("ok");
        },
        { preconnect: fetch.preconnect },
    );
    return { calls, backendFetch: createBackendFetch({ tokenFor, fetchImpl }) };
}

test("adds Authorization: Bearer <token> for an origin that has one", async () => {
    const { calls, backendFetch } = recorder(() => "TOKEN");
    await backendFetch("http://127.0.0.1:7100", "/api/settings");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer TOKEN");
});

test("sends no Authorization header for an origin without a token", async () => {
    const { calls, backendFetch } = recorder(() => null);
    await backendFetch("http://127.0.0.1:7100", "/api/settings");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBeNull();
});

test("keeps the caller's method, body, signal, redirect and headers", async () => {
    const { calls, backendFetch } = recorder(() => "TOKEN");
    const signal = new AbortController().signal;
    await backendFetch("http://127.0.0.1:7100", "/api/settings", {
        method: "PATCH",
        body: "body",
        signal,
        redirect: "error",
        headers: { "X-Test": "kept" },
    });
    expect(calls[0].init).toMatchObject({
        method: "PATCH",
        body: "body",
        signal,
        redirect: "error",
    });
    expect(calls[0].init?.signal).toBe(signal);
    expect(new Headers(calls[0].init?.headers).get("x-test")).toBe("kept");
});

test("looks the token up by normalised origin", async () => {
    const origins: string[] = [];
    const { calls, backendFetch } = recorder((origin) => {
        origins.push(origin);
        return null;
    });
    await backendFetch("http://127.0.0.1:7100/", "/api/settings");
    expect(origins).toEqual(["http://127.0.0.1:7100"]);
    expect(calls[0].url).toBe("http://127.0.0.1:7100/api/settings");
});

test("refuses a path that does not start with a slash", async () => {
    const { calls, backendFetch } = recorder(() => null);
    let error: unknown;
    try {
        await backendFetch("http://127.0.0.1:7100", "api/settings");
    } catch (err) {
        error = err;
    }
    expect(error).toEqual(new Error('backendFetch path must start with "/": api/settings'));
    expect(calls).toEqual([]);
});
