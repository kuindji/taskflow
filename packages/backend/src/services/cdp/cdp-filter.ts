interface CdpMessage {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    sessionId?: string;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
}

interface CdpFilterDeps {
    rootTabId: string;
    isAllowedTab(tabId: string): boolean;
    resolveTarget(targetId: string): Promise<{ tabId: string } | null>;
    pageOfTabTarget(tabTargetId: string): Promise<string | null>;
    openChild(url: string): Promise<{ targetId: string }>;
    closeTarget(targetId: string): Promise<boolean>;
    runOnRootPage(method: string, params: Record<string, unknown>): Promise<CdpMessage>;
    browserContextId: string | null;
}

interface CdpFilterIo {
    toClient(m: CdpMessage): void;
    toUpstream(m: CdpMessage): void;
}

// These domains act on the attached target or the shared persist:browser partition.
// All spike session methods fit here except Target.setAutoAttach (handled below)
// and WebMCP.enable, which is denied as an unknown Chromium 130 domain.
const SESSION_DOMAINS = new Set([
    "Accessibility",
    "Animation",
    "Audits",
    "Autofill",
    "CSS",
    "CacheStorage",
    "Console",
    "DOM",
    "DOMDebugger",
    "DOMSnapshot",
    "DOMStorage",
    "Debugger",
    "DeviceAccess",
    "DeviceOrientation",
    "Emulation",
    "EventBreakpoints",
    "FedCm",
    "Fetch",
    "HeapProfiler",
    "IO",
    "IndexedDB",
    "Input",
    "Inspector",
    "LayerTree",
    "Log",
    "Media",
    "Network",
    "Overlay",
    "Page",
    "Performance",
    "PerformanceTimeline",
    "Preload",
    "Profiler",
    "Runtime",
    "Schema",
    "Security",
    "WebAudio",
    "WebAuthn",
]);

const COOKIE_METHODS: Record<string, string> = {
    "Storage.getCookies": "Network.getAllCookies",
    "Storage.setCookies": "Network.setCookies",
    "Storage.clearCookies": "Network.clearBrowserCookies",
};
const CONTEXT_METHODS = new Set([
    "Browser.setDownloadBehavior",
    "Browser.setPermission",
    "Browser.grantPermissions",
    "Browser.resetPermissions",
    ...Object.keys(COOKIE_METHODS),
]);

class CdpTargetFilter {
    private readonly allowedSessions = new Map<string, string>();
    private readonly targetTypes = new Map<string, string>();
    private readonly tabPages = new Map<string, Promise<string | null>>();
    private readonly decisions = new Map<string, boolean>();
    private readonly requests = new Map<string, string>();
    private readonly internalIds = new Set<number>();
    private readonly announcedPages = new Set<string>();
    private readonly attachWaiters = new Map<string, Set<() => void>>();
    private nextInternalId = -1;
    private upstreamChain: Promise<void> = Promise.resolve();

    constructor(
        private readonly deps: CdpFilterDeps,
        private readonly io: CdpFilterIo,
    ) {}

    private key(m: CdpMessage): string {
        return JSON.stringify([m.sessionId ?? null, m.id]);
    }

    private reply(request: CdpMessage, response: Pick<CdpMessage, "result" | "error">): void {
        this.io.toClient({
            id: request.id,
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
            ...response,
        });
    }

    private deny(request: CdpMessage): void {
        this.reply(request, {
            error: { code: -32000, message: `Not allowed by Taskflow: ${request.method}` },
        });
    }

    private forward(request: CdpMessage): void {
        if (request.id !== undefined && request.method)
            this.requests.set(this.key(request), request.method);
        this.io.toUpstream(request);
    }

    private remember(raw: unknown): Record<string, unknown> {
        const info = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
        if (typeof info.targetId === "string" && typeof info.type === "string")
            this.targetTypes.set(info.targetId, info.type);
        return info;
    }

    private async pageId(targetId: string): Promise<string | null> {
        if (this.targetTypes.get(targetId) !== "tab") return targetId;
        let page = this.tabPages.get(targetId);
        if (!page) {
            page = this.deps.pageOfTabTarget(targetId);
            this.tabPages.set(targetId, page);
        }
        return page;
    }

