import { useBackendStore, type MachineState } from "@/stores/backend-store";

/**
 * With no machine rows at all (the dev renderer, which attaches nothing) the
 * one backend is this machine. For code outside React; components use the hook.
 */
export function isLocalBackend(machines: MachineState[], backendId: string | null): boolean {
    if (!backendId) return false;
    const machine = machines.find((m) => m.id === backendId);
    return machine ? machine.isLocal : machines.length === 0;
}

/**
 * Is this backend this machine? Gates every affordance that assumes the
 * backend's filesystem is the one the native file dialogs see.
 */
export function useIsLocalBackend(backendId: string | null): boolean {
    const machines = useBackendStore((s) => s.machines);
    return isLocalBackend(machines, backendId);
}

/** Appended to a disabled menu item's label: a disabled item shows no tooltip. */
export const LOCAL_ONLY_SUFFIX = " (not on this machine)";

/**
 * Why a local-path affordance is disabled for this backend, naming its
 * machine; null when it is this machine. Shown as the disabled control's tooltip.
 */
export function useLocalOnlyHint(backendId: string | null): string | null {
    const isLocal = useIsLocalBackend(backendId);
    const name = useBackendStore(
        (s) => s.machines.find((m) => m.id === backendId)?.displayName ?? null,
    );
    if (isLocal) return null;
    return name
        ? `Not available: these files are on ${name}`
        : "Not available: these files are on another machine";
}
