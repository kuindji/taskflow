import { useSyncExternalStore } from "react";
import { MSG } from "@taskflow/shared";
import type { ConnectivityStatusPayload } from "@taskflow/shared";
import { getPrimary, onEvent, sendRequest } from "@/lib/connection-registry";
import { registerBackendReset } from "@/stores/store-reset";

/** Primary's internet connectivity: the offline indicator is app-level. */
let online = true;
const listeners = new Set<() => void>();
/** Machines whose status has already been asked for. */
const initialized = new Set<string>();

registerBackendReset("connectivity", (backendId) => {
    initialized.delete(backendId);
});

function notify(): void {
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function getSnapshot(): boolean {
    return online;
}

function setOnline(value: boolean): void {
    if (online !== value) {
        online = value;
        notify();
    }
}

const _unsubConnectivityChanged = onEvent(MSG.CONNECTIVITY_STATUS_CHANGED, (payload, backendId) => {
    if (backendId !== getPrimary()) return;
    setOnline((payload as ConnectivityStatusPayload).online);
});

function initConnectivity(backendId: string): void {
    if (initialized.has(backendId)) return;
    initialized.add(backendId);

    sendRequest<ConnectivityStatusPayload>(backendId, MSG.CONNECTIVITY_STATUS).then(
        (payload) => {
            if (backendId === getPrimary()) setOnline(payload.online);
        },
        () => {
            // Backend may not support this yet — assume online
        },
    );
}

async function recheckConnectivity(): Promise<boolean> {
    const primary = getPrimary();
    if (!primary) throw new Error("Not connected to a backend");
    const payload = await sendRequest<ConnectivityStatusPayload>(primary, MSG.CONNECTIVITY_RECHECK);
    if (primary === getPrimary()) setOnline(payload.online);
    return payload.online;
}

function useConnectivity(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot);
}

export { useConnectivity, initConnectivity, recheckConnectivity };
