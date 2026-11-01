import { randomUUID } from "crypto";
import {
    MSG,
    browserTabLabel,
    type BrowserHostEvent,
    type BrowserHostHeartbeat,
    type BrowserTab,
    type BrowserTabListResponse,
    type BrowserTabOpenPayload,
    type BrowserTabScope,
    type WsEvent,
} from "@taskflow/shared";
import type { BrowserHostClient } from "./browser-host-client";
import {
    BrowserHostUnavailableError,
    BrowserTabInputError,
    BrowserTabNotFoundError,
} from "./browser-tab-errors";
import type { BrowserTabStore } from "./browser-tab-store";

interface BrowserTabService {
    list(filter?: { scope?: BrowserTabScope }): BrowserTabListResponse;
    get(id: string): BrowserTab | null;
    open(input: BrowserTabOpenPayload): Promise<BrowserTab>;
    openChild(parentId: string, url: string): Promise<{ tab: BrowserTab; targetId: string }>;
    close(id: string): Promise<boolean>;
    closeForOwner(owner: { taskId: string } | { projectId: string }): Promise<void>;
    ensureLoaded(id: string): Promise<{ targetId: string; debugPort: number }>;
    resolveTarget(targetId: string, opts?: { waitMs?: number }): Promise<{ tabId: string } | null>;
    tabIdForTarget(targetId: string): string | null;
    familyOf(rootTabId: string): Set<string>;
    addAgentConnection(id: string, delta: 1 | -1): void;
    hostHeartbeat(hb: BrowserHostHeartbeat): void;
    hostEvent(ev: BrowserHostEvent): Promise<void>;
    hostAvailable(): boolean;
    subscribeTabGone(cb: (tabId: string) => void): () => void;
    init(): Promise<void>;
}

interface BrowserTabServiceDeps {
    store: BrowserTabStore;
    hostClient: BrowserHostClient;
    broadcast: (event: WsEvent) => void;
    isOwnerActive: (scope: BrowserTabScope) => Promise<boolean>;
    now?: () => number;
    schedule?: (fn: () => void, ms: number) => () => void;
}

const HOST_STALE_MS = 15000;

function sameScope(left: BrowserTabScope, right: BrowserTabScope): boolean {
    if (left.kind !== right.kind) return false;
    if (left.kind === "task" && right.kind === "task") return left.taskId === right.taskId;
    if (left.kind === "project" && right.kind === "project")
        return left.projectId === right.projectId;
    return left.kind === "master" && right.kind === "master";
}

