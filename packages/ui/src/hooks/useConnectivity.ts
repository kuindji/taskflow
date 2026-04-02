import { useSyncExternalStore } from "react";
import { MSG } from "@taskflow/shared";
import type { ConnectivityStatusPayload } from "@taskflow/shared";
import { sendRequest, onEvent } from "./useWebSocket";

let online = true;
const listeners = new Set<() => void>();
let initialized = false;

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

function initConnectivity(): void {
    if (initialized) return;
    initialized = true;

    sendRequest<ConnectivityStatusPayload>(MSG.CONNECTIVITY_STATUS).then(
        (payload) => setOnline(payload.online),
        () => {
            // Backend may not support this yet — assume online
        },
    );

    onEvent(MSG.CONNECTIVITY_STATUS_CHANGED, (payload) => {
        const data = payload as ConnectivityStatusPayload;
        setOnline(data.online);
    });
}

function useConnectivity(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot);
}

export { useConnectivity, initConnectivity };
