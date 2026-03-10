import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { connectWebSocket, onStatusChange } from '../hooks/useWebSocket';

interface WsContextValue { connected: boolean; error: string | null; }
const WsContext = createContext<WsContextValue>({ connected: false, error: null });
export function useWsStatus() { return useContext(WsContext); }

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
          const rawPort = import.meta.env.VITE_BACKEND_PORT;
          if (!rawPort) {
            throw new Error('VITE_BACKEND_PORT must be set when running the renderer outside Electron');
          }
          port = parseInt(rawPort, 10);
        }
        if (!Number.isInteger(port) || port <= 0) {
          throw new Error(`Invalid backend port: ${port}`);
        }
        await connectWebSocket(port);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Connection failed');
      }
    }
    connect();

    return unsubscribe;
  }, []);

  return <WsContext.Provider value={{ connected, error }}>{children}</WsContext.Provider>;
}
