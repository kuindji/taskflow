// Spike: raw probes against Electron's real debugging port (never through the proxy).
// Records targets, browser contexts, tab targets, native Target.createTarget and
// which session context-scoped commands act on when browserContextId is omitted.
//
// Run (spike app running): bun docs/superpowers/plans/2026-10-30-agent-browser/spike/probe.ts
const MAIN = "http://127.0.0.1:9335";
const info = (await (await fetch(`${MAIN}/info`)).json()) as any;
const version = (await (
    await fetch(`http://127.0.0.1:${info.debugPort}/json/version`)
).json()) as any;

const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const waiters = new Map<number, (m: any) => void>();
const events: any[] = [];
ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && waiters.has(m.id)) {
        waiters.get(m.id)!(m);
        waiters.delete(m.id);
    } else events.push(m);
};
function send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
): Promise<any> {
    const id = nextId++;
    return new Promise((resolve) => {
        waiters.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
}
const show = (title: string, v: unknown) =>
    console.log(`\n## ${title}\n${JSON.stringify(v, null, 2)}`);

const name = (id: string) =>
    Object.entries(info.tabs).find(([, t]: any) => t.targetId === id)?.[0] ??
    (id === info.appTargetId ? "APP" : "?");

const all = await send("Target.getTargets", { filter: [{}] });
show(
    "Target.getTargets filter [{}] (all types)",
    all.result.targetInfos.map((t: any) => ({ name: name(t.targetId), ...t })),
);
const def = await send("Target.getTargets");
show(
    "Target.getTargets default filter",
    def.result.targetInfos.map((t: any) => ({
        name: name(t.targetId),
        type: t.type,
        ctx: t.browserContextId,
    })),
);
show("Target.getBrowserContexts", await send("Target.getBrowserContexts"));

// Tab targets -> page mapping, the plan's method, on separate connections.
async function pageOfTab(tabTargetId: string): Promise<{ page: string | null; ms: number }> {
    const t0 = performance.now();
    const c = new WebSocket(version.webSocketDebuggerUrl);
    return new Promise((resolve) => {
        const done = (page: string | null) => {
            c.close();
            resolve({ page, ms: Math.round(performance.now() - t0) });
        };
        setTimeout(() => done(null), 2000);
        c.onopen = () =>
            c.send(
                JSON.stringify({
                    id: 1,
                    method: "Target.attachToTarget",
                    params: { targetId: tabTargetId, flatten: true },
                }),
            );
        c.onmessage = (e) => {
            const m = JSON.parse(String(e.data));
            if (m.id === 1) {
                if (m.error) return done(null);
                c.send(
                    JSON.stringify({
                        id: 2,
                        sessionId: m.result.sessionId,
                        method: "Target.setAutoAttach",
                        params: { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
                    }),
                );
            }
            if (
                m.method === "Target.attachedToTarget" &&
                m.sessionId &&
                m.params.targetInfo.type === "page"
            )
                done(m.params.targetInfo.targetId);
        };
    });
}
const tabTargets = all.result.targetInfos.filter((t: any) => t.type === "tab");
const mapping = [];
for (const t of tabTargets) {
    const r = await pageOfTab(t.targetId);
    mapping.push({
        tab: t.targetId,
        page: r.page,
        pageName: r.page ? name(r.page) : null,
        ms: r.ms,
    });
}
show("tab target -> page (attach + nested setAutoAttach)", mapping);

const ctxA = all.result.targetInfos.find(
    (t: any) => t.targetId === info.tabs.A.targetId,
)?.browserContextId;
const ctxApp = all.result.targetInfos.find(
    (t: any) => t.targetId === info.appTargetId,
)?.browserContextId;
show("contexts", { tabsCtx: ctxA, appCtx: ctxApp });

// Context-scoped commands with and without browserContextId.
const cookiesNoCtx = await send("Storage.getCookies");
const cookiesTabs = await send("Storage.getCookies", { browserContextId: ctxA });
show("Storage.getCookies", {
    noCtx:
        cookiesNoCtx.result?.cookies?.map((c: any) => `${c.name}@${c.domain}`) ??
        cookiesNoCtx.error,
    tabsCtx:
        cookiesTabs.result?.cookies?.map((c: any) => `${c.name}@${c.domain}`) ?? cookiesTabs.error,
});
// Set a marker cookie without a context and see where it lands.
await send("Storage.setCookies", {
    cookies: [{ name: "probe_noctx", value: "1", domain: "127.0.0.1", path: "/" }],
});
const after = await send("Storage.getCookies", { browserContextId: ctxA });
const afterDefault = await send("Storage.getCookies");
show("Storage.setCookies without ctx lands in", {
    tabsCtxHasIt: (after.result?.cookies ?? []).some((c: any) => c.name === "probe_noctx"),
    defaultHasIt: (afterDefault.result?.cookies ?? []).some((c: any) => c.name === "probe_noctx"),
});
await send("Storage.clearCookies"); // clears the default (app) context only if it acts there; tabs' must survive
const tabsAfterClear = await send("Storage.getCookies", { browserContextId: ctxA });
show(
    "Storage.clearCookies without ctx: tabs ctx cookies after",
    tabsAfterClear.result?.cookies?.map((c: any) => c.name) ?? tabsAfterClear.error,
);
show(
    "Browser.setDownloadBehavior no ctx",
    await send("Browser.setDownloadBehavior", { behavior: "default" }),
);
show(
    "Browser.grantPermissions no ctx",
    await send("Browser.grantPermissions", {
        permissions: ["geolocation"],
        origin: "http://127.0.0.1:9340",
    }),
);
show("Browser.resetPermissions no ctx", await send("Browser.resetPermissions"));
show(
    "Browser.setDownloadBehavior tabs ctx",
    await send("Browser.setDownloadBehavior", { behavior: "default", browserContextId: ctxA }),
);
show(
    "Browser.grantPermissions tabs ctx",
    await send("Browser.grantPermissions", {
        permissions: ["geolocation"],
        browserContextId: ctxA,
    }),
);
// Default-context cookies via a page session's Network domain (the partition's own jar).
{
    const a = await send("Target.attachToTarget", {
        targetId: info.tabs.A.targetId,
        flatten: true,
    });
    const r = await send("Network.getAllCookies", {}, a.result.sessionId);
    show(
        "Network.getAllCookies on A's session",
        r.result?.cookies?.map((c: any) => `${c.name}@${c.domain}`) ?? r.error,
    );
    await send("Target.detachFromTarget", { sessionId: a.result.sessionId });
}

// Native Target.createTarget.
show(
    "Target.createTarget native (no ctx)",
    await send("Target.createTarget", { url: "about:blank" }),
);
show(
    "Target.createTarget native (tabs ctx)",
    await send("Target.createTarget", { url: "about:blank", browserContextId: ctxA }),
);
show(
    "Target.createTarget native (newWindow)",
    await send("Target.createTarget", { url: "about:blank", newWindow: true }),
);

// A page session: which context does Storage.getCookies act on there?
const attach = await send("Target.attachToTarget", {
    targetId: info.tabs.A.targetId,
    flatten: true,
});
const sid = attach.result.sessionId;
const pageCookies = await send("Storage.getCookies", {}, sid);
show(
    "Storage.getCookies on A's page session (no ctx)",
    pageCookies.result?.cookies?.map((c: any) => c.name) ?? pageCookies.error,
);
show(
    "Browser.getVersion on page session",
    (await send("Browser.getVersion", {}, sid)).result?.product,
);
ws.close();