    private async allowed(targetId: string): Promise<boolean> {
        // Only pages and tabs can belong to a tab family. Other types (workers,
        // the browser) are never in the registry, so resolving them would stall
        // the ordered upstream stream for the full resolveTarget wait.
        const type = this.targetTypes.get(targetId);
        if (type !== undefined && type !== "page" && type !== "tab") {
            this.decisions.set(targetId, false);
            return false;
        }
        const page = await this.pageId(targetId);
        const resolved = page ? await this.deps.resolveTarget(page) : null;
        const allowed = resolved !== null && this.deps.isAllowedTab(resolved.tabId);
        this.decisions.set(targetId, allowed);
        return allowed;
    }

    private contextAllowed(params: Record<string, unknown>): boolean {
        return (
            params.browserContextId === undefined ||
            (this.deps.browserContextId !== null &&
                params.browserContextId === this.deps.browserContextId)
        );
    }

    private waitForAttach(targetId: string): Promise<void> {
        if (this.announcedPages.has(targetId)) return Promise.resolve();
        return new Promise((resolve) => {
            const done = () => {
                clearTimeout(timer);
                waiters.delete(done);
                if (!waiters.size) this.attachWaiters.delete(targetId);
                resolve();
            };
            const waiters = this.attachWaiters.get(targetId) ?? new Set<() => void>();
            this.attachWaiters.set(targetId, waiters);
            waiters.add(done);
            const timer = setTimeout(done, 2000);
        });
    }

    async fromClient(m: CdpMessage): Promise<void> {
        if (m.sessionId && !this.allowedSessions.has(m.sessionId)) return this.deny(m);
        const method = m.method ?? "";
        const params = m.params ?? {};
        const targetId = typeof params.targetId === "string" ? params.targetId : null;
        try {
            if (method.startsWith("Target.")) {
                switch (method) {
                    case "Target.attachToTarget":
                        if (params.flatten !== true) return this.deny(m);
                        if (!targetId || !(await this.allowed(targetId))) return this.deny(m);
                        return this.forward(m);
                    case "Target.activateTarget":
                    case "Target.getTargetInfo":
                        if (
                            targetId
                                ? !(await this.allowed(targetId))
                                : method === "Target.activateTarget"
                        )
                            return this.deny(m);
                        return this.forward(m);
                    case "Target.closeTarget": {
                        if (!targetId || !(await this.allowed(targetId))) return this.deny(m);
                        const page = await this.pageId(targetId);
                        if (!page) return this.deny(m);
                        await this.deps.closeTarget(page);
                        return this.reply(m, { result: { success: true } });
                    }
                    case "Target.createTarget": {
                        if (!this.contextAllowed(params)) return this.deny(m);
                        const child = await this.deps.openChild(
                            typeof params.url === "string" ? params.url : "about:blank",
                        );
                        await this.waitForAttach(child.targetId);
                        return this.reply(m, { result: { targetId: child.targetId } });
                    }
                    case "Target.setAutoAttach":
                        if (params.flatten !== true) return this.deny(m);
                        return this.forward(m);
                    case "Target.detachFromTarget":
                        if (
                            typeof params.sessionId !== "string" ||
                            !this.allowedSessions.has(params.sessionId)
                        )
                            return this.deny(m);
                        return this.forward(m);
                    case "Target.setDiscoverTargets":
                    case "Target.getTargets":
                    case "Target.getBrowserContexts":
                        return this.forward(m);
                    default:
                        return this.deny(m);
                }
            }
            if (CONTEXT_METHODS.has(method)) {
                if (!this.contextAllowed(params)) return this.deny(m);
                if (method === "Browser.setDownloadBehavior") return this.reply(m, { result: {} });
                const cookieMethod = COOKIE_METHODS[method];
                if (cookieMethod) {
                    const response = await this.deps.runOnRootPage(
                        cookieMethod,
                        method === "Storage.setCookies" ? { cookies: params.cookies } : {},
                    );
                    return this.reply(
                        m,
                        response.error
                            ? { error: response.error }
                            : { result: response.result ?? {} },
                    );
                }
                return this.deny(m);
            }
            const domain = method.split(".")[0];
            if (domain === "Browser" || domain === "SystemInfo") {
                if (method === "Browser.getVersion" || method === "SystemInfo.getInfo")
                    return this.forward(m);
                if (
                    method === "Browser.getWindowForTarget" &&
                    (targetId ? await this.allowed(targetId) : !!m.sessionId)
                )
                    return this.forward(m);
                return this.deny(m);
            }
            if (
                m.sessionId &&
                (SESSION_DOMAINS.has(domain) || method === "Storage.getStorageKeyForFrame")
            )
                return this.forward(m);
            this.deny(m);
        } catch (error) {
            this.reply(m, {
                error: {
                    code: -32000,
                    message: error instanceof Error ? error.message : "Unknown error",
                },
            });
        }
    }

