import { useState, useEffect } from "react";
import { MSG } from "@taskflow/shared";
import type { AgentAvailability, AgentListResponse, AgentType } from "@taskflow/shared";
import { onBackendReady } from "@/lib/backend-ready";
import { sendRequest } from "@/lib/connection-registry";
import { createPerBackendCache } from "@/lib/per-backend-cache";

const emptyAgents: AgentAvailability[] = [];

const agentCache = createPerBackendCache(
    (backendId) =>
        sendRequest<AgentListResponse>(backendId, MSG.AGENTS_LIST, {}).then((res) => res.agents),
    "agent-cache",
);

// A backend detects its agents once, at startup, so a machine coming back may
// be a restarted backend with a different list. Registered at import, before
// any hook's ready handler, so the hooks below read the fresh list.
onBackendReady((backendId) => agentCache.invalidate(backendId));

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
        const read = () =>
            agentCache.get(backendId).then(
                (next) => {
                    if (!cancelled) setAgents(next);
                },
                () => {
                    if (!cancelled) setAgents(emptyAgents);
                },
            );
        void read();
        const offReady = onBackendReady((readyId) => {
            if (readyId === backendId) void read();
        });
        return () => {
            cancelled = true;
            offReady();
        };
    }, [backendId]);

    return agents;
}

export function isAgentAvailable(agents: AgentAvailability[], type: AgentType): boolean {
    const agent = agents.find((a) => a.type === type);
    return agent?.available ?? true;
}
