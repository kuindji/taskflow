import { useEffect, useState, type ReactNode } from "react";
import { initConnectivity } from "../hooks/useConnectivity";
import { onPrimaryStatusChange, openConnection } from "../lib/connection-registry";
import { setPrimaryBackend, useBackendStore } from "../stores/backend-store";
import { WsContext } from "./ws-context";

const LOCAL_BACKEND_ID = "local";

/** The non-Electron dev renderer: one connection to `VITE_BACKEND_PORT`, no machines. */
async function connectDevRenderer(): Promise<void> {
    const rawPort: string | undefined = import.meta.env.VITE_BACKEND_PORT as string | undefined;
    if (!rawPort) {
        throw new Error("VITE_BACKEND_PORT must be set when running the renderer outside Electron");
    }
    const port = parseInt(rawPort, 10);
    if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`Invalid backend port: ${port}`);
    }
    setPrimaryBackend(LOCAL_BACKEND_ID);
    await openConnection(LOCAL_BACKEND_ID, `http://localhost:${port}`);
}

async function attachAll(taskflow: NonNullable<Window["taskflow"]>): Promise<void> {
    const store = useBackendStore.getState();
    // Primary first: the provider's status subscription follows it, and
    // subscribed on mount, before anything connected.
    setPrimaryBackend(LOCAL_BACKEND_ID);
    // Every known machine gets a row, local's included (from `getAttached()`).
    await store.refresh();
    const localId = await store.attach(LOCAL_BACKEND_ID);
    if (!localId) {
        const local = useBackendStore.getState().machines.find((m) => m.id === LOCAL_BACKEND_ID);
        throw new Error(local?.failure?.message ?? "Could not connect to the local backend");
    }
    initConnectivity(localId);
    // The persisted intent, not `getAttached()`: main no longer dials on its
    // own, so at launch it holds no tunnels. Each machine attaches on its own
    // and none blocks the render.
    for (const id of await taskflow.attachedRecordIds()) {
        void store.attach(id);
    }
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe = onPrimaryStatusChange((status) => {
            setConnected(status.connected);
            if (status.connected || status.reconnecting) {
                setError(null);
            }
        });

        async function connect() {
            try {
                setError(null);
                if (window.taskflow) {
                    await attachAll(window.taskflow);
                } else {
                    await connectDevRenderer();
                    initConnectivity(LOCAL_BACKEND_ID);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "Connection failed");
            }
        }
        void connect();

        return unsubscribe;
    }, []);

    return <WsContext.Provider value={{ connected, error }}>{children}</WsContext.Provider>;
}
