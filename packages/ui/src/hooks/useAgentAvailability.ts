import { useState, useEffect } from "react";
import { MSG } from "@taskflow/shared";
import type { AgentAvailability, AgentListResponse, AgentType } from "@taskflow/shared";
import { sendRequest, onStatusChange } from "./useWebSocket";

const emptyAgents: AgentAvailability[] = [];

let cachedAgents: AgentAvailability[] | null = null;
let fetchPromise: Promise<AgentAvailability[]> | null = null;

function clearAgentCache(): void {
    cachedAgents = null;
    fetchPromise = null;
}

onStatusChange((status) => {
    if (!status.connected) {
        clearAgentCache();
    }
});

function fetchAgents(): Promise<AgentAvailability[]> {
    if (cachedAgents) return Promise.resolve(cachedAgents);
    if (fetchPromise) return fetchPromise;
    fetchPromise = sendRequest<AgentListResponse>(MSG.AGENTS_LIST, {})
        .then((res) => {
            cachedAgents = res.agents;
            fetchPromise = null;
            return cachedAgents;
        })
        .catch(() => {
            fetchPromise = null;
            return emptyAgents;
        });
    return fetchPromise;
}

export function useAgentAvailability(): AgentAvailability[] {
    const [agents, setAgents] = useState<AgentAvailability[]>(cachedAgents ?? emptyAgents);

    useEffect(() => {
        void fetchAgents().then(setAgents);
    }, []);

    return agents;
}

export function isAgentAvailable(agents: AgentAvailability[], type: AgentType): boolean {
    const agent = agents.find((a) => a.type === type);
    return agent?.available ?? true;
}
