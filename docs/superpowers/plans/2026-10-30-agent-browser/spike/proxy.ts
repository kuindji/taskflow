// Spike: minimal filtering CDP proxy plus the test page server. Throwaway; see 01-spike.md.
//
// Run: bun docs/superpowers/plans/2026-10-30-agent-browser/spike/proxy.ts
// Env:
//   STRICT=1          deny unlisted methods (default: forward and log them as "unlisted")
//   CTX_MODE=taskflow context-scoped commands: pass | rewrite | deny | taskflow
//                     (taskflow: download behavior is a no-op, permissions are denied,
//                      Storage.*Cookies run as Network.* on the root page over a separate connection)
//   CREATE_MODE=intercept  Target.createTarget: pass | intercept
import type { ServerWebSocket } from "bun";

const PROXY_PORT = 9333;
const PAGE_PORT = 9340;
const MAIN = "http://127.0.0.1:9335";
const STRICT = process.env.STRICT === "1";
const CTX_MODE = process.env.CTX_MODE ?? "taskflow";
const CREATE_MODE = process.env.CREATE_MODE ?? "intercept";

type Msg = {
    id?: number;
    method?: string;
    params?: Record<string, any>;
    sessionId?: string;
    result?: Record<string, any>;
    error?: { code: number; message: string };
};
type TargetInfo = {
    targetId: string;
    type: string;
    url: string;
    openerId?: string;
    browserContextId?: string;
};

const log = (...args: unknown[]) => console.log("[proxy]", ...args);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- method log (decides Section 4's tables) ----
let label = "unlabeled";
const methodLog = new Map<
    string,
    Map<string, { count: number; decisions: Set<string>; samples: unknown[] }>
>();
function record(level: string, method: string, decision: string, params?: unknown) {
    let m = methodLog.get(label);
    if (!m) methodLog.set(label, (m = new Map()));
    const key = `${level} ${method}`;
    let e = m.get(key);
    if (!e) m.set(key, (e = { count: 0, decisions: new Set(), samples: [] }));
    e.count++;
    e.decisions.add(decision);
    if (e.samples.length < 2 && params !== undefined) e.samples.push(params);
}
const notes: string[] = [];
const note = (s: string) => {
    notes.push(`[${label}] ${s}`);
    log("NOTE", s);
};

// ---- family state (shared across connections) ----
const allowed = new Set<string>();
const denied = new Set<string>();
const children: unknown[] = [];
let upstreamWsUrl = "";
let versionJson: Record<string, any> = {};
let rootTargetId = "";

async function mainInfo(): Promise<any> {
    for (;;) {
        try {
            return await (await fetch(`${MAIN}/info`)).json();
        } catch {
            await sleep(200);
        }
    }
}

const tabPageCache = new Map<string, Promise<string | null>>();
const tabTimings: { tabTargetId: string; ms: number; page: string | null }[] = [];
function pageOfTabTarget(tabTargetId: string): Promise<string | null> {
    let p = tabPageCache.get(tabTargetId);
    if (p) return p;
    p = new Promise((resolve) => {
        const t0 = performance.now();
        const ws = new WebSocket(upstreamWsUrl);
        let done = false;
        const finish = (v: string | null) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
                ws.close();
            } catch {}
            tabTimings.push({ tabTargetId, ms: Math.round(performance.now() - t0), page: v });
            resolve(v);
        };
        const timer = setTimeout(() => finish(null), 2000);
        ws.onopen = () =>
            ws.send(
                JSON.stringify({
                    id: 1,
                    method: "Target.attachToTarget",
                    params: { targetId: tabTargetId, flatten: true },
                }),
            );
        ws.onmessage = (e) => {
            const m = JSON.parse(String(e.data)) as Msg;
            if (m.id === 1) {
                if (m.error || !m.result) return finish(null);
                ws.send(
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
                m.params?.targetInfo?.type === "page"
            )
                finish(m.params.targetInfo.targetId);
        };
        ws.onerror = () => finish(null);
    });
    tabPageCache.set(tabTargetId, p);
    return p;
}

