/**
 * Per-backend teardown. A reset MUST drop only the named backend's state: in
 * aggregate mode a reset that clears everything looks correct until a second
 * machine is attached, and then quietly wipes it.
 */
type BackendReset = (backendId: string) => void;

const resets = new Map<string, BackendReset>();

export function registerBackendReset(name: string, reset: BackendReset): void {
    resets.set(name, reset);
}

export function resetBackend(backendId: string): void {
    for (const reset of resets.values()) reset(backendId);
}

export function registeredResetNames(): string[] {
    return [...resets.keys()];
}
