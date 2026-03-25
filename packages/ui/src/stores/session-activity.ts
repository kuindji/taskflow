import { isSessionFocused } from "./session-helpers";
import type { Tab } from "./session-helpers";

type SessionStateGetter = () => {
    activeTabByWorkspace: Record<string, string>;
    tabsByWorkspace: Record<string, Tab[]>;
    sessionStatus: Partial<Record<string, string>>;
    setSessionStatus(sessionId: string, status?: string): void;
};

// Debounce timers for working → attention transitions
const activityTimers = new Map<string, ReturnType<typeof setTimeout>>();
const ACTIVITY_TIMEOUT = 3000;
const lastInteractionAt = new Map<string, number>();
const INTERACTION_SUPPRESSION_MS = 500;

function markInteraction(sessionId: string): void {
    lastInteractionAt.set(sessionId, Date.now());
}

function clearInteraction(sessionId: string): void {
    lastInteractionAt.delete(sessionId);
}

function isUserInteracting(sessionId: string): boolean {
    const lastAt = lastInteractionAt.get(sessionId);
    if (lastAt === undefined) return false;
    return Date.now() - lastAt < INTERACTION_SUPPRESSION_MS;
}

function clearActivityTimer(sessionId: string): void {
    const timer = activityTimers.get(sessionId);
    if (timer) {
        clearTimeout(timer);
        activityTimers.delete(sessionId);
    }
}

function settleInactiveSession(sessionId: string, getState: SessionStateGetter): void {
    const status = isSessionFocused(sessionId, getState) ? undefined : "attention";
    getState().setSessionStatus(sessionId, status);
}

function scheduleActivityTimeout(sessionId: string, getState: SessionStateGetter): void {
    clearActivityTimer(sessionId);
    activityTimers.set(
        sessionId,
        setTimeout(() => {
            activityTimers.delete(sessionId);
            settleInactiveSession(sessionId, getState);
        }, ACTIVITY_TIMEOUT),
    );
}

export {
    markInteraction,
    clearInteraction,
    isUserInteracting,
    clearActivityTimer,
    settleInactiveSession,
    scheduleActivityTimeout,
};