/** Runs one command on a fresh flattened session to `targetId` over a separate upstream connection. */
function onPageSession(
    targetId: string,
    method: string,
    params: Record<string, unknown>,
): Promise<Msg> {
    return new Promise((resolve) => {
        const ws = new WebSocket(upstreamWsUrl);
        const timer = setTimeout(() => {
            ws.close();
            resolve({ error: { code: -32000, message: "timeout" } });
        }, 5000);
        ws.onopen = () =>
            ws.send(
                JSON.stringify({
                    id: 1,
                    method: "Target.attachToTarget",
                    params: { targetId, flatten: true },
                }),
            );
        ws.onmessage = (e) => {
            const m = JSON.parse(String(e.data)) as Msg;
            if (m.id === 1) {
                if (m.error || !m.result) {
                    clearTimeout(timer);
                    ws.close();
                    return resolve(m);
                }
                ws.send(JSON.stringify({ id: 2, sessionId: m.result.sessionId, method, params }));
            } else if (m.id === 2) {
                clearTimeout(timer);
                ws.close();
                resolve(m);
            }
        };
    });
}

const COOKIE_EMULATION: Record<string, string> = {
    "Storage.getCookies": "Network.getAllCookies",
    "Storage.setCookies": "Network.setCookies",
    "Storage.clearCookies": "Network.clearBrowserCookies",
};

async function resolveTarget(targetId: string, type?: string, openerId?: string): Promise<boolean> {
    if (allowed.has(targetId)) return true;
    if (denied.has(targetId)) return false;
    if (openerId && allowed.has(openerId)) {
        allowed.add(targetId);
        return true;
    }
    if (type === "tab") {
        const page = await pageOfTabTarget(targetId);
        return page ? resolveTarget(page, "page") : false;
    }
    if (type && type !== "page") return false;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        await sleep(25);
        if (allowed.has(targetId)) return true;
        if (denied.has(targetId)) return false;
    }
    note(`resolveTarget timed out for ${targetId} (type ${type ?? "?"})`);
    return false;
}

// ---- rule tables (Section 4 draft) ----
const CTX_SCOPED = new Set([
    "Browser.setDownloadBehavior",
    "Browser.setPermission",
    "Browser.grantPermissions",
    "Browser.resetPermissions",
    "Storage.getCookies",
    "Storage.setCookies",
    "Storage.clearCookies",
]);
const BROWSER_ALLOWED = new Set([
    "Browser.getVersion",
    "Browser.getWindowForTarget",
    "SystemInfo.getInfo",
]);
const SESSION_DOMAINS = new Set(
    "Accessibility Animation Audits Autofill CSS CacheStorage Console DOM DOMDebugger DOMSnapshot DOMStorage Debugger DeviceAccess DeviceOrientation Emulation EventBreakpoints FedCm Fetch HeapProfiler IO IndexedDB Input Inspector LayerTree Log Media Network Overlay Page Performance PerformanceTimeline Preload Profiler Runtime Schema Security WebAudio WebAuthn".split(
        " ",
    ),
);
const SESSION_EXTRA = new Set(["Storage.getStorageKeyForFrame"]);
const TARGET_DENIED = new Set([
    "Target.attachToBrowserTarget",
    "Target.createBrowserContext",
    "Target.disposeBrowserContext",
    "Target.exposeDevToolsProtocol",
    "Target.setRemoteLocations",
]);
const TARGET_FORWARD = new Set([
    "Target.setAutoAttach",
    "Target.setDiscoverTargets",
    "Target.getTargets",
    "Target.getBrowserContexts",
    "Target.detachFromTarget",
]);
const TARGET_EVENTS = new Set([
    "Target.targetCreated",
    "Target.targetInfoChanged",
    "Target.targetDestroyed",
    "Target.targetCrashed",
]);

type ClientData = { conn?: Conn };

class Conn {
    up: WebSocket;
    allowedSessions = new Map<string, string>();
    targetTypes = new Map<string, string>();
    decisions = new Map<string, boolean>();
    pending = new Map<string, Msg>();
    internal = new Map<string, (m: Msg) => void>();
    internalId = 1_000_000_000;
    clientChain = Promise.resolve();
    upChain = Promise.resolve();
    ready: Promise<void>;
    ctxId: string | null = null;
    closed = false;
    /** Created targetIds waiting for their attachedToTarget to reach the client. */
    attachWaiters = new Map<string, () => void>();

