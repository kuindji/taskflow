import { MSG } from "@taskflow/shared";
import type { SessionCreatePayload, SessionCreateResponse, SessionRef } from "@taskflow/shared";
import type { SessionBridge } from "../opentui/session-bridge";
import { ownerKey, type SessionOwner } from "./owner";

interface ControllerBridge {
    readonly renderable: SessionBridge["renderable"];
    attach(): Promise<void>;
    setActive(active: boolean, cols?: number, rows?: number): void;
    focus(): void;
    blur(): void;
    setInputEnabled(enabled: boolean): void;
    destroy(): void;
}

interface SessionTab {
    id: string;
    label: string;
    type: SessionRef["type"];
    state: NonNullable<SessionRef["state"]>;
    nativeSessionId?: string;
    agentOptions?: SessionRef["agentOptions"];
    bridge: ControllerBridge;
}

interface SessionControllerDeps {
    createBridge(ref: SessionRef, owner: SessionOwner): ControllerBridge;
    request?<T>(type: string, payload?: unknown): Promise<T>;
    onChange(tabs: readonly SessionTab[], activeId: string | null): void;
}

function supported(ref: SessionRef): boolean {
    return ref.type !== "editor";
}

function tabFrom(ref: SessionRef, bridge: ControllerBridge): SessionTab {
    return {
        id: ref.id,
        label: ref.label,
        type: ref.type,
        state: ref.state ?? "live",
        nativeSessionId: ref.nativeSessionId,
        agentOptions: ref.agentOptions,
        bridge,
    };
}

class SessionController {
    private owner: SessionOwner | null = null;
    private ownerKeyValue: string | null = null;
    private tabsValue: SessionTab[] = [];
    private readonly activeByOwner = new Map<string, string>();
    private readonly pendingCloses = new Set<string>();
    private readonly pendingResumes = new Set<string>();
    private destroyed = false;

    constructor(private readonly deps: SessionControllerDeps) {}

    reconcile(owner: SessionOwner, refs: readonly SessionRef[]): void {
        if (this.destroyed) return;
        const nextOwnerKey = ownerKey(owner);
        const ownerChanged = nextOwnerKey !== this.ownerKeyValue;
        const previousTabs = this.tabsValue;
        const previousActiveId = this.ownerKeyValue
            ? (this.activeByOwner.get(this.ownerKeyValue) ?? null)
            : null;
        const previousActiveIndex = Math.max(
            0,
            previousTabs.findIndex((tab) => tab.id === previousActiveId),
        );

        if (ownerChanged) {
            for (const tab of previousTabs) {
                this.pendingResumes.delete(tab.id);
                tab.bridge.destroy();
            }
            this.tabsValue = [];
        }

        this.owner = owner;
        this.ownerKeyValue = nextOwnerKey;
        const existing = new Map(this.tabsValue.map((tab) => [tab.id, tab]));
        const nextTabs: SessionTab[] = [];
        const created: SessionTab[] = [];
        const resumed: SessionTab[] = [];
        for (const ref of refs) {
            if (!supported(ref)) continue;
            const effectiveRef =
                this.pendingResumes.has(ref.id) && (ref.state ?? "live") === "interrupted"
                    ? { ...ref, state: "resuming" as const }
                    : ref;
            const current = existing.get(ref.id);
            if (current) {
                existing.delete(ref.id);
                const next = tabFrom(effectiveRef, current.bridge);
                next.bridge.setInputEnabled(next.state === "live");
                nextTabs.push(next);
                if (current.state !== "live" && next.state === "live") {
                    this.pendingResumes.delete(next.id);
                    resumed.push(next);
                }
                continue;
            }
            const tab = tabFrom(effectiveRef, this.deps.createBridge(effectiveRef, owner));
            tab.bridge.setInputEnabled(tab.state === "live");
            nextTabs.push(tab);
            created.push(tab);
        }
        for (const removed of existing.values()) {
            this.pendingResumes.delete(removed.id);
            removed.bridge.destroy();
        }
        this.tabsValue = nextTabs;

        const remembered = this.activeByOwner.get(nextOwnerKey);
        let activeId =
            remembered && nextTabs.some((tab) => tab.id === remembered) ? remembered : null;
        if (activeId === null && nextTabs.length > 0) {
            const fallbackIndex = ownerChanged
                ? 0
                : Math.min(previousActiveIndex, nextTabs.length - 1);
            activeId = nextTabs[fallbackIndex].id;
            this.activeByOwner.set(nextOwnerKey, activeId);
        }
        if (nextTabs.length === 0) this.activeByOwner.delete(nextOwnerKey);

        this.deps.onChange(this.tabsValue, activeId);
        for (const tab of created) void tab.bridge.attach().catch(() => undefined);
        for (const tab of resumed) void tab.bridge.attach().catch(() => undefined);
    }

