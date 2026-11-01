import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    MSG,
    type BrowserHostHeartbeat,
    type BrowserTabScope,
    type WsEvent,
} from "@taskflow/shared";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { BrowserHostClient } from "../../src/services/browser-host-client";
import {
    BrowserHostUnavailableError,
    BrowserTabInputError,
    BrowserTabNotFoundError,
} from "../../src/services/browser-tab-errors";
import { BrowserTabStore, type SavedBrowserTab } from "../../src/services/browser-tab-store";
import {
    createBrowserTabService,
    type BrowserTabService,
} from "../../src/services/browser-tab-service";
import { expectRejects } from "../expect-rejects";

class RecordingStore extends BrowserTabStore {
    removed: string[] = [];
    failRemove = new Set<string>();
    failPut = false;
    putGate: Promise<void> | null = null;
    override async put(tab: SavedBrowserTab): Promise<void> {
        if (this.putGate) await this.putGate;
        if (this.failPut) throw new Error("store write failed");
        await super.put(tab);
    }
    override async remove(id: string): Promise<boolean> {
        this.removed.push(id);
        if (this.failRemove.has(id)) throw new Error("store write failed");
        return super.remove(id);
    }
}
class FakeHost implements BrowserHostClient {
    ensured: { controlUrl: string; tabId: string; url: string; parentId?: string }[] = [];
    closed: { controlUrl: string; tabId: string }[] = [];
    failEnsure = false;
    failClose = false;
    ensureGate: Promise<void> | null = null;
    closeGate: Promise<void> | null = null;
    async ensure(
        controlUrl: string,
        req: { tabId: string; url: string; parentId?: string },
    ): Promise<{ targetId: string }> {
        this.ensured.push({ controlUrl, ...req });
        if (this.ensureGate) await this.ensureGate;
        if (this.failEnsure) throw new BrowserHostUnavailableError();
        return { targetId: `target:${req.tabId}` };
    }
    async close(controlUrl: string, tabId: string): Promise<void> {
        this.closed.push({ controlUrl, tabId });
        if (this.closeGate) await this.closeGate;
        if (this.failClose) throw new BrowserHostUnavailableError();
    }
}
class FakeClock {
    time = Date.parse("2026-10-30T00:00:00.000Z");
    timers = new Set<{ at: number; fn: () => void }>();
    now = () => this.time;
    schedule = (fn: () => void, ms: number): (() => void) => {
        const timer = { at: this.time + ms, fn };
        this.timers.add(timer);
        return () => {
            this.timers.delete(timer);
        };
    };
    advance(ms: number): void {
        const end = this.time + ms;
        for (;;) {
            const next = [...this.timers].sort((a, b) => a.at - b.at)[0];
            if (!next || next.at > end) break;
            this.time = next.at;
            this.timers.delete(next);
            next.fn();
        }
        this.time = end;
    }
}
const taskScope: BrowserTabScope = { kind: "task", taskId: "task-1" };
const otherScope: BrowserTabScope = { kind: "task", taskId: "task-2" };
const masterScope: BrowserTabScope = { kind: "master" };
const controlUrl = "http://127.0.0.1:12345";
const unavailable =
    "Browser not available on this machine: the Taskflow desktop app must be running here";
function saved(id: string, scope: BrowserTabScope = taskScope): SavedBrowserTab {
    return {
        id,
        scope,
        label: "example.com",
        url: "https://example.com",
        createdAt: "2026-10-30T00:00:00.000Z",
    };
}
async function rejectsAs(
    promise: Promise<unknown>,
    ctor: new () => Error,
    message: string,
): Promise<void> {
    await expectRejects(
        promise.catch((error: unknown) => {
            expect(error).toBeInstanceOf(ctor);
            expect(error instanceof Error ? error.message : "").toBe(message);
            throw error;
        }),
        message,
    );
}