    constructor(private client: ServerWebSocket<ClientData>) {
        this.up = new WebSocket(upstreamWsUrl);
        this.up.onmessage = (e) => {
            const m = JSON.parse(String(e.data)) as Msg;
            this.upChain = this.upChain
                .then(() => this.fromUp(m))
                .catch((err) => log("fromUp error", err));
        };
        this.up.onclose = () => {
            if (!this.closed) client.close(1001, "upstream closed");
        };
        this.ready = new Promise<void>((resolve) => {
            this.up.onopen = async () => {
                const r = await this.internalSend({
                    method: "Target.getTargetInfo",
                    params: { targetId: rootTargetId },
                });
                this.ctxId = r.result?.targetInfo?.browserContextId ?? null;
                log("conn ready, ctx", this.ctxId);
                resolve();
            };
        });
    }

    internalSend(m: Msg): Promise<Msg> {
        const id = this.internalId++;
        return new Promise((resolve) => {
            this.internal.set(`${m.sessionId ?? ""}:${id}`, resolve);
            this.up.send(JSON.stringify({ ...m, id }));
        });
    }

    toClient(m: Msg) {
        if (!this.closed) this.client.send(JSON.stringify(m));
    }
    toUp(m: Msg) {
        if (m.id !== undefined) this.pending.set(`${m.sessionId ?? ""}:${m.id}`, m);
        this.up.send(JSON.stringify(m));
    }
    reply(req: Msg, result: Record<string, unknown>) {
        this.toClient({
            id: req.id,
            ...(req.sessionId ? { sessionId: req.sessionId } : {}),
            result,
        });
    }
    deny(req: Msg, why: string) {
        record(
            req.sessionId ? "session" : "browser",
            req.method ?? "?",
            `deny(${why})`,
            req.params,
        );
        this.toClient({
            id: req.id,
            ...(req.sessionId ? { sessionId: req.sessionId } : {}),
            error: { code: -32000, message: `Not allowed by Taskflow: ${req.method}` },
        });
    }
    forward(req: Msg, decision = "forward") {
        record(req.sessionId ? "session" : "browser", req.method ?? "?", decision, req.params);
        this.toUp(req);
    }

    onClient(raw: string) {
        const m = JSON.parse(raw) as Msg;
        this.clientChain = this.clientChain
            .then(() => this.ready)
            .then(() => this.fromClient(m))
            .catch((err) => log("fromClient error", err));
    }

    async decide(targetId: string, type?: string, openerId?: string): Promise<boolean> {
        const t = type ?? this.targetTypes.get(targetId);
        const ok = await resolveTarget(targetId, t, openerId);
        this.decisions.set(targetId, ok);
        return ok;
    }

