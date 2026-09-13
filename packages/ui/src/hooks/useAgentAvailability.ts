import { useState, useEffect } from "react";
import { MSG } from "@taskflow/shared";
import type { AgentAvailability, AgentListResponse, AgentType } from "@taskflow/shared";
import { sendRequest } from "@/lib/connection-registry";
import { createPerBackendCache } from "@/lib/per-backend-cache";

const emptyAgents: AgentAvailability[] = [];

const agentCache = createPerBackendCache(
    (backendId) =>
        sendRequest<AgentListResponse>(backendId, MSG.AGENTS_LIST, {}).then((res) => res.agents),
    "agent-cache",
);

/** The agents installed on `backendId`, the machine that would run them. */
export function useAgentAvailability(backendId: string | null): AgentAvailability[] {
    const [agents, setAgents] = useState<AgentAvailability[]>(
        () => (backendId ? agentCache.peek(backendId) : null) ?? emptyAgents,
    );

    useEffect(() => {
        if (!backendId) {
            setAgents(emptyAgents);
            return;
        }
        let cancelled = false;
        setAgents(agentCache.peek(backendId) ?? emptyAgents);
        agentCache.get(backendId).then(
            (next) => {
                if (!cancelled) setAgents(next);
            },
            () => {
                if (!cancelled) setAgents(emptyAgents);
            },
        );
        return () => {
            cancelled = true;
        };
    }, [backendId]);

    return agents;
}

export function isAgentAvailable(agents: AgentAvailability[], type: AgentType): boolean {
    const agent = agents.find((a) => a.type === type);
    return agent?.available ?? true;
}
