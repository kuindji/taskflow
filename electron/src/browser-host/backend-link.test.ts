import { afterEach, expect, test } from "bun:test";
import type { BrowserHostEvent, BrowserHostHeartbeat } from "@taskflow/shared";
import { backendOrigin } from "../backend-url";
import { createBackendLink } from "./backend-link";

const stops: (() => void)[] = [];
afterEach(() => {
    for (const stop of stops.splice(0)) stop();
});

function setup() {
    const calls: { url: string; method: string | undefined; body: unknown }[] = [];
    const scheduled: number[] = [];
    const logs: unknown[] = [];
    let tick: () => Promise<void> = () => Promise.resolve();
    let port: number | null = 7123;
    let respond: () => Promise<{ status: number }> = () => Promise.resolve({ status: 200 });
    const heartbeat: BrowserHostHeartbeat = {
        controlUrl: "http://127.0.0.1:1234/secret",
        debugPort: 4321,
        loaded: [{ tabId: "a", targetId: "target-a", url: "about:blank", parentId: "root" }],
        appTargetIds: ["app", "park"],
    };
    const link = createBackendLink({
        getBackendPort: () => port,
        heartbeat: () => Promise.resolve(heartbeat),
        fetch: (url, init) => {
            if (typeof init.body !== "string") throw new Error("Expected a JSON string body");
            calls.push({
                url,
                method: init.method,
                body: JSON.parse(init.body) as unknown,
            });
            return respond();
        },
        schedule: (fn, ms) => {
            tick = fn;
            scheduled.push(ms);
            return () => {
                tick = () => Promise.resolve();
            };
        },
        log: (message) => {
            logs.push(message);
        },
    });
    stops.push(link.stop);
    return {
        link,
        calls,
        scheduled,
        logs,
        heartbeat,
        tick: () => tick(),
        setPort: (next: number | null) => {
            port = next;
        },
        setResponse: (next: typeof respond) => {
            respond = next;
        },
    };
}

const event: BrowserHostEvent = { type: "closed", tabId: "a" };

test("heartbeat PUTs controlUrl, debugPort, loaded and appTargetIds every 5000 ms", async () => {
    const { calls, scheduled, heartbeat, tick } = setup();
    expect(scheduled).toEqual([5000]);
    await tick();
    await tick();
    expect(calls).toEqual(
        [1, 2].map(() => ({
            url: `${backendOrigin(7123)}/api/browser/host`,
            method: "PUT",
            body: heartbeat,
        })),
    );
});

test("uses the current backend port on each tick", async () => {
    const { calls, tick, setPort } = setup();
    await tick();
    setPort(8123);
    await tick();
    expect(calls.map((call) => call.url)).toEqual([
        `${backendOrigin(7123)}/api/browser/host`,
        `${backendOrigin(8123)}/api/browser/host`,
    ]);
});

test("flush sends a heartbeat immediately", async () => {
    const { link, calls, heartbeat } = setup();
    await link.flush();
    expect(calls.map((call) => call.body)).toEqual([heartbeat]);
});

test("event POSTs to /api/browser/host/events", async () => {
    const { link, calls } = setup();
    await link.event(event);
    expect(calls).toEqual([
        { url: `${backendOrigin(7123)}/api/browser/host/events`, method: "POST", body: event },
    ]);
});

test("a failed heartbeat is dropped, not retried", async () => {
    const { link, calls, tick, setResponse, heartbeat } = setup();
    setResponse(() => Promise.reject(new Error("offline")));
    await link.flush();
    heartbeat.loaded = [];
    setResponse(() => Promise.resolve({ status: 200 }));
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toEqual(heartbeat);
});

test("an event posted before a flush reaches fetch before that heartbeat", async () => {
    const { link, calls, heartbeat, setResponse } = setup();
    let finish!: (value: { status: number }) => void;
    setResponse(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    const posting = link.event(event);
    const flushing = link.flush();
    await Promise.resolve();
    expect(calls.map((call) => call.body)).toEqual([event]);
    setResponse(() => Promise.resolve({ status: 200 }));
    finish({ status: 200 });
    await Promise.all([posting, flushing]);
    expect(calls.map((call) => call.body)).toEqual([event, heartbeat]);
});

test("an event that fails without a response is retried on the next tick, before that tick's heartbeat", async () => {
    const { link, calls, setResponse, tick, heartbeat, setPort } = setup();
    setResponse(() => Promise.reject(new Error("offline")));
    await link.event(event);
    await link.flush();
    expect(calls).toHaveLength(1);
    setPort(8123);
    setResponse(() => Promise.resolve({ status: 200 }));
    await tick();
    expect(calls.slice(0, 3).map((call) => call.body)).toEqual([event, event, heartbeat]);
    expect(calls[1].url).toBe(`${backendOrigin(8123)}/api/browser/host/events`);
});

test("an event answered with HTTP 500 is retried on the next ticks and dropped after 3 attempts", async () => {
    const { link, calls, setResponse, tick, logs } = setup();
    setResponse(() => Promise.resolve({ status: 500 }));
    await link.event(event);
    await tick();
    await tick();
    await tick();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(3);
    expect(logs).toHaveLength(1);
    expect(calls.some((call) => call.method === "PUT")).toBe(true);
});

test("an event answered with HTTP 400 is not retried", async () => {
    const { link, calls, setResponse, tick } = setup();
    setResponse(() => Promise.resolve({ status: 400 }));
    await link.event(event);
    await tick();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls[1].method).toBe("PUT");
});
