import { createContext, useContext } from "react";

interface WsContextValue {
    connected: boolean;
    error: string | null;
}

export const WsContext = createContext<WsContextValue>({ connected: false, error: null });

export function useWsStatus() {
    return useContext(WsContext);
}
