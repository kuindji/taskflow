import { useState, useEffect } from "react";
import { MSG } from "@taskflow/shared";
import type {
    OpenCodeModelInfo,
    OpenCodeAgentInfo,
    OpenCodeModelsResponse,
    OpenCodeAgentsResponse,
} from "@taskflow/shared";
import { sendRequest, onStatusChange } from "./useWebSocket";

let cachedModels: OpenCodeModelInfo[] | null = null;
let cachedAgents: OpenCodeAgentInfo[] | null = null;
let modelFetchPromise: Promise<OpenCodeModelInfo[]> | null = null;
let agentFetchPromise: Promise<OpenCodeAgentInfo[]> | null = null;

onStatusChange((status) => {
    if (!status.connected) {
        cachedModels = null;
        cachedAgents = null;
        modelFetchPromise = null;
        agentFetchPromise = null;
    }
});

function fetchModels(): Promise<OpenCodeModelInfo[]> {
    if (cachedModels) return Promise.resolve(cachedModels);
    if (modelFetchPromise) return modelFetchPromise;
    modelFetchPromise = sendRequest<OpenCodeModelsResponse>(MSG.OPENCODE_MODELS, {})
        .then((res) => {
            cachedModels = res.models;
            modelFetchPromise = null;
            return cachedModels;
        })
        .catch(() => {
            modelFetchPromise = null;
            return [];
        });
    return modelFetchPromise;
}

function fetchAgents(): Promise<OpenCodeAgentInfo[]> {
    if (cachedAgents) return Promise.resolve(cachedAgents);
    if (agentFetchPromise) return agentFetchPromise;
    agentFetchPromise = sendRequest<OpenCodeAgentsResponse>(MSG.OPENCODE_AGENTS, {})
        .then((res) => {
            cachedAgents = res.agents;
            agentFetchPromise = null;
            return cachedAgents;
        })
        .catch(() => {
            agentFetchPromise = null;
            return [];
        });
    return agentFetchPromise;
}

function useOpenCodeModels(enabled = true): OpenCodeModelInfo[] | null {
    const [models, setModels] = useState<OpenCodeModelInfo[] | null>(cachedModels);

    useEffect(() => {
        if (!enabled) return;
        void fetchModels().then(setModels);
    }, [enabled]);

    return enabled ? models : null;
}

function useOpenCodeAgents(enabled = true): OpenCodeAgentInfo[] | null {
    const [agents, setAgents] = useState<OpenCodeAgentInfo[] | null>(cachedAgents);

    useEffect(() => {
        if (!enabled) return;
        void fetchAgents().then(setAgents);
    }, [enabled]);

    return enabled ? agents : null;
}

export { useOpenCodeModels, useOpenCodeAgents };
