import { expect, it, mock } from "bun:test";
import {
    CdpTargetFilter,
    type CdpMessage,
    type CdpFilterDeps,
} from "../../../src/services/cdp/cdp-filter";

function fixture(overrides: Partial<CdpFilterDeps> = {}) {
    const client: CdpMessage[] = [];
    const upstream: CdpMessage[] = [];
    const family = new Set(["root", "child"]);
    const pages: Record<string, string> = {
        "tab-root": "T-root",
        "tab-child": "T-child",
        "tab-other": "T-other",
        "tab-app": "T-app",
    };
    const deps: CdpFilterDeps = {
        rootTabId: "root",
        isAllowedTab: (id) => family.has(id),
        resolveTarget: async (id) => (id === "T-app" ? null : { tabId: id.slice(2) }),
        pageOfTabTarget: mock(async (id: string) => pages[id] ?? null),
        openChild: mock(async (_url: string) => ({ targetId: "T-child" })),
        closeTarget: mock(async (_id: string) => true),
        runOnRootPage: mock(async (_method: string, _params: Record<string, unknown>) => ({
            result: { cookies: [{ name: "a", value: "b" }] },
        })),
        browserContextId: "browser-context",
        ...overrides,
    };
    const filter = new CdpTargetFilter(deps, {
        toClient: (m) => client.push(m),
        toUpstream: (m) => upstream.push(m),
    });
    async function attach(
        targetId = "T-root",
        sessionId = "S-root",
        outer?: string,
        type = "page",
    ) {
        await filter.fromUpstream({
            method: "Target.attachedToTarget",
            ...(outer ? { sessionId: outer } : {}),
            params: { sessionId, targetInfo: { targetId, type }, waitingForDebugger: true },
        });
    }
    return { filter, client, upstream, deps, attach, family };
}

function refusal(request: CdpMessage): CdpMessage {
    return {
        id: request.id,
        ...(request.sessionId ? { sessionId: request.sessionId } : {}),
        error: { code: -32000, message: `Not allowed by Taskflow: ${request.method}` },
    };
}

it("getTargets result lists only family targets", async () => {
    const f = fixture();
    await f.filter.fromClient({ id: 1, method: "Target.getTargets" });
    await f.filter.fromUpstream({
        id: 1,
        result: {
            targetInfos: ["root", "child", "other", "app"].map((id) => ({
                targetId: `T-${id}`,
                type: "page",
            })),
        },
    });
    expect(f.client).toEqual([
        {
            id: 1,
            result: {
                targetInfos: ["root", "child"].map((id) => ({ targetId: `T-${id}`, type: "page" })),
            },
        },
    ]);
});

it("a request reusing an in-flight id is refused, so getTargets stays filtered", async () => {
    const f = fixture();
    await f.filter.fromClient({ id: 1, method: "Target.getTargets" });
    await f.filter.fromClient({ id: 1, method: "Browser.getVersion" });
    expect(f.upstream).toEqual([{ id: 1, method: "Target.getTargets" }]);
    expect(f.client).toEqual([
        {
            id: 1,
            error: { code: -32000, message: "Not allowed by Taskflow: duplicate request id" },
        },
    ]);
    await f.filter.fromUpstream({
        id: 1,
        result: { targetInfos: [{ targetId: "T-other", type: "page" }] },
    });
    expect(f.client[1]).toEqual({ id: 1, result: { targetInfos: [] } });
});

it("targetCreated for another task's target is not forwarded", async () => {
    const f = fixture();
    await f.filter.fromUpstream({
        method: "Target.targetCreated",
        params: { targetInfo: { targetId: "T-other", type: "page" } },
    });
    expect(f.client).toEqual([]);
});