describe("BrowserTabService", () => {
    let dir: string;
    let store: RecordingStore;
    let host: FakeHost;
    let clock: FakeClock;
    let events: WsEvent[];
    let service: BrowserTabService;
    let inactive: Set<string>;
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "browser-tab-service-"));
        store = new RecordingStore(join(dir, "tabs.json"));
        host = new FakeHost();
        clock = new FakeClock();
        events = [];
        inactive = new Set();
        service = createBrowserTabService({
            store,
            hostClient: host,
            broadcast: (event) => events.push(event),
            now: clock.now,
            schedule: clock.schedule,
            isOwnerActive: async (scope) => scope.kind !== "task" || !inactive.has(scope.taskId),
        });
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });
    function heartbeat(
        loaded: BrowserHostHeartbeat["loaded"] = [],
        appTargetIds: string[] = [],
    ): void {
        service.hostHeartbeat({ controlUrl, debugPort: 9222, loaded, appTargetIds });
    }
    async function seed(...tabs: SavedBrowserTab[]): Promise<void> {
        for (const tab of tabs) await store.put(tab);
        await service.init();
    }
    async function open(scope = taskScope, url = "https://example.com/path") {
        return service.open({ scope, url });
    }
    async function family() {
        heartbeat();
        const root = await open();
        const child = await service.openChild(root.id, "https://example.com/child");
        const grandchild = await service.openChild(child.tab.id, "https://example.com/grandchild");
        return [root.id, child.tab.id, grandchild.tab.id];
    }
    it("open without a host throws the exact unavailable message and saves nothing", async () => {
        await rejectsAs(open(), BrowserHostUnavailableError, unavailable);
        expect(await store.list()).toEqual([]);
        expect(service.list()).toEqual({ tabs: [], hostAvailable: false });
        expect(events).toEqual([]);
    });
    it("open with a host saves, ensures and returns a loaded tab with a hostname label", async () => {
        heartbeat();
        events.length = 0;
        const tab = await open();
        expect(tab).toMatchObject({
            scope: taskScope,
            url: "https://example.com/path",
            label: "example.com/path",
            loaded: true,
            agentConnections: 0,
            createdAt: new Date(clock.time).toISOString(),
        });
        expect(await store.list()).toEqual([
            {
                id: tab.id,
                scope: tab.scope,
                label: tab.label,
                url: tab.url,
                createdAt: tab.createdAt,
            },
        ]);
        expect(host.ensured).toEqual([{ controlUrl, tabId: tab.id, url: tab.url }]);
        expect(service.tabIdForTarget(`target:${tab.id}`)).toBe(tab.id);
        expect(events).toEqual([{ type: MSG.BROWSER_TABS_LIST, payload: service.list() }]);
    });
    it("open removes the record when ensure fails", async () => {
        heartbeat();
        host.failEnsure = true;
        await rejectsAs(open(), BrowserHostUnavailableError, unavailable);
        expect(await store.list()).toEqual([]);
        expect(service.list().tabs).toEqual([]);
    });
    it("open rejects an empty url with the exact message", async () => {
        for (const url of ["", "  ", null, 7]) {
            await rejectsAs(
                service.open({ scope: taskScope, url: url as string }),
                BrowserTabInputError,
                "Field 'url' is required and must be a non-empty string",
            );
        }
        expect(await store.list()).toEqual([]);
    });
    it("heartbeat marks listed tabs loaded and others unloaded", async () => {
        await seed(saved("one"), saved("two"));
        const gone: string[] = [];
        service.subscribeTabGone((id) => gone.push(id));
        heartbeat([{ tabId: "one", targetId: "target-1", url: "https://example.com" }]);
        expect(service.get("one")?.loaded).toBe(true);
        expect(service.get("two")?.loaded).toBe(false);
        heartbeat([{ tabId: "two", targetId: "target-2", url: "https://example.com" }]);
        expect(service.get("one")?.loaded).toBe(false);
        expect(service.get("two")?.loaded).toBe(true);
        expect(service.tabIdForTarget("target-1")).toBeNull();
        expect(service.tabIdForTarget("target-2")).toBe("two");
        expect(gone).toEqual(["one"]);
        const count = events.length;
        heartbeat([{ tabId: "two", targetId: "target-2", url: "https://example.com" }]);
        expect(events).toHaveLength(count);
    });
    it("heartbeat closes host views the registry does not know", () => {
        heartbeat([{ tabId: "unknown", targetId: "target", url: "https://example.com" }]);
        expect(host.closed).toEqual([{ controlUrl, tabId: "unknown" }]);
        expect(service.list().tabs).toEqual([]);
    });
    it("heartbeat adopts an unknown child whose parent is known, unsaved, under the parent's scope", async () => {
        await seed(saved("parent"));
        heartbeat([
            {
                tabId: "child",
                parentId: "parent",
                targetId: "child-target",
                url: "https://example.com/popup",
                title: "Popup",
            },
        ]);
        expect(service.get("child")).toMatchObject({
            parentId: "parent",
            scope: taskScope,
            loaded: true,
            label: "example.com/popup",
            title: "Popup",
            createdAt: new Date(clock.time).toISOString(),
        });
        expect(service.tabIdForTarget("child-target")).toBe("child");
        expect((await store.list()).map((tab) => tab.id)).toEqual(["parent"]);
    });
    it("heartbeat adopts a grandchild listed before its parent", async () => {
        await seed(saved("root"));
        heartbeat([
            {
                tabId: "grandchild",
                parentId: "child",
                targetId: "grand-target",
                url: "https://example.com/grand",
            },
            {
                tabId: "child",
                parentId: "root",
                targetId: "child-target",
                url: "https://example.com/child",
            },
        ]);
        expect(service.familyOf("root")).toEqual(new Set(["root", "child", "grandchild"]));
        expect(service.get("grandchild")?.scope).toEqual(taskScope);
        expect(host.closed).toEqual([]);
        expect((await store.list()).map((tab) => tab.id)).toEqual(["root"]);
    });
    it("child-opened after a heartbeat already adopted the child does not duplicate it", async () => {
        await seed(saved("root"));
        heartbeat([
            {
                tabId: "child",
                parentId: "root",
                targetId: "first",
                url: "https://example.com/child",
            },
        ]);
        const createdAt = service.get("child")?.createdAt;
        await service.hostEvent({
            type: "child-opened",
            tabId: "child",
            parentId: "root",
            targetId: "second",
            url: "https://example.com/updated",
        });
        expect(service.list().tabs).toHaveLength(2);
        expect(service.get("child")).toMatchObject({
            createdAt,
            url: "https://example.com/updated",
        });
        expect(service.tabIdForTarget("first")).toBeNull();
        expect(service.tabIdForTarget("second")).toBe("child");
    });
    it("heartbeat keeps the known url while the view reports none (first load pending)", async () => {
        await seed(saved("root"));
        heartbeat([{ tabId: "root", targetId: "target", url: "" }]);
        expect(service.get("root")?.url).toBe(saved("root").url);
        expect((await store.list())[0]?.url).toBe(saved("root").url);
    });
    it("heartbeat updates url and title of loaded tabs and persists saved ones", async () => {
        await seed(saved("root"));
        heartbeat([
            {
                tabId: "root",
                targetId: "target",
                url: "https://example.com/new",
                title: "New title",
            },
        ]);
        expect(service.get("root")).toMatchObject({
            url: "https://example.com/new",
            title: "New title",
        });
        expect(await store.list()).toEqual([
            { ...saved("root"), url: "https://example.com/new", title: "New title" },
        ]);
        heartbeat([
            {
                tabId: "root",
                targetId: "target",
                url: "https://example.com/new",
                title: "Title only",
            },
        ]);
        expect((await store.list())[0].title).toBe("Title only");
    });
    it("host goes stale after 15000 ms: tabs unload, tab-gone fires, hostAvailable false, one broadcast", async () => {
        heartbeat();
        const tab = await open();
        const gone: string[] = [];
        service.subscribeTabGone((id) => gone.push(id));
        events.length = 0;
        clock.advance(15000);
        expect(service.hostAvailable()).toBe(true);
        clock.advance(1);
        expect(service.hostAvailable()).toBe(false);
        expect(service.get(tab.id)?.loaded).toBe(false);
        expect(service.tabIdForTarget(`target:${tab.id}`)).toBeNull();
        expect(gone).toEqual([tab.id]);
        expect(events).toEqual([{ type: MSG.BROWSER_TABS_LIST, payload: service.list() }]);
        clock.advance(15000);
        expect(events).toHaveLength(1);
    });
    it("child-opened adds an unsaved child with the parent's scope", async () => {
        heartbeat();
        const parent = await open();
        await service.hostEvent({
            type: "child-opened",
            tabId: "child",
            parentId: parent.id,
            targetId: "child-target",
            url: "https://example.com/popup",
        });
        expect(service.get("child")).toMatchObject({
            parentId: parent.id,
            scope: taskScope,
            loaded: true,
            agentConnections: 0,
        });
        expect((await store.list()).map((tab) => tab.id)).toEqual([parent.id]);
    });
    it("child-opened with an unknown parent asks the host to close it", async () => {
        heartbeat();
        host.failClose = true;
        await service.hostEvent({
            type: "child-opened",
            tabId: "child",
            parentId: "unknown",
            targetId: "target",
            url: "https://example.com",
        });
        expect(host.closed).toEqual([{ controlUrl, tabId: "child" }]);
        expect(service.get("child")).toBeNull();
    });
    it("close closes descendants first and fires tab-gone for each", async () => {
        const ids = await family();
        const gone: string[] = [];
        const unsubscribe = service.subscribeTabGone((id) => gone.push(id));
        host.failClose = true;
        events.length = 0;
        expect(await service.close(ids[0])).toBe(true);
        expect(host.closed.map((call) => call.tabId)).toEqual([...ids].reverse());
        expect(gone).toEqual([...ids].reverse());
        expect(service.list().tabs).toEqual([]);
        expect(await store.list()).toEqual([]);
        expect(events).toHaveLength(1);
        expect(await service.close(ids[0])).toBe(false);
        unsubscribe();
        const another = await open();
        await service.close(another.id);
        expect(gone).toHaveLength(3);
    });
    it("close with a failing store write still drops every tab and fires tab-gone, then rejects", async () => {
        const ids = await family();
        for (const id of ids) store.failRemove.add(id);
        const gone: string[] = [];
        service.subscribeTabGone((id) => gone.push(id));
        events.length = 0;
        await expectRejects(service.close(ids[0]), "store write failed");
        expect(service.list().tabs).toEqual([]);
        expect(gone).toEqual([...ids].reverse());
        expect(store.removed).toEqual([...ids].reverse());
        expect(events).toHaveLength(1);
        for (const id of ids) expect(service.tabIdForTarget(`target:${id}`)).toBeNull();
    });
    it("closed for an id the registry no longer holds removes it from the store and resolves", async () => {
        await store.put(saved("forgotten"));
        await service.hostEvent({ type: "closed", tabId: "forgotten" });
        expect(await store.list()).toEqual([]);
        expect(store.removed).toEqual(["forgotten"]);
        expect(host.closed).toEqual([]);
    });
    it("closeForOwner closes only that task's tabs and their children", async () => {
        const ids = await family();
        const other = await open(otherScope);
        const master = await open(masterScope);
        const project = await open({ kind: "project", projectId: "project-1" });
        await service.closeForOwner({ taskId: "task-1" });
        expect(service.list().tabs.map((tab) => tab.id)).toEqual([other.id, master.id, project.id]);
        expect(host.closed.map((call) => call.tabId)).toEqual([...ids].reverse());
        await service.closeForOwner({ projectId: "project-1" });
        expect(service.list().tabs.map((tab) => tab.id)).toEqual([other.id, master.id]);
    });
    it("closeForOwner during an open's registry write cancels the open", async () => {
        heartbeat();
        let release = () => {};
        store.putGate = new Promise((resolve) => {
            release = resolve;
        });
        const opening = open();
        await service.closeForOwner({ taskId: "task-1" });
        store.putGate = null;
        release();
        await rejectsAs(opening, BrowserTabNotFoundError, "Browser tab not found");
        expect(host.ensured).toEqual([]);
        expect(service.list().tabs).toEqual([]);
        expect(await store.list()).toEqual([]);
    });
    it("ensureLoaded on an unloaded saved tab ensures it with its last url", async () => {
        await seed({ ...saved("root"), url: "https://example.com/last" });
        heartbeat();
        expect(await service.ensureLoaded("root")).toEqual({
            targetId: "target:root",
            debugPort: 9222,
        });
        expect(host.ensured).toEqual([
            { controlUrl, tabId: "root", url: "https://example.com/last" },
        ]);
        expect(service.get("root")?.loaded).toBe(true);
        await service.ensureLoaded("root");
        expect(host.ensured).toHaveLength(1);
    });
    it("a heartbeat built before an ensure does not unload the freshly loaded tab", async () => {
        await seed(saved("root"));
        heartbeat();
        const gone: string[] = [];
        service.subscribeTabGone((id) => gone.push(id));
        await service.ensureLoaded("root");
        // Snapshotted by the host before the view existed, delivered after the ensure.
        heartbeat();
        expect(gone).toEqual([]);
        expect(service.get("root")?.loaded).toBe(true);
        expect(service.tabIdForTarget("target:root")).toBe("root");
        // The view really is gone once a later heartbeat still lacks it.
        heartbeat();
        expect(gone).toEqual(["root"]);
        expect(service.get("root")?.loaded).toBe(false);
        expect(service.tabIdForTarget("target:root")).toBeNull();
    });
    it("a heartbeat that lists an ensured tab confirms it", async () => {
        await seed(saved("root"));
        heartbeat();
        const gone: string[] = [];
        service.subscribeTabGone((id) => gone.push(id));
        await service.ensureLoaded("root");
        heartbeat([{ tabId: "root", targetId: "target:root", url: "https://example.com" }]);
        heartbeat();
        expect(gone).toEqual(["root"]);
    });
    it("ensureLoaded on an unloaded child closes it and throws not found", async () => {
        const [root, child] = await family();
        // The first heartbeat after an ensure may predate the view, so it takes two.
        heartbeat([{ tabId: root, targetId: "root-target", url: "https://example.com/path" }]);
        heartbeat([{ tabId: root, targetId: "root-target", url: "https://example.com/path" }]);
        await rejectsAs(
            service.ensureLoaded(child),
            BrowserTabNotFoundError,
            "Browser tab not found",
        );
        expect(service.get(child)).toBeNull();
        expect(service.familyOf(root)).toEqual(new Set([root]));
    });
    it("close during a pending ensure closes the late view and rejects the load", async () => {
        await seed(saved("root"));
        heartbeat();
        let release = () => {};
        host.ensureGate = new Promise((resolve) => {
            release = resolve;
        });
        const loading = service.ensureLoaded("root");
        expect(await service.close("root")).toBe(true);
        expect(host.closed).toEqual([]);
        release();
        await rejectsAs(loading, BrowserTabNotFoundError, "Browser tab not found");
        expect(host.closed).toEqual([{ controlUrl, tabId: "root" }]);
        expect(service.tabIdForTarget("target:root")).toBeNull();
        expect(service.get("root")).toBeNull();
    });
    it("no child joins a family while it is closing", async () => {
        heartbeat();
        const root = await open();
        let release = () => {};
        host.closeGate = new Promise((resolve) => {
            release = resolve;
        });
        const closing = service.close(root.id);
        await rejectsAs(
            service.openChild(root.id, "https://example.com/late"),
            BrowserTabNotFoundError,
            "Browser tab not found",
        );
        await service.hostEvent({
            type: "child-opened",
            tabId: "popup",
            parentId: root.id,
            url: "https://example.com/popup",
            targetId: "target:popup",
        });
        heartbeat([
            { tabId: root.id, targetId: `target:${root.id}`, url: root.url },
            { tabId: "adopted", targetId: "target:adopted", url: "about:blank", parentId: root.id },
        ]);
        release();
        expect(await closing).toBe(true);
        expect(service.list().tabs).toEqual([]);
        expect(host.closed.map((call) => call.tabId).sort()).toEqual(
            ["adopted", "popup", root.id].sort(),
        );
    });
    it("resolveTarget returns null at once for app targets", async () => {
        heartbeat([], ["app", "park"]);
        const timersBefore = clock.timers.size;
        expect(await service.resolveTarget("app")).toBeNull();
        expect(await service.resolveTarget("park")).toBeNull();
        expect(clock.timers.size).toBe(timersBefore);
    });
    it("resolveTarget waits for a mapping that arrives within the wait", async () => {
        await seed(saved("root"));
        heartbeat();
        let resolved = false;
        const waiting = service.resolveTarget("new-target").then((result) => {
            resolved = true;
            return result;
        });
        await Promise.resolve();
        expect(resolved).toBe(false);
        clock.advance(1000);
        await service.hostEvent({
            type: "child-opened",
            tabId: "child",
            parentId: "root",
            url: "https://example.com/child",
            targetId: "new-target",
        });
        expect(await waiting).toEqual({ tabId: "child" });
        expect(await service.resolveTarget("new-target")).toEqual({ tabId: "child" });
        expect(clock.timers.size).toBe(1);
    });
    it("resolveTarget returns null after the wait for an unknown target", async () => {
        const waiting = service.resolveTarget("unknown");
        clock.advance(1999);
        clock.advance(1);
        expect(await waiting).toBeNull();
        const custom = service.resolveTarget("unknown", { waitMs: 50 });
        clock.advance(50);
        expect(await custom).toBeNull();
        expect(await service.resolveTarget("unknown", { waitMs: 0 })).toBeNull();
    });
    it("navigated updates url and title and persists saved tabs only", async () => {
        const [root, child] = await family();
        events.length = 0;
        await service.hostEvent({
            type: "navigated",
            tabId: root,
            url: "https://example.com/new-root",
            title: "Root",
        });
        await service.hostEvent({
            type: "navigated",
            tabId: child,
            url: "https://example.com/new-child",
            title: "Child",
        });
        expect(service.get(child)).toMatchObject({
            url: "https://example.com/new-child",
            title: "Child",
        });
        const persisted = await store.list();
        expect(persisted).toHaveLength(1);
        expect(persisted[0]).toMatchObject({
            id: root,
            url: "https://example.com/new-root",
            title: "Root",
        });
        expect(events).toHaveLength(2);
    });
    it("a successful navigated retry broadcasts after the first save failed", async () => {
        heartbeat();
        const tab = await open();
        events.length = 0;
        const event = {
            type: "navigated" as const,
            tabId: tab.id,
            url: "https://example.com/after-retry",
            title: "After retry",
        };
        store.failPut = true;
        await expectRejects(service.hostEvent(event), "store write failed");
        store.failPut = false;
        await service.hostEvent(event);
        expect((await store.list())[0]).toMatchObject({ url: event.url, title: event.title });
        expect(events).toEqual([{ type: MSG.BROWSER_TABS_LIST, payload: service.list() }]);
    });

    it("init drops saved tabs whose owner is not active", async () => {
        inactive.add("inactive");
        await seed(
            saved("active"),
            saved("archived", { kind: "task", taskId: "inactive" }),
            saved("master", masterScope),
        );
        expect(service.list().tabs).toEqual([
            { ...saved("active"), loaded: false, agentConnections: 0 },
            { ...saved("master", masterScope), loaded: false, agentConnections: 0 },
        ]);
        expect((await store.list()).map((tab) => tab.id)).toEqual(["active", "master"]);
        expect(events).toEqual([]);
    });
    it("list filters by scope and carries hostAvailable", async () => {
        heartbeat();
        const task = await open();
        const other = await open(otherScope);
        const master = await open(masterScope);
        const project = await open({ kind: "project", projectId: "p1" });
        expect(service.list({ scope: taskScope })).toEqual({ tabs: [task], hostAvailable: true });
        expect(service.list({ scope: otherScope }).tabs).toEqual([other]);
        expect(service.list({ scope: masterScope }).tabs).toEqual([master]);
        expect(service.list({ scope: { kind: "project", projectId: "p1" } }).tabs).toEqual([
            project,
        ]);
    });
    it("openChild ensures an unsaved loaded child and rejects an unknown parent", async () => {
        heartbeat();
        const parent = await open();
        const child = await service.openChild(parent.id, "https://example.com/child");
        expect(child).toMatchObject({
            tab: { parentId: parent.id, scope: taskScope, loaded: true },
            targetId: `target:${child.tab.id}`,
        });
        expect(host.ensured[1]).toEqual({
            controlUrl,
            tabId: child.tab.id,
            parentId: parent.id,
            url: child.tab.url,
        });
        expect((await store.list()).map((tab) => tab.id)).toEqual([parent.id]);
        await rejectsAs(
            service.openChild("unknown", "about:blank"),
            BrowserTabNotFoundError,
            "Browser tab not found",
        );
    });
    it("agent connection changes broadcast and never go below zero", async () => {
        heartbeat();
        const tab = await open();
        events.length = 0;
        service.addAgentConnection(tab.id, 1);
        expect(service.get(tab.id)?.agentConnections).toBe(1);
        expect(events[0]).toEqual({ type: MSG.BROWSER_TABS_LIST, payload: service.list() });
        service.addAgentConnection(tab.id, -1);
        service.addAgentConnection(tab.id, -1);
        service.addAgentConnection("unknown", 1);
        expect(service.get(tab.id)?.agentConnections).toBe(0);
        expect(events).toHaveLength(2);
    });
    it("label defaults keep the raw URL fallback and allow an explicit label", async () => {
        heartbeat();
        expect((await open(taskScope, "https://example.com/")).label).toBe("example.com");
        expect((await open(taskScope, "not a URL")).label).toBe("not a URL");
        expect(
            (await service.open({ scope: taskScope, url: "https://example.com", label: "Custom" }))
                .label,
        ).toBe("Custom");
    });
});