    async fromClient(m: Msg) {
        const method = m.method ?? "";
        const sid = m.sessionId;
        const level = sid ? "session" : "browser";
        if (sid && !this.allowedSessions.has(sid)) return this.deny(m, "unknown session");
        const domain = method.split(".")[0];
        const p = m.params ?? {};

        if (domain === "Target") {
            if (method === "Target.sendMessageToTarget") return this.deny(m, "tunnel");
            if (
                (method === "Target.attachToTarget" || method === "Target.setAutoAttach") &&
                p.flatten !== true
            )
                return this.deny(m, "flatten!=true");
            if (TARGET_DENIED.has(method)) return this.deny(m, "denied");
            if (
                method === "Target.attachToTarget" ||
                method === "Target.activateTarget" ||
                (method === "Target.getTargetInfo" && p.targetId)
            ) {
                return (await this.decide(p.targetId))
                    ? this.forward(m)
                    : this.deny(m, "foreign target");
            }
            if (method === "Target.getTargetInfo") return this.forward(m);
            if (method === "Target.closeTarget") {
                if (!(await this.decide(p.targetId))) return this.deny(m, "foreign target");
                let page = p.targetId as string;
                if (this.targetTypes.get(page) === "tab")
                    page = (await pageOfTabTarget(page)) ?? page;
                record(level, method, "intercept");
                const r = await fetch(`${MAIN}/close-target`, {
                    method: "POST",
                    body: JSON.stringify({ targetId: page }),
                });
                const body = await r.json();
                if (!r.ok) note(`closeTarget ${page}: ${JSON.stringify(body)}`);
                return this.reply(m, { success: r.ok });
            }
            if (method === "Target.createTarget") {
                if (CREATE_MODE === "pass") return this.forward(m, "forward(pass mode)");
                if (p.browserContextId && p.browserContextId !== this.ctxId)
                    return this.deny(m, "foreign context");
                record(level, method, "intercept", p);
                const r = await fetch(`${MAIN}/create-child`, {
                    method: "POST",
                    body: JSON.stringify({
                        parentTargetId: rootTargetId,
                        url: p.url ?? "about:blank",
                    }),
                });
                const body = (await r.json()) as { targetId: string };
                allowed.add(body.targetId);
                // Chromium sends the auto-attach before the createTarget reply, and Playwright
                // reads the page right after the reply. Hold the reply until the attach went out.
                const t0 = performance.now();
                const attached = await new Promise<boolean>((resolve) => {
                    const timer = setTimeout(() => {
                        this.attachWaiters.delete(body.targetId);
                        resolve(false);
                    }, 2000);
                    this.attachWaiters.set(body.targetId, () => {
                        clearTimeout(timer);
                        resolve(true);
                    });
                });
                note(
                    `createTarget reply held ${Math.round(performance.now() - t0)} ms (attach seen: ${attached})`,
                );
                return this.reply(m, { targetId: body.targetId });
            }
            if (
                method === "Target.detachFromTarget" &&
                p.sessionId &&
                !this.allowedSessions.has(p.sessionId)
            )
                return this.deny(m, "foreign session");
            if (TARGET_FORWARD.has(method)) return this.forward(m);
            return STRICT ? this.deny(m, "unlisted") : this.forward(m, "unlisted");
        }

        if (CTX_SCOPED.has(method)) {
            note(
                `${level} ${method} browserContextId=${String(p.browserContextId)} (tabs ctx ${this.ctxId})`,
            );
            if (CTX_MODE === "pass") return this.forward(m, "forward(ctx pass)");
            if (CTX_MODE === "taskflow") {
                if (p.browserContextId && p.browserContextId !== this.ctxId)
                    return this.deny(m, "foreign context");
                if (method === "Browser.setDownloadBehavior") {
                    record(level, method, "intercept(no-op {})", p);
                    return this.reply(m, {});
                }
                const emulated = COOKIE_EMULATION[method];
                if (!emulated) return this.deny(m, "ctx (acts on the app session)");
                record(level, method, `intercept(as ${emulated} on root page)`, p);
                const params = method === "Storage.setCookies" ? { cookies: p.cookies } : {};
                const r = await onPageSession(rootTargetId, emulated, params);
                if (r.error)
                    return this.toClient({
                        id: m.id,
                        ...(sid ? { sessionId: sid } : {}),
                        error: r.error,
                    });
                return this.reply(m, r.result ?? {});
            }
            if (CTX_MODE === "deny" || !this.ctxId) return this.deny(m, "ctx");
            if (p.browserContextId && p.browserContextId !== this.ctxId)
                return this.deny(m, "foreign context");
            if (!p.browserContextId) {
                m.params = { ...p, browserContextId: this.ctxId };
                return this.forward(m, "rewrite(ctx injected)");
            }
            return this.forward(m, "forward(own ctx)");
        }

        if (domain === "Browser" || domain === "SystemInfo") {
            if (!BROWSER_ALLOWED.has(method))
                return STRICT ? this.deny(m, "browser domain") : this.forward(m, "unlisted");
            if (
                method === "Browser.getWindowForTarget" &&
                p.targetId &&
                !(await this.decide(p.targetId))
            )
                return this.deny(m, "foreign target");
            return this.forward(m);
        }

        if (!sid) return STRICT ? this.deny(m, "browser level") : this.forward(m, "unlisted");
        if (SESSION_DOMAINS.has(domain) || SESSION_EXTRA.has(method)) return this.forward(m);
        return STRICT ? this.deny(m, "session domain") : this.forward(m, "unlisted");
    }