it("attachedToTarget for T-app is resumed and detached, never forwarded", async () => {
    const f = fixture();
    await f.attach("T-app", "S-app");
    expect(f.client).toEqual([]);
    expect(f.upstream.map(({ id: _id, ...message }) => message)).toEqual([
        { method: "Runtime.runIfWaitingForDebugger", sessionId: "S-app" },
        {
            method: "Target.detachFromTarget",
            params: { sessionId: "S-app" },
        },
    ]);
    expect(typeof f.upstream[0]?.id).toBe("number");
    expect(typeof f.upstream[1]?.id).toBe("number");
    expect(f.upstream[0]?.id).not.toBe(f.upstream[1]?.id);
});

it("attachedToTarget for T-root is forwarded and its session allowed", async () => {
    const f = fixture();
    await f.attach();
    const command = { id: 1, method: "Page.enable", sessionId: "S-root" };
    await f.filter.fromClient(command);
    expect(f.client[0]?.method).toBe("Target.attachedToTarget");
    expect(f.upstream).toEqual([command]);
});

it("nested attachedToTarget under an allowed session is forwarded", async () => {
    const f = fixture();
    await f.attach();
    await f.attach("iframe", "S-iframe", "S-root", "iframe");
    await f.filter.fromClient({ id: 1, method: "Runtime.enable", sessionId: "S-iframe" });
    expect(f.client).toHaveLength(2);
    expect(f.upstream[0]?.sessionId).toBe("S-iframe");
});

const denied: Array<[string, string, Record<string, unknown>?, string?]> = [
    ["command on an unknown sessionId is refused with -32000", "Page.enable", {}, "unknown"],
    [
        "attachToTarget T-other is refused with the exact message",
        "Target.attachToTarget",
        { targetId: "T-other", flatten: true },
    ],
    ["attachToBrowserTarget is refused", "Target.attachToBrowserTarget"],
    ["Browser.close is refused", "Browser.close"],
    ["createBrowserContext is refused", "Target.createBrowserContext"],
    [
        "sendMessageToTarget is refused, even on an allowed session",
        "Target.sendMessageToTarget",
        { message: "{}" },
        "S-root",
    ],
    [
        "attachToTarget with flatten false is refused",
        "Target.attachToTarget",
        { targetId: "T-root", flatten: false },
    ],
    ["setAutoAttach with flatten false is refused", "Target.setAutoAttach", { flatten: false }],
    [
        "attachToTarget T-app sent on an allowed page session is refused",
        "Target.attachToTarget",
        { targetId: "T-app", flatten: true },
        "S-root",
    ],
    ["an unlisted browser-level method (Tracing.start) is refused", "Tracing.start"],
    ["Browser.crash on an allowed page session is refused", "Browser.crash", {}, "S-root"],
    [
        "Browser.crashGpuProcess on an allowed page session is refused",
        "Browser.crashGpuProcess",
        {},
        "S-root",
    ],
    ["Browser.close on an allowed page session is refused", "Browser.close", {}, "S-root"],
    [
        "Browser.setPermission on an allowed page session is refused with that sessionId",
        "Browser.setPermission",
        {},
        "S-root",
    ],
    ["Browser.grantPermissions at browser level is refused", "Browser.grantPermissions"],
    [
        "setDownloadBehavior naming another browserContextId is refused",
        "Browser.setDownloadBehavior",
        { browserContextId: "app-context" },
    ],
    [
        "Storage.getCookies naming another browserContextId is refused",
        "Storage.getCookies",
        { browserContextId: "app-context" },
    ],
    [
        "Tracing.start on an allowed page session is refused with that sessionId",
        "Tracing.start",
        {},
        "S-root",
    ],
    [
        "ServiceWorker.enable on an allowed page session is refused",
        "ServiceWorker.enable",
        {},
        "S-root",
    ],
    [
        "ServiceWorker.stopAllWorkers on an allowed page session is refused",
        "ServiceWorker.stopAllWorkers",
        {},
        "S-root",
    ],
    [
        "Memory.simulatePressureNotification on an allowed page session is refused",
        "Memory.simulatePressureNotification",
        {},
        "S-root",
    ],
    [
        "a method of an unknown domain on an allowed session is refused",
        "Unknown.enable",
        {},
        "S-root",
    ],
    ["closeTarget on T-other is refused", "Target.closeTarget", { targetId: "T-other" }],
    [
        "a refused command on an allowed session replies with that sessionId",
        "Target.createBrowserContext",
        {},
        "S-root",
    ],
    ["spike: WebMCP.enable on an allowed session is refused", "WebMCP.enable", {}, "S-root"],
];
for (const [name, method, params = {}, sessionId] of denied) {
    it(name, async () => {
        const f = fixture();
        await f.attach();
        f.client.length = 0;
        const request = { id: 42, method, params, ...(sessionId ? { sessionId } : {}) };
        await f.filter.fromClient(request);
        expect(f.client).toEqual([refusal(request)]);
        expect(f.upstream).toEqual([]);
    });
}

