import { randomUUID } from "node:crypto";
import type { BrowserHostHeartbeat } from "@taskflow/shared";

export type Bounds = { x: number; y: number; width: number; height: number };

export interface HostedView {
    targetId: string;
    url(): string;
    title(): string;
    show(bounds: Bounds): void;
    hide(): void;
    navigate(url: string): void;
    back(): void;
    forward(): void;
    reload(): void;
    navState(): { canGoBack: boolean; canGoForward: boolean };
    capture(): Promise<string>;
    destroy(): void;
}

export interface ViewFactory {
    create(req: { tabId: string; url: string; opener?: unknown }): Promise<HostedView>;
    appTargetIds(): Promise<string[]>;
}

export interface TabHostEvents {
    navigated(tabId: string, url: string, title: string): void;
    childOpened(tabId: string, parentId: string, url: string, targetId: string): void;
    closed(tabId: string): void;
    navState(tabId: string, state: ReturnType<HostedView["navState"]>): void;
    loadedChanged(): void;
}

interface Entry {
    view: HostedView;
    parentId?: string;
    frameName?: string;
}

export class TabHost {
    private readonly views = new Map<string, Entry>();
    private readonly pending = new Map<string, Promise<{ targetId: string }>>();
    private readonly generations = new Map<string, number>();
    private readonly popupNames = new Map<string, string>();

    constructor(
        private readonly factory: ViewFactory,
        private readonly events: TabHostEvents,
    ) {}

    ensure(req: { tabId: string; url: string; parentId?: string }): Promise<{ targetId: string }> {
        const entry = this.views.get(req.tabId);
        if (entry) return Promise.resolve({ targetId: entry.view.targetId });
        const pending = this.pending.get(req.tabId);
        if (pending) return pending;
        // Keep a generation even for ensure-only tabs, so detach/close see pending work.
        if (!this.generations.has(req.tabId)) this.generations.set(req.tabId, 0);
        const creation = this.factory
            .create(req)
            .then((view) => {
                if (this.pending.get(req.tabId) !== creation) {
                    view.destroy();
                    throw new Error("Browser tab not found");
                }
                this.views.set(req.tabId, { view, parentId: req.parentId });
                this.events.loadedChanged();
                return { targetId: view.targetId };
            })
            .finally(() => {
                if (this.pending.get(req.tabId) === creation) this.pending.delete(req.tabId);
            });
        this.pending.set(req.tabId, creation);
        return creation;
    }

    close(tabId: string): void {
        for (const [id, entry] of this.views) {
            if (entry.parentId === tabId) this.close(id);
        }
        this.bump(tabId);
        this.pending.delete(tabId);
        const entry = this.views.get(tabId);
        this.forget(tabId);
        if (entry) {
            entry.view.destroy();
            this.events.closed(tabId);
            this.events.loadedChanged();
        }
    }

    async show(tabId: string, url: string, bounds: Bounds): Promise<void> {
        const generation = this.bump(tabId);
        await this.ensure({ tabId, url });
        if (this.generations.get(tabId) !== generation) return;
        const view = this.views.get(tabId)?.view;
        if (!view) return;
        view.show(bounds);
        this.events.navState(tabId, view.navState());
    }

    hide(tabId: string): void {
        this.bump(tabId);
        this.views.get(tabId)?.view.hide();
    }

    navigate(tabId: string, url: string): void {
        this.views.get(tabId)?.view.navigate(url);
    }
    back(tabId: string): void {
        this.views.get(tabId)?.view.back();
    }
    forward(tabId: string): void {
        this.views.get(tabId)?.view.forward();
    }
    reload(tabId: string): void {
        this.views.get(tabId)?.view.reload();
    }

    detachAll(): void {
        for (const tabId of this.generations.keys()) this.hide(tabId);
    }

    async freeze(tabId: string): Promise<string> {
        const generation = this.bump(tabId);
        const view = this.views.get(tabId)?.view;
        if (!view) return "";
        const image = await view.capture();
        if (this.generations.get(tabId) === generation && this.views.get(tabId)?.view === view)
            view.hide();
        return image;
    }

    loaded(): BrowserHostHeartbeat["loaded"] {
        return [...this.views].map(([tabId, { view, parentId }]) => ({
            tabId,
            targetId: view.targetId,
            url: view.url(),
            title: view.title(),
            ...(parentId ? { parentId } : {}),
        }));
    }

    reportNavigated(tabId: string): void {
        const view = this.views.get(tabId)?.view;
        if (!view) return;
        this.events.navigated(tabId, view.url(), view.title());
        this.events.navState(tabId, view.navState());
    }

    claimPopupName(parentId: string, frameName: string): boolean {
        if (!frameName) return true;
        const root = this.familyRoot(parentId);
        const owner = this.popupNames.get(frameName);
        if (owner !== undefined && owner !== root) return false;
        this.popupNames.set(frameName, root);
        return true;
    }

    reportChildOpened(parentId: string, view: HostedView, frameName: string): string {
        const tabId = randomUUID();
        this.claimPopupName(parentId, frameName);
        this.views.set(tabId, { view, parentId, frameName });
        this.generations.set(tabId, 0);
        this.events.childOpened(tabId, parentId, view.url(), view.targetId);
        this.events.loadedChanged();
        return tabId;
    }

    reportClosed(tabId: string): void {
        const entry = this.views.get(tabId);
        if (!entry) return;
        for (const [id, child] of this.views) {
            if (child.parentId === tabId) this.close(id);
        }
        this.bump(tabId);
        this.forget(tabId);
        this.events.closed(tabId);
        this.events.loadedChanged();
    }

    private bump(tabId: string): number {
        const generation = (this.generations.get(tabId) ?? 0) + 1;
        this.generations.set(tabId, generation);
        return generation;
    }

    private familyRoot(tabId: string): string {
        let root = tabId;
        for (
            let parent = this.views.get(root)?.parentId;
            parent;
            parent = this.views.get(root)?.parentId
        )
            root = parent;
        return root;
    }

    private forget(tabId: string): void {
        const entry = this.views.get(tabId);
        if (entry?.frameName) this.popupNames.delete(entry.frameName);
        if (!entry?.parentId) {
            for (const [name, owner] of this.popupNames) {
                if (owner === tabId) this.popupNames.delete(name);
            }
        }
        this.views.delete(tabId);
    }
}