    async fromUp(m: Msg) {
        // responses
        if (m.id !== undefined && !m.method) {
            const key = `${m.sessionId ?? ""}:${m.id}`;
            const internal = this.internal.get(key);
            if (internal) {
                this.internal.delete(key);
                return internal(m);
            }
            const req = this.pending.get(key);
            this.pending.delete(key);
            if (m.sessionId && !this.allowedSessions.has(m.sessionId)) return;
            if (req?.method === "Target.getTargets" && m.result) {
                const infos = m.result.targetInfos as TargetInfo[];
                for (const t of infos) this.targetTypes.set(t.targetId, t.type);
                const keep: TargetInfo[] = [];
                for (const t of infos)
                    if (await this.decide(t.targetId, t.type, t.openerId)) keep.push(t);
                m.result = { ...m.result, targetInfos: keep };
            }
            return this.toClient(m);
        }

        const method = m.method ?? "";
        const p = m.params ?? {};
        const ti = p.targetInfo as TargetInfo | undefined;
        if (ti) this.targetTypes.set(ti.targetId, ti.type);

        if (m.sessionId && !this.allowedSessions.has(m.sessionId)) return;

        if (TARGET_EVENTS.has(method)) {
            const id = (ti?.targetId ?? p.targetId) as string;
            const ok =
                method === "Target.targetDestroyed" || method === "Target.targetCrashed"
                    ? (this.decisions.get(id) ?? false)
                    : await this.decide(id, ti?.type, ti?.openerId);
            if (ok) this.toClient(m);
            return;
        }

        if (method === "Target.attachedToTarget") {
            const childSid = p.sessionId as string;
            const info = ti as TargetInfo;
            if (m.sessionId) {
                // nested attach under an allowed session
                this.allowedSessions.set(childSid, info.targetId);
                return this.toClient(m);
            }
            if (await this.decide(info.targetId, info.type, info.openerId)) {
                this.allowedSessions.set(childSid, info.targetId);
                this.toClient(m);
                const page =
                    info.type === "tab" ? await pageOfTabTarget(info.targetId) : info.targetId;
                if (page) this.attachWaiters.get(page)?.();
                return;
            }
            if (p.waitingForDebugger)
                void this.internalSend({
                    method: "Runtime.runIfWaitingForDebugger",
                    sessionId: childSid,
                });
            void this.internalSend({
                method: "Target.detachFromTarget",
                params: { sessionId: childSid },
            });
            return;
        }

        if (method === "Target.detachedFromTarget") {
            const childSid = p.sessionId as string;
            if (this.allowedSessions.delete(childSid)) this.toClient(m);
            return;
        }

        this.toClient(m);
    }

    close() {
        this.closed = true;
        try {
            this.up.close();
        } catch {}
    }
}

// ---- test page server ----
const commonScript = `
<script>
let c = 0; setInterval(() => { document.getElementById('count').textContent = String(++c); }, 100);
document.getElementById('info').textContent = JSON.stringify({
  preload: window.__spikePreload === true,
  webdriver: String(navigator.webdriver),
  opener: window.opener !== null,
  ua: navigator.userAgent,
});
</script>`;
const style = `<style>body{font:22px sans-serif;margin:0;padding:16px;background:linear-gradient(135deg,#f80,#08f 60%,#0a4);color:#111}
.blk{display:inline-block;width:120px;height:80px;margin:6px}</style>`;
const blocks = `<div><span class=blk style="background:#c00"></span><span class=blk style="background:#0c0"></span><span class=blk style="background:#00c"></span></div>`;

function testPage(): string {
    return `<!doctype html><html><head><title>Spike A</title>${style}</head><body>
<h1>Spike test page</h1>${blocks}
<p><input id=inp> <button id=btn onclick="document.getElementById('out').textContent='clicked'">Click</button> <span id=out></span></p>
<p>count: <span id=count>0</span></p>
<p id=info></p>
<p><a id=blank href="/popup?k=blank" target=_blank>blank link</a> |
<a id=opener href="/popup?k=opener" target=_blank rel=opener>opener link</a> |
<button id=wopen onclick="window.open('/popup?k=wopen')">window.open</button></p>
<form id=f1 method=post action="/echo?k=urlenc" target=_blank><input name=a value=1><button id=f1s>post urlenc</button></form>
<form id=f2 method=post action="/echo?k=multi" target=_blank enctype="multipart/form-data"><input name=b value=2><button id=f2s>post multipart</button></form>
<script>document.cookie = "spike=1; path=/";</script>
${commonScript}</body></html>`;
}
function popupPage(kind: string, extra = ""): string {
    return `<!doctype html><html><head><title>Popup ${kind}</title>${style}</head><body>
<h1>Popup ${kind}</h1>${blocks}
<p>count: <span id=count>0</span></p><p id=info></p>
<p><button id=pbtn onclick="document.getElementById('pout').textContent='clicked'">Click</button> <span id=pout></span></p>
${extra}${commonScript}</body></html>`;
}