it("setDownloadBehavior without browserContextId replies {} and is not forwarded", async () => {
    const f = fixture();
    await f.filter.fromClient({
        id: 1,
        method: "Browser.setDownloadBehavior",
        params: { behavior: "allow" },
    });
    expect(f.client).toEqual([{ id: 1, result: {} }]);
    expect(f.upstream).toEqual([]);
});

for (const [method, translated, params] of [
    ["Storage.getCookies", "Network.getAllCookies", {}],
    ["Storage.setCookies", "Network.setCookies", { cookies: [{ name: "c", value: "d" }] }],
    ["Storage.clearCookies", "Network.clearBrowserCookies", {}],
] as const) {
    it(`${method} runs ${translated} through runOnRootPage and replies with its result`, async () => {
        const f = fixture();
        await f.filter.fromClient({ id: 2, method, params });
        expect(f.deps.runOnRootPage).toHaveBeenCalledWith(translated, params);
        expect(f.client).toEqual([{ id: 2, result: { cookies: [{ name: "a", value: "b" }] } }]);
        expect(f.upstream).toEqual([]);
    });
}

it("Storage.getCookies on an allowed page session replies with that sessionId", async () => {
    const f = fixture();
    await f.attach();
    await f.filter.fromClient({ id: 3, sessionId: "S-root", method: "Storage.getCookies" });
    expect(f.client[1]).toEqual({
        id: 3,
        sessionId: "S-root",
        result: { cookies: [{ name: "a", value: "b" }] },
    });
});

it("a runOnRootPage error is passed back as the reply's error", async () => {
    const f = fixture({
        runOnRootPage: async () => ({ error: { code: -32000, message: "Timeout" } }),
    });
    await f.filter.fromClient({ id: 4, method: "Storage.getCookies" });
    expect(f.client).toEqual([{ id: 4, error: { code: -32000, message: "Timeout" } }]);
});

it("Page.navigate and Runtime.evaluate on an allowed session are forwarded", async () => {
    const f = fixture();
    await f.attach();
    const commands = [
        {
            id: 1,
            sessionId: "S-root",
            method: "Page.navigate",
            params: { url: "https://example.com" },
        },
        { id: 2, sessionId: "S-root", method: "Runtime.evaluate", params: { expression: "1+1" } },
    ];
    for (const command of commands) await f.filter.fromClient(command);
    expect(f.upstream).toEqual(commands);
});

for (const tabTarget of [false, true]) {
    it(`createTarget ${tabTarget ? "announced through a family tab target" : "calls openChild and"} replies only after the new target's attachedToTarget was forwarded`, async () => {
        const f = fixture();
        const creating = f.filter.fromClient({
            id: 5,
            method: "Target.createTarget",
            params: { url: "https://example.com" },
        });
        await Bun.sleep(1);
        expect(f.deps.openChild).toHaveBeenCalledWith("https://example.com");
        expect(f.client).toEqual([]);
        await f.attach(
            tabTarget ? "tab-child" : "T-child",
            "S-child",
            undefined,
            tabTarget ? "tab" : "page",
        );
        await creating;
        expect(f.client.map((m) => m.method ?? m.id)).toEqual(["Target.attachedToTarget", 5]);
        expect(f.client[1]).toEqual({ id: 5, result: { targetId: "T-child" } });
    });
}

