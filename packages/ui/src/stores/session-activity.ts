import { isSessionFocused } from "./session-helpers";
import type { Tab } from "./session-helpers";
import { registerBackendReset } from "./store-reset";

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
/** The machine each session reported its activity from, so a detach can find its timers. */
const sessionBackends = new Map<string, string>();

function noteSessionBackend(sessionId: string, backendId: string): void {
    sessionBackends.set(sessionId, backendId);
}

function sessionsOwnedBy(backendId: string): string[] {
    const owned: string[] = [];
    for (const [sessionId, owner] of sessionBackends) {
        if (owner === backendId) owned.push(sessionId);
    }
    return owned;
}

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

/** A session that is gone: no timer, no interaction, no owner. */
function forgetSession(sessionId: string): void {
    clearActivityTimer(sessionId);
    clearInteraction(sessionId);
    sessionBackends.delete(sessionId);
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

// A debounce firing after its machine is detached would set a status for a
// session that no longer exists, bringing back its badge and lighting the tray.
// The owner entries stay: the session store's reset reads them next.
registerBackendReset("session-activity", (backendId) => {
    for (const sessionId of sessionsOwnedBy(backendId)) {
        clearActivityTimer(sessionId);
        clearInteraction(sessionId);
    }
});

export {
    noteSessionBackend,
    sessionsOwnedBy,
    forgetSession,
    markInteraction,
    isUserInteracting,
    clearActivityTimer,
    settleInactiveSession,
    scheduleActivityTimeout,
};