function createBrowserTabService(deps: BrowserTabServiceDeps): BrowserTabService {
    const { store, hostClient, broadcast } = deps;
    const now = deps.now ?? Date.now;
    const schedule =
        deps.schedule ??
        ((fn, ms) => {
            const timer = setTimeout(fn, ms);
            return () => clearTimeout(timer);
        });
    const tabs = new Map<string, BrowserTab>();
    const targets = new Map<string, string>();
    const tabTargets = new Map<string, string>();
    // Families being closed: close works from a snapshot, so no child may join one.
    const closing = new Set<string>();
    const goneListeners = new Set<(tabId: string) => void>();
    const targetWaiters = new Map<string, Set<(tabId: string | null) => void>>();
    let host: { controlUrl: string; debugPort: number; lastSeen: number } | null = null;
    let appTargetIds = new Set<string>();
    let cancelStaleness: (() => void) | undefined;

    function hostAvailable(): boolean {
        return host !== null && now() - host.lastSeen <= HOST_STALE_MS;
    }
    function requireHost() {
        if (!host || !hostAvailable()) throw new BrowserHostUnavailableError();
        return host;
    }
    function list(filter?: { scope?: BrowserTabScope }): BrowserTabListResponse {
        return {
            tabs: [...tabs.values()]
                .filter((tab) => !filter?.scope || sameScope(tab.scope, filter.scope))
                .map((tab) => ({ ...tab })),
            hostAvailable: hostAvailable(),
        };
    }
    function publish(): void {
        broadcast({ type: MSG.BROWSER_TABS_LIST, payload: list() });
    }
    function forgetTarget(tabId: string): void {
        const old = tabTargets.get(tabId);
        if (old) targets.delete(old);
        tabTargets.delete(tabId);
    }
    function setTarget(tabId: string, targetId: string): void {
        forgetTarget(tabId);
        tabTargets.set(tabId, targetId);
        targets.set(targetId, tabId);
        for (const resolve of targetWaiters.get(targetId) ?? []) resolve(tabId);
    }
    function tabGone(tabId: string): void {
        for (const listener of goneListeners) listener(tabId);
    }
    function newTab(
        id: string,
        scope: BrowserTabScope,
        url: string,
        parentId?: string,
        label?: string,
    ): BrowserTab {
        return {
            id,
            scope,
            url,
            label: label ?? browserTabLabel(url),
            ...(parentId ? { parentId } : {}),
            createdAt: new Date(now()).toISOString(),
            loaded: false,
            agentConnections: 0,
        };
    }
    function familyOf(rootTabId: string): Set<string> {
        const family = new Set<string>();
        if (!tabs.has(rootTabId)) return family;
        family.add(rootTabId);
        for (const id of family) {
            for (const tab of tabs.values()) {
                if (tab.parentId === id) family.add(tab.id);
            }
        }
        return family;
    }
    async function closeFamily(id: string, tellHost: boolean): Promise<boolean> {
        if (!tabs.has(id)) return false;
        let firstError: unknown;
        let failed = false;
        const family = [...familyOf(id)];
        for (const tabId of family) closing.add(tabId);
        for (const tabId of family.reverse()) {
            const tab = tabs.get(tabId);
            if (tellHost && tab?.loaded && hostAvailable() && host) {
                await hostClient.close(host.controlUrl, tabId).catch(() => {});
            }
            try {
                await store.remove(tabId);
            } catch (error) {
                if (!failed) firstError = error;
                failed = true;
            }
            tabs.delete(tabId);
            closing.delete(tabId);
            forgetTarget(tabId);
            tabGone(tabId);
        }
        publish();
        if (failed) throw firstError;
        return true;
    }
    async function load(tab: BrowserTab): Promise<{ targetId: string; debugPort: number }> {
        const liveHost = requireHost();
        const { targetId } = await hostClient.ensure(liveHost.controlUrl, {
            tabId: tab.id,
            url: tab.url,
            ...(tab.parentId ? { parentId: tab.parentId } : {}),
        });
        if (tabs.get(tab.id) !== tab) {
            // Closed while the host was creating the view, so close skipped the host.
            void hostClient.close(liveHost.controlUrl, tab.id).catch(() => {});
            throw new BrowserTabNotFoundError("Browser tab not found");
        }
        tab.loaded = true;
        setTarget(tab.id, targetId);
        return { targetId, debugPort: liveHost.debugPort };
    }
    function checkStaleness(): void {
        if (!host) return;
        if (hostAvailable()) {
            // Availability includes the exact 15000 ms boundary.
            cancelStaleness = schedule(checkStaleness, HOST_STALE_MS - (now() - host.lastSeen) + 1);
            return;
        }
        host = null;
        targets.clear();
        tabTargets.clear();
        for (const tab of tabs.values()) {
            if (!tab.loaded) continue;
            tab.loaded = false;
            tabGone(tab.id);
        }
        publish();
    }
    function closeUnknown(tabId: string): void {
        if (host) void hostClient.close(host.controlUrl, tabId).catch(() => {});
    }

    return {
        list,
        get: (id) => {
            const tab = tabs.get(id);
            return tab ? { ...tab } : null;
        },
        hostAvailable,
        familyOf,
        tabIdForTarget: (targetId) => targets.get(targetId) ?? null,
        subscribeTabGone(cb) {
            goneListeners.add(cb);
            return () => {
                goneListeners.delete(cb);
            };
        },
        async init() {
            for (const tab of await store.list()) {
                if (!(await deps.isOwnerActive(tab.scope))) {
                    await store.remove(tab.id);
                    continue;
                }
                tabs.set(tab.id, { ...tab, loaded: false, agentConnections: 0 });
            }
        },
        async open(input) {
            if (typeof input.url !== "string" || !input.url.trim()) {
                throw new BrowserTabInputError(
                    "Field 'url' is required and must be a non-empty string",
                );
            }
            requireHost();
            const tab = newTab(randomUUID(), input.scope, input.url, undefined, input.label);
            // Registered before the write, so owner cleanup during it closes this tab too.
            tabs.set(tab.id, tab);
            try {
                await store.put(tab);
                if (tabs.get(tab.id) !== tab)
                    throw new BrowserTabNotFoundError("Browser tab not found");
                await load(tab);
            } catch (error) {
                tabs.delete(tab.id);
                forgetTarget(tab.id);
                await store.remove(tab.id);
                throw error;
            }
            publish();
            return { ...tab };
        },
        async openChild(parentId, url) {
            const parent = tabs.get(parentId);
            if (!parent || closing.has(parentId))
                throw new BrowserTabNotFoundError("Browser tab not found");
            requireHost();
            const tab = newTab(randomUUID(), parent.scope, url, parentId);
            tabs.set(tab.id, tab);
            try {
                const { targetId } = await load(tab);
                publish();
                return { tab: { ...tab }, targetId };
            } catch (error) {
                tabs.delete(tab.id);
                forgetTarget(tab.id);
                throw error;
            }
        },
        close: (id) => closeFamily(id, true),
        async closeForOwner(owner) {
            const scope: BrowserTabScope =
                "taskId" in owner
                    ? { kind: "task", taskId: owner.taskId }
                    : { kind: "project", projectId: owner.projectId };
            for (const tab of [...tabs.values()]) {
                if (!tab.parentId && sameScope(tab.scope, scope)) await closeFamily(tab.id, true);
            }
        },
        async ensureLoaded(id) {
            const tab = tabs.get(id);
            if (!tab) throw new BrowserTabNotFoundError("Browser tab not found");
            if (!tab.loaded && tab.parentId) {
                await closeFamily(id, true);
                throw new BrowserTabNotFoundError("Browser tab not found");
            }
            const liveHost = requireHost();
            const targetId = tabTargets.get(id);
            if (tab.loaded && targetId) return { targetId, debugPort: liveHost.debugPort };
            const result = await load(tab);
            publish();
            return result;
        },
        async resolveTarget(targetId, { waitMs = 2000 } = {}) {
            if (appTargetIds.has(targetId)) return null;
            const tabId = targets.get(targetId);
            if (tabId) return { tabId };
            if (waitMs <= 0) return null;
            return new Promise<{ tabId: string } | null>((resolve) => {
                const waiters = targetWaiters.get(targetId) ?? new Set();
                targetWaiters.set(targetId, waiters);
                const finish = (id: string | null) => {
                    cancel();
                    waiters.delete(finish);
                    if (waiters.size === 0) targetWaiters.delete(targetId);
                    resolve(id ? { tabId: id } : null);
                };
                waiters.add(finish);
                const cancel = schedule(() => finish(null), waitMs);
            });
        },
        addAgentConnection(id, delta) {
            const tab = tabs.get(id);
            if (!tab) return;
            const count = Math.max(0, tab.agentConnections + delta);
            if (count === tab.agentConnections) return;
            tab.agentConnections = count;
            publish();
        },
        hostHeartbeat(hb) {
            const before = JSON.stringify(list());
            host = { controlUrl: hb.controlUrl, debugPort: hb.debugPort, lastSeen: now() };
            appTargetIds = new Set(hb.appTargetIds);
            let unknown = hb.loaded.filter((entry) => !tabs.has(entry.tabId));
            for (;;) {
                const remaining: typeof unknown = [];
                for (const entry of unknown) {
                    const parent =
                        entry.parentId && !closing.has(entry.parentId)
                            ? tabs.get(entry.parentId)
                            : undefined;
                    if (parent)
                        tabs.set(
                            entry.tabId,
                            newTab(entry.tabId, parent.scope, entry.url, parent.id),
                        );
                    else remaining.push(entry);
                }
                if (remaining.length === unknown.length) {
                    for (const entry of remaining) closeUnknown(entry.tabId);
                    break;
                }
                unknown = remaining;
            }
            const loaded = new Map(hb.loaded.map((entry) => [entry.tabId, entry]));
            targets.clear();
            tabTargets.clear();
            for (const tab of tabs.values()) {
                const entry = loaded.get(tab.id);
                if (!entry) {
                    const wasLoaded = tab.loaded;
                    tab.loaded = false;
                    if (wasLoaded) tabGone(tab.id);
                    continue;
                }
                // A view whose first load hasn't committed reports no url yet.
                const url = entry.url || tab.url;
                const changed = tab.url !== url || tab.title !== entry.title;
                tab.loaded = true;
                tab.url = url;
                tab.title = entry.title;
                setTarget(tab.id, entry.targetId);
                if (changed && !tab.parentId) {
                    void store.put(tab).catch((error: unknown) => {
                        console.error("Failed to save browser tab heartbeat", error);
                    });
                }
            }
            for (const targetId of appTargetIds) {
                for (const resolve of targetWaiters.get(targetId) ?? []) resolve(null);
            }
            cancelStaleness?.();
            cancelStaleness = schedule(checkStaleness, HOST_STALE_MS);
            if (before !== JSON.stringify(list())) publish();
        },
        async hostEvent(ev) {
            if (ev.type === "closed") {
                if (!(await closeFamily(ev.tabId, false))) await store.remove(ev.tabId);
                return;
            }
            if (ev.type === "child-opened") {
                const parent = tabs.get(ev.parentId);
                if (!parent || closing.has(ev.parentId)) {
                    closeUnknown(ev.tabId);
                    return;
                }
                const before = JSON.stringify(list());
                const tab =
                    tabs.get(ev.tabId) ?? newTab(ev.tabId, parent.scope, ev.url, ev.parentId);
                tab.url = ev.url;
                tab.loaded = true;
                tabs.set(tab.id, tab);
                setTarget(tab.id, ev.targetId);
                if (before !== JSON.stringify(list())) publish();
                return;
            }
            const tab = tabs.get(ev.tabId);
            if (!tab) return;
            tab.url = ev.url;
            tab.title = ev.title;
            if (!tab.parentId) await store.put(tab);
            publish();
        },
    };
}

export { createBrowserTabService };
export type { BrowserTabService };