it("createTarget replies after 2000 ms when no attach arrives", async () => {
    const f = fixture();
    const start = performance.now();
    await f.filter.fromClient({ id: 6, method: "Target.createTarget" });
    expect(performance.now() - start).toBeGreaterThanOrEqual(1950);
    expect(f.client).toEqual([{ id: 6, result: { targetId: "T-child" } }]);
});

it("closeTarget on T-child calls closeTarget and is not forwarded", async () => {
    const f = fixture();
    await f.filter.fromClient({
        id: 7,
        method: "Target.closeTarget",
        params: { targetId: "T-child" },
    });
    expect(f.deps.closeTarget).toHaveBeenCalledWith("T-child");
    expect(f.client).toEqual([{ id: 7, result: { success: true } }]);
    expect(f.upstream).toEqual([]);
});

it("createTarget and closeTarget sent on an allowed child session reply with that sessionId", async () => {
    const f = fixture();
    await f.attach("T-child", "S-child");
    const creating = f.filter.fromClient({
        id: 8,
        method: "Target.createTarget",
        sessionId: "S-child",
    });
    await Bun.sleep(1);
    await f.attach("T-child", "S-created");
    await creating;
    await f.filter.fromClient({
        id: 9,
        method: "Target.closeTarget",
        sessionId: "S-child",
        params: { targetId: "T-child" },
    });
    expect(f.client.filter((m) => m.id)).toEqual([
        { id: 8, sessionId: "S-child", result: { targetId: "T-child" } },
        { id: 9, sessionId: "S-child", result: { success: true } },
    ]);
});

it("upstream messages keep order while an attach waits on resolveTarget", async () => {
    let resolve!: (value: { tabId: string }) => void;
    const f = fixture({
        resolveTarget: () =>
            new Promise((r) => {
                resolve = r;
            }),
    });
    const first = f.attach();
    const second = f.filter.fromUpstream({
        method: "Runtime.executionContextCreated",
        sessionId: "S-root",
        params: { context: {} },
    });
    await Bun.sleep(1);
    expect(f.client).toEqual([]);
    resolve({ tabId: "root" });
    await Promise.all([first, second]);
    expect(f.client.map((m) => m.method)).toEqual([
        "Target.attachedToTarget",
        "Runtime.executionContextCreated",
    ]);
});

it("a tab target whose page is in the family: its attachedToTarget is forwarded and its session allowed", async () => {
    const f = fixture();
    await f.attach("tab-root", "S-tab", undefined, "tab");
    await f.filter.fromClient({
        id: 10,
        sessionId: "S-tab",
        method: "Target.setAutoAttach",
        params: { flatten: true, autoAttach: true },
    });
    expect(f.deps.pageOfTabTarget).toHaveBeenCalledWith("tab-root");
    expect(f.client).toHaveLength(1);
    expect(f.upstream[0]?.method).toBe("Target.setAutoAttach");
});

it("a page attached under that allowed tab session is forwarded", async () => {
    const f = fixture();
    await f.attach("tab-root", "S-tab", undefined, "tab");
    await f.attach("T-root", "S-page", "S-tab");
    await f.filter.fromClient({ id: 11, sessionId: "S-page", method: "Runtime.enable" });
    expect(f.client).toHaveLength(2);
    expect(f.upstream[0]?.sessionId).toBe("S-page");
});