    select(sessionId: string): void {
        if (this.ownerKeyValue === null) return;
        if (!this.tabsValue.some((tab) => tab.id === sessionId)) return;
        this.activeByOwner.set(this.ownerKeyValue, sessionId);
    }

    async create(owner: SessionOwner, payload: SessionCreatePayload): Promise<string> {
        if (!this.deps.request) throw new Error("Session creation is not configured");
        const response = await this.deps.request<SessionCreateResponse>(
            MSG.SESSION_CREATE,
            payload,
        );
        const key = ownerKey(owner);
        this.activeByOwner.set(key, response.sessionId);
        if (
            this.ownerKeyValue === key &&
            this.tabsValue.some((tab) => tab.id === response.sessionId)
        ) {
            this.deps.onChange(this.tabsValue, response.sessionId);
        }
        return response.sessionId;
    }

    async close(sessionId: string): Promise<void> {
        if (!this.deps.request) throw new Error("Session close is not configured");
        if (this.pendingCloses.has(sessionId)) return;
        if (!this.tabsValue.some((tab) => tab.id === sessionId)) {
            throw new Error("Session is no longer available");
        }
        this.pendingCloses.add(sessionId);
        try {
            await this.deps.request(MSG.SESSION_CLOSE, { sessionId });
        } finally {
            this.pendingCloses.delete(sessionId);
        }
    }

    async resume(sessionId: string, cols: number, rows: number): Promise<void> {
        if (!this.deps.request) throw new Error("Session resume is not configured");
        if (this.pendingResumes.has(sessionId)) return;
        const tab = this.tabsValue.find((candidate) => candidate.id === sessionId);
        if (!tab) throw new Error("Session is no longer available");
        if (
            tab.state !== "interrupted" ||
            tab.type === "shell" ||
            tab.type === "editor" ||
            !tab.nativeSessionId
        ) {
            throw new Error("Session cannot be resumed");
        }
        this.pendingResumes.add(sessionId);
        tab.state = "resuming";
        tab.bridge.setInputEnabled(false);
        this.deps.onChange(this.tabsValue, sessionId);
        try {
            await this.deps.request(MSG.SESSION_RESUME, { sessionId, cols, rows });
        } catch (error) {
            this.pendingResumes.delete(sessionId);
            const current = this.tabsValue.find((candidate) => candidate.id === sessionId);
            if (current) {
                current.state = "interrupted";
                current.bridge.setInputEnabled(false);
                this.deps.onChange(this.tabsValue, sessionId);
            }
            throw error;
        }
    }

    reattach(): void {
        for (const tab of this.tabsValue) void tab.bridge.attach().catch(() => undefined);
    }

    get tabs(): readonly SessionTab[] {
        return this.tabsValue;
    }

    get selectedOwner(): SessionOwner | null {
        return this.owner;
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const tab of this.tabsValue) tab.bridge.destroy();
        this.tabsValue = [];
        this.pendingCloses.clear();
        this.pendingResumes.clear();
    }
}

export { SessionController };
export type { ControllerBridge, SessionControllerDeps, SessionTab };