Bun.serve({
    port: PAGE_PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
        const url = new URL(req.url);
        const html = (s: string) => new Response(s, { headers: { "content-type": "text/html" } });
        if (url.pathname === "/") return html(testPage());
        if (url.pathname === "/popup") return html(popupPage(url.searchParams.get("k") ?? "?"));
        if (url.pathname === "/echo" && req.method === "POST") {
            const contentType = req.headers.get("content-type");
            let fields: Record<string, string> = {};
            try {
                const fd = await req.formData();
                fields = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
            } catch (e) {
                fields = { error: String(e) };
            }
            const echo = JSON.stringify({ contentType, fields });
            log("echo", echo);
            return html(
                popupPage(`echo ${url.searchParams.get("k")}`, `<pre id=echo>${echo}</pre>`),
            );
        }
        return new Response("not found", { status: 404 });
    },
});

// ---- proxy server ----
Bun.serve<ClientData>({
    port: PROXY_PORT,
    hostname: "127.0.0.1",
    async fetch(req, server) {
        const url = new URL(req.url);
        const host = req.headers.get("host") ?? `127.0.0.1:${PROXY_PORT}`;
        if (url.pathname === "/json/version" || url.pathname === "/json/version/") {
            return Response.json({
                ...versionJson,
                webSocketDebuggerUrl: `ws://${host}/devtools/browser`,
            });
        }
        if (
            url.pathname === "/json/list" ||
            url.pathname === "/json" ||
            url.pathname === "/json/list/"
        ) {
            const list = (await (
                await fetch(`http://127.0.0.1:${(await mainInfo()).debugPort}/json/list`)
            ).json()) as {
                id: string;
            }[];
            return Response.json(
                list
                    .filter((t) => allowed.has(t.id))
                    .map(
                        ({ webSocketDebuggerUrl: _w, devtoolsFrontendUrl: _d, ...rest }: any) =>
                            rest,
                    ),
            );
        }
        if (url.pathname === "/devtools/browser") {
            if (server.upgrade(req, { data: {} })) return undefined;
            return new Response("upgrade failed", { status: 400 });
        }
        if (url.pathname === "/side/child" && req.method === "POST") {
            const body = (await req.json()) as {
                parentTargetId: string;
                targetId: string;
                how: string;
                name: string;
            };
            children.push(body);
            if (allowed.has(body.parentTargetId)) allowed.add(body.targetId);
            else denied.add(body.targetId);
            log("side child", JSON.stringify(body));
            return Response.json({ ok: true });
        }
        if (url.pathname === "/log/mark" && req.method === "POST") {
            label = await req.text();
            log("=== label", label);
            return Response.json({ ok: true });
        }
        if (url.pathname === "/log/note" && req.method === "POST") {
            note(await req.text());
            return Response.json({ ok: true });
        }
        if (url.pathname === "/log") {
            const out: Record<string, Record<string, unknown>> = {};
            for (const [l, m] of methodLog)
                out[l] = Object.fromEntries(
                    [...m].map(([k, v]) => [
                        k,
                        { count: v.count, decisions: [...v.decisions], samples: v.samples },
                    ]),
                );
            return Response.json({
                methods: out,
                notes,
                children,
                tabTimings,
                allowed: [...allowed],
                denied: [...denied],
            });
        }
        return new Response("not found", { status: 404 });
    },
    websocket: {
        open(ws) {
            ws.data.conn = new Conn(ws);
        },
        message(ws, data) {
            ws.data.conn?.onClient(String(data));
        },
        close(ws) {
            ws.data.conn?.close();
        },
    },
});

log(
    `proxy on ${PROXY_PORT}, page server on ${PAGE_PORT}; STRICT=${STRICT} CTX_MODE=${CTX_MODE} CREATE_MODE=${CREATE_MODE}`,
);
const info = await mainInfo();
rootTargetId = info.tabs.A.targetId;
allowed.add(rootTargetId);
denied.add(info.tabs.B.targetId);
denied.add(info.appTargetId);
if (info.parkTargetId) denied.add(info.parkTargetId);
versionJson = (await (
    await fetch(`http://127.0.0.1:${info.debugPort}/json/version`)
).json()) as Record<string, any>;
upstreamWsUrl = versionJson.webSocketDebuggerUrl;
log("main info", JSON.stringify(info));
log("/json/version", JSON.stringify(versionJson));
