import { beforeEach, expect, it, mock } from "bun:test";
import type { BrowserHostHeartbeat, BrowserTab, BrowserTabOpenPayload } from "@taskflow/shared";
import { ApiRouter } from "../../src/api/router";
import { registerBrowserRoutes } from "../../src/api/routes/browser-routes";
import type { BrowserTabService } from "../../src/services/browser-tab-service";
import {
    BrowserHostUnavailableError,
    BrowserTabInputError,
    BrowserTabNotFoundError,
} from "../../src/services/browser-tab-errors";

const tab: BrowserTab = {
    id: "tab-1",
    scope: { kind: "task", taskId: "t1" },
    label: "Example",
    url: "https://example.com",
    createdAt: "2026-10-30T00:00:00.000Z",
    loaded: true,
    agentConnections: 0,
};
const fake = {
    open: mock(async (input: BrowserTabOpenPayload) => ({ ...tab, ...input })),
    list: mock<BrowserTabService["list"]>(() => ({ tabs: [tab], hostAvailable: true })),
    close: mock(async (_id: string) => false),
    hostHeartbeat: mock((_hb: BrowserHostHeartbeat) => {}),
    hostEvent: mock<BrowserTabService["hostEvent"]>(async () => {}),
};
let router: ApiRouter;

beforeEach(() => {
    for (const fn of Object.values(fake)) fn.mockClear();
    fake.open.mockImplementation(async (input) => {
        if (!input.url.trim())
            throw new BrowserTabInputError(
                "Field 'url' is required and must be a non-empty string",
            );
        return { ...tab, ...input };
    });
    fake.close.mockImplementation(async () => false);
    router = new ApiRouter();
    registerBrowserRoutes({
        apiRouter: router,
        browserTabService: fake as unknown as BrowserTabService,
    });
});

async function call(
    method: string,
    path = "/api/browser/tabs",
    body?: unknown,
    headers: Record<string, string> = {},
) {
    const response = await router.handle(
        new Request(`http://localhost${path}`, {
            method,
            headers: { "Content-Type": "application/json", Host: "127.0.0.1:7123", ...headers },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
    );
    if (!response) throw new Error(`No route for ${method} ${path}`);
    return response;
}

it("POST with a task header opens a task tab and returns 201 with endpoint built from Host", async () => {
    const response = await call(
        "POST",
        undefined,
        { url: tab.url, label: "Research" },
        { "x-taskflow-task-id": "t1", "x-taskflow-project-id": "p1" },
    );
    expect(response.status).toBe(201);
    expect(fake.open).toHaveBeenCalledWith({ url: tab.url, label: "Research", scope: tab.scope });
    expect(await response.json()).toEqual({
        tab: { ...tab, label: "Research" },
        endpoint: "http://127.0.0.1:7123/cdp/tab-1",
    });
});

it("POST with only a project header opens a project tab", async () => {
    const response = await call(
        "POST",
        undefined,
        { url: tab.url },
        { "x-taskflow-project-id": "p1" },
    );
    expect(response.status).toBe(201);
    expect(fake.open).toHaveBeenCalledWith({
        url: tab.url,
        scope: { kind: "project", projectId: "p1" },
    });
});

it("POST with no headers opens a master tab", async () => {
    expect((await call("POST", undefined, { url: tab.url })).status).toBe(201);
    expect(fake.open).toHaveBeenCalledWith({ url: tab.url, scope: { kind: "master" } });
});

it("POST scope=project without a project header returns 400 with the exact message", async () => {
    const response = await call(
        "POST",
        undefined,
        { url: tab.url, scope: "project" },
        { "x-taskflow-task-id": "t1" },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
        error: "Missing scope: no task, project or master context",
    });
    expect(fake.open).not.toHaveBeenCalled();
});

it("POST maps host-unavailable to 503 with the exact message", async () => {
    fake.open.mockImplementation(async () => {
        throw new BrowserHostUnavailableError();
    });
    const response = await call("POST", undefined, { url: tab.url });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
        error: "Browser not available on this machine: the Taskflow desktop app must be running here",
    });
});

it("POST with an empty url returns 400 with the exact message", async () => {
    const response = await call("POST", undefined, { url: "" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
        error: "Field 'url' is required and must be a non-empty string",
    });
});

it("GET lists tabs of the resolved scope with an endpoint each and hostAvailable", async () => {
    const cases: Array<{
        query: string;
        headers: Record<string, string>;
        scope: BrowserTab["scope"];
    }> = [
        {
            query: "",
            headers: { "x-taskflow-task-id": "t1", "x-taskflow-project-id": "p1" },
            scope: tab.scope,
        },
        {
            query: "?scope=project",
            headers: { "x-taskflow-task-id": "t1", "x-taskflow-project-id": "p1" },
            scope: { kind: "project", projectId: "p1" },
        },
        {
            query: "?scope=master",
            headers: { "x-taskflow-task-id": "t1" },
            scope: { kind: "master" },
        },
        { query: "", headers: {}, scope: { kind: "master" } },
    ];
    for (const { query, headers, scope } of cases) {
        const response = await call("GET", `/api/browser/tabs${query}`, undefined, headers);
        expect(response.status).toBe(200);
        expect(fake.list).toHaveBeenLastCalledWith({ scope });
        expect(await response.json()).toEqual({
            tabs: [{ ...tab, endpoint: "http://127.0.0.1:7123/cdp/tab-1" }],
            hostAvailable: true,
        });
    }
});

it("DELETE unknown id returns 404 Browser tab not found", async () => {
    const response = await call("DELETE", "/api/browser/tabs/unknown");
    expect(fake.close).toHaveBeenCalledWith("unknown");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Browser tab not found" });
});

it("DELETE closes a known tab", async () => {
    fake.close.mockImplementation(async () => true);
    const response = await call("DELETE", "/api/browser/tabs/tab-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
});

it("maps BrowserTabNotFoundError to 404", async () => {
    fake.open.mockImplementation(async () => {
        throw new BrowserTabNotFoundError("Browser tab not found");
    });
    const response = await call("POST", undefined, { url: tab.url });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Browser tab not found" });
});

it("PUT /api/browser/host passes the heartbeat to the service", async () => {
    const heartbeat: BrowserHostHeartbeat = {
        controlUrl: "http://127.0.0.1:1234",
        debugPort: 5678,
        loaded: [],
        appTargetIds: ["app"],
    };
    const response = await call("PUT", "/api/browser/host", heartbeat);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fake.hostHeartbeat).toHaveBeenCalledWith(heartbeat);
});

it("POST /api/browser/host/events passes the event to the service", async () => {
    const event = { type: "navigated", tabId: tab.id, url: tab.url, title: "Example" };
    const response = await call("POST", "/api/browser/host/events", event);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fake.hostEvent).toHaveBeenCalledWith(event);
});