    fromUpstream(m: CdpMessage): Promise<void> {
        const next = this.upstreamChain.then(() => this.processUpstream(m));
        this.upstreamChain = next.catch(() => {});
        return next;
    }

    private internal(command: CdpMessage): void {
        const id = this.nextInternalId--;
        this.internalIds.add(id);
        this.io.toUpstream({ ...command, id });
    }

    private async processUpstream(m: CdpMessage): Promise<void> {
        if (m.id !== undefined && this.internalIds.delete(m.id)) return;
        const params = m.params ?? {};
        const info = params.targetInfo ? this.remember(params.targetInfo) : null;
        if (m.method === "Target.detachedFromTarget") {
            const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
            const allowed = this.allowedSessions.delete(sessionId);
            if (allowed && (!m.sessionId || this.allowedSessions.has(m.sessionId)))
                this.io.toClient(m);
            return;
        }
        if (m.sessionId && !this.allowedSessions.has(m.sessionId)) return;
        if (m.id !== undefined) {
            const key = this.key(m);
            const method = this.requests.get(key);
            this.requests.delete(key);
            if (method === "Target.getTargets" && Array.isArray(m.result?.targetInfos)) {
                const targetInfos: Record<string, unknown>[] = [];
                for (const raw of m.result.targetInfos) {
                    const target = this.remember(raw);
                    if (
                        typeof target.targetId === "string" &&
                        (await this.allowed(target.targetId))
                    )
                        targetInfos.push(target);
                }
                this.io.toClient({ ...m, result: { ...m.result, targetInfos } });
                return;
            }
            if (m.result?.targetInfo) this.remember(m.result.targetInfo);
        }
        if (m.method === "Target.attachedToTarget") {
            const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
            const targetId = typeof info?.targetId === "string" ? info.targetId : "";
            if (m.sessionId || (await this.allowed(targetId))) {
                this.allowedSessions.set(sessionId, targetId);
                this.io.toClient(m);
                if (!m.sessionId) {
                    const page = await this.pageId(targetId);
                    if (page) {
                        this.announcedPages.add(page);
                        for (const done of this.attachWaiters.get(page) ?? []) done();
                    }
                }
            } else {
                if (params.waitingForDebugger)
                    this.internal({ method: "Runtime.runIfWaitingForDebugger", sessionId });
                this.internal({ method: "Target.detachFromTarget", params: { sessionId } });
            }
            return;
        }
        if (
            [
                "Target.targetCreated",
                "Target.targetInfoChanged",
                "Target.targetDestroyed",
                "Target.targetCrashed",
            ].includes(m.method ?? "")
        ) {
            const targetId =
                typeof info?.targetId === "string"
                    ? info.targetId
                    : typeof params.targetId === "string"
                      ? params.targetId
                      : "";
            const allowed =
                m.method === "Target.targetDestroyed"
                    ? this.decisions.get(targetId)
                    : await this.allowed(targetId);
            if (allowed) this.io.toClient(m);
            return;
        }
        this.io.toClient(m);
    }
}

export { CdpTargetFilter };
export type { CdpMessage, CdpFilterDeps };
