import type { SessionRef, SessionStatus } from "@taskflow/shared";

type TrayState = Exclude<SessionStatus, "initializing"> | null;
type TimerHandle = ReturnType<typeof setTimeout>;

interface TraySessionState {
    supportsActivity: boolean;
    status: TrayState;
}

interface TrayStateTrackerOptions {
    activityTimeoutMs?: number;
}

const DEFAULT_ACTIVITY_TIMEOUT_MS = 3000;

export class TrayStateTracker {
    private readonly activityTimeoutMs: number;
    private readonly sessions = new Map<string, TraySessionState>();
    private readonly activityTimers = new Map<string, TimerHandle>();

    constructor(options: TrayStateTrackerOptions = {}) {
        this.activityTimeoutMs = options.activityTimeoutMs ?? DEFAULT_ACTIVITY_TIMEOUT_MS;
    }

    registerSession(sessionId: string, type: SessionRef["type"]): void {
        this.sessions.set(sessionId, {
            supportsActivity:
                type === "claude" ||
                type === "codex" ||
                type === "opencode" ||
                type === "pi" ||
                type === "kimi",
            status: null,
        });
    }

    markSessionActivity(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (!session?.supportsActivity) return;
        session.status = "working";
        this.scheduleAttentionTimeout(sessionId);
    }

    setSessionStatus(sessionId: string, status: SessionStatus): void {
        const session = this.sessions.get(sessionId);
        if (!session || status === "initializing") return;
        session.status = status;
        if (status === "working") {
            this.scheduleAttentionTimeout(sessionId);
            return;
        }
        this.clearActivityTimer(sessionId);
    }

    clearSession(sessionId: string): void {
        this.clearActivityTimer(sessionId);
        this.sessions.delete(sessionId);
    }

    getSessionStatus(sessionId: string): "working" | "attention" | "idle" {
        const session = this.sessions.get(sessionId);
        if (!session) return "idle";
        return session.status ?? "idle";
    }

    getAggregateState(): TrayState {
        let hasWorking = false;
        for (const session of this.sessions.values()) {
            if (session.status === "attention") return "attention";
            if (session.status === "working") hasWorking = true;
        }
        return hasWorking ? "working" : null;
    }

    private scheduleAttentionTimeout(sessionId: string): void {
        this.clearActivityTimer(sessionId);
        this.activityTimers.set(
            sessionId,
            setTimeout(() => {
                this.activityTimers.delete(sessionId);
                const session = this.sessions.get(sessionId);
                if (!session) return;
                session.status = "attention";
            }, this.activityTimeoutMs),
        );
    }

    private clearActivityTimer(sessionId: string): void {
        const timer = this.activityTimers.get(sessionId);
        if (!timer) return;
        clearTimeout(timer);
        this.activityTimers.delete(sessionId);
    }
}

export type { TrayState };
