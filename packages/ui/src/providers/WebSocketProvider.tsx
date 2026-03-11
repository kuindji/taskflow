import { useEffect, useState, type ReactNode } from "react";
import { connectWebSocket, onStatusChange } from "../hooks/useWebSocket";
import { WsContext } from "./ws-context";

export function WebSocketProvider({ children }: { children: ReactNode }) {
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe = onStatusChange((status) => {
            setConnected(status.connected);
            if (status.connected || status.reconnecting) {
                setError(null);
            }
        });

        async function connect() {
            try {
                setError(null);
                let port: number;
                if (window.taskflow) {
                    port = await window.taskflow.getBackendPort();
                } else {
                    const rawPort: string | undefined = import.meta.env.VITE_BACKEND_PORT as
                        | string
                        | undefined;
                    if (!rawPort) {
                        throw new Error(
                            "VITE_BACKEND_PORT must be set when running the renderer outside Electron",
                        );
                    }
                    port = parseInt(rawPort, 10);
                }
                if (!Number.isInteger(port) || port <= 0) {
                    throw new Error(`Invalid backend port: ${port}`);
                }
                await connectWebSocket(port);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Connection failed");
            }
        }
        void connect();

        return unsubscribe;
    }, []);

    return <WsContext.Provider value={{ connected, error }}>{children}</WsContext.Provider>;
}
