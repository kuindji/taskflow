/**
 * Plan review repro (round 4) for docs/superpowers/plans/2026-08-24-taskflow-remote-projects.md
 *
 * Task 8 Step 6 turns useWebSocket.ts into a shim that routes to `getPrimary()`.
 * Nothing sets a primary until Task 10, and two real call sites subscribe to
 * status before any connect could have set one:
 *
 *   packages/ui/src/providers/WebSocketProvider.tsx:11  onStatusChange(...) on mount
 *   packages/ui/src/hooks/useAgentAvailability.ts:16    onStatusChange(...) at import
 *
 * The shim's `onStatusChange` returns a no-op when there is no primary, so those
 * subscribers are never notified — even after a primary is set and connects.
 * And WebSocketProvider.tsx:38 calls `connectWebSocket(port)`, which the shim
 * turns into `primaryOrThrow()` and throws. The shim and the registry pieces it
 * touches are transcribed verbatim; the assertions state the WRONG behaviour.
 *
 * Run: bun test ./plan-review/shim-status-before-primary.test.ts
 */
import { expect, test } from "bun:test";

interface ConnectionStatus {
    connected: boolean;
    reconnecting: boolean;
}

// ── Task 8 Step 4 (registry), the parts the shim uses, verbatim ─────────────
const statusListeners = new Map<string, Set<(status: ConnectionStatus) => void>>();
let primaryId: string | null = null;
function setPrimary(backendId: string): void {
    primaryId = backendId;
}
function getPrimary(): string | null {
    return primaryId;
}
function onStatusChangeRouted(
    backendId: string,
    handler: (status: ConnectionStatus) => void,
): () => void {
    let listeners = statusListeners.get(backendId);
    if (!listeners) {
        listeners = new Set();
        statusListeners.set(backendId, listeners);
    }
    listeners.add(handler);
    handler({ connected: false, reconnecting: false });
    return () => {
        statusListeners.get(backendId)?.delete(handler);
    };
}
/** What Connection.setStatus does through the registry's onStatus hook. */
function emitStatus(backendId: string, status: ConnectionStatus): void {
    for (const listener of statusListeners.get(backendId) ?? []) listener(status);
}

// ── Task 8 Step 6 (shim), verbatim ──────────────────────────────────────────
function primaryOrThrow(): string {
    const id = getPrimary();
    if (!id) throw new Error("No primary backend");
    return id;
}
function onStatusChange(handler: (status: ConnectionStatus) => void): () => void {
    const id = getPrimary();
    if (!id) return () => {};
    return onStatusChangeRouted(id, handler);
}
function openConnection(_backendId: string, _origin: string): Promise<void> {
    return Promise.resolve();
}
function connectWebSocket(origin: string): Promise<void> {
    return openConnection(primaryOrThrow(), origin);
}

test("a status subscriber registered before a primary exists is never notified", () => {
    const seen: ConnectionStatus[] = [];
    onStatusChange((status) => seen.push(status)); // WebSocketProvider.tsx:11, at mount

    setPrimary("local");
    emitStatus("local", { connected: true, reconnecting: false });

    expect(seen).toEqual([]); // WRONG: the provider never learns it is connected
});

test("the provider's connect throws before anything has set a primary", () => {
    primaryId = null;
    // WebSocketProvider.tsx:38 — the very first connect of the app.
    expect(() => connectWebSocket("http://localhost:7100")).toThrow("No primary backend");
});