for (const target of ["tab-other", "tab-app"]) {
    it(`a tab target whose page is ${target} is resumed and detached, never forwarded`, async () => {
        const f = fixture();
        await f.attach(target, "S-denied", undefined, "tab");
        expect(f.client).toEqual([]);
        expect(f.upstream.map((m) => m.method)).toEqual([
            "Runtime.runIfWaitingForDebugger",
            "Target.detachFromTarget",
        ]);
    });
}

it("targetCreated and getTargets list a family tab target and drop another task's tab target", async () => {
    const f = fixture();
    const targetInfos = ["tab-root", "tab-other"].map((targetId) => ({ targetId, type: "tab" }));
    for (const targetInfo of targetInfos)
        await f.filter.fromUpstream({ method: "Target.targetCreated", params: { targetInfo } });
    await f.filter.fromClient({ id: 12, method: "Target.getTargets" });
    await f.filter.fromUpstream({ id: 12, result: { targetInfos } });
    expect(f.client).toEqual([
        { method: "Target.targetCreated", params: { targetInfo: targetInfos[0] } },
        { id: 12, result: { targetInfos: [targetInfos[0]] } },
    ]);
    expect(f.deps.pageOfTabTarget).toHaveBeenCalledTimes(2);
});

it("attachToTarget and closeTarget naming a family tab target are allowed; closeTarget closes its page's tab", async () => {
    const f = fixture();
    await f.filter.fromUpstream({
        method: "Target.targetCreated",
        params: { targetInfo: { targetId: "tab-root", type: "tab" } },
    });
    const request = {
        id: 13,
        method: "Target.attachToTarget",
        params: { targetId: "tab-root", flatten: true },
    };
    await f.filter.fromClient(request);
    await f.filter.fromClient({
        id: 14,
        method: "Target.closeTarget",
        params: { targetId: "tab-root" },
    });
    expect(f.upstream).toEqual([request]);
    expect(f.deps.closeTarget).toHaveBeenCalledWith("T-root");
});

it("responses to internal resume/detach commands are swallowed", async () => {
    const f = fixture();
    await f.attach("T-app", "S-app");
    for (const command of f.upstream)
        await f.filter.fromUpstream({
            id: command.id,
            ...(command.sessionId ? { sessionId: command.sessionId } : {}),
            result: {},
        });
    expect(f.client).toEqual([]);
});

it("targetDestroyed uses its last decision and detached sessions stop forwarding", async () => {
    const f = fixture();
    await f.attach();
    await f.filter.fromUpstream({
        method: "Target.targetDestroyed",
        params: { targetId: "T-root" },
    });
    await f.filter.fromUpstream({
        method: "Target.detachedFromTarget",
        params: { sessionId: "S-root" },
    });
    await f.filter.fromUpstream({ method: "Runtime.consoleAPICalled", sessionId: "S-root" });
    expect(f.client.map((m) => m.method)).toEqual([
        "Target.attachedToTarget",
        "Target.targetDestroyed",
        "Target.detachedFromTarget",
    ]);
});

it("browser-level worker targets are denied without waiting on resolveTarget", async () => {
    const resolveTarget = mock(async (id: string) => ({ tabId: id.slice(2) }));
    const f = fixture({ resolveTarget });
    for (const type of ["service_worker", "shared_worker", "browser"]) {
        await f.filter.fromUpstream({
            method: "Target.targetCreated",
            params: { targetInfo: { targetId: `W-${type}`, type } },
        });
    }
    await f.attach("W-service_worker", "S-sw", undefined, "service_worker");
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(f.client).toEqual([]);
    expect(f.upstream.map((m) => m.method)).toEqual([
        "Runtime.runIfWaitingForDebugger",
        "Target.detachFromTarget",
    ]);
});

it("a worker attached under an allowed session is still forwarded", async () => {
    const f = fixture();
    await f.attach();
    f.client.length = 0;
    await f.attach("W-1", "S-worker", "S-root", "worker");
    expect(f.client.map((m) => m.params?.sessionId)).toEqual(["S-worker"]);
});
