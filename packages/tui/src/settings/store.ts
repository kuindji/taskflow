import {
    AGENT_DISPLAY_NAMES,
    MSG,
    type AgentListResponse,
    type AppSettings,
    type CodexModelsResponse,
    type KimiModelsResponse,
    type OpenCodeModelsResponse,
    type PiModelsResponse,
    type RuntimeListResponse,
    type SettingsUpdatePayload,
    type ShellListResponse,
    type SystemInfo,
} from "@taskflow/shared";
import type { NetLike } from "../net/client";

interface Choice {
    value: string;
    label: string;
}

interface SettingsChoices {
    agents: Choice[];
    runtimes: Choice[];
    shells: Choice[];
    editors: Choice[];
    models: {
        codex: Choice[];
        opencode: Choice[];
        pi: Choice[];
        kimi: Choice[];
    };
    systemInfo: SystemInfo | null;
}

const EMPTY_CHOICES: SettingsChoices = {
    agents: [],
    runtimes: [],
    shells: [],
    editors: [],
    models: { codex: [], opencode: [], pi: [], kimi: [] },
    systemInfo: null,
};

class SettingsStore {
    private settingsSnapshot: AppSettings | null = null;
    private choiceSnapshot: SettingsChoices = EMPTY_CHOICES;
    private loadToken = 0;
    private disposed = false;
    private readonly listeners = new Set<() => void>();

    constructor(private readonly net: NetLike) {}

    get settings(): AppSettings | null {
        return this.settingsSnapshot;
    }

    get choices(): SettingsChoices {
        return this.choiceSnapshot;
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        if (this.disposed) return;
        for (const listener of [...this.listeners]) listener();
    }

    async loadSettings(): Promise<void> {
        const token = ++this.loadToken;
        const [settings, systemInfo] = await Promise.all([
            this.net.request<AppSettings>(MSG.SETTINGS_GET),
            this.net.request<SystemInfo>(MSG.SYSTEM_INFO),
        ]);
        if (this.disposed || token !== this.loadToken) return;
        this.settingsSnapshot = settings;
        this.choiceSnapshot = {
            ...this.choiceSnapshot,
            editors: [
                { value: "system", label: "System default" },
                ...systemInfo.editors
                    .filter((editor) => editor.type === "external")
                    .map((editor) => ({ value: editor.id, label: editor.name })),
            ],
            systemInfo,
        };
        this.notify();
    }

    editorCommand(): string | null {
        const configured = this.settingsSnapshot?.editor.externalEditor;
        if (!configured || configured === "system") return null;
        const editor = this.choiceSnapshot.systemInfo?.editors.find(
            (candidate) => candidate.id === configured && candidate.type === "external",
        );
        if (!editor) return null;
        return [editor.command, ...(editor.extraArgs ?? [])]
            .map((part) => JSON.stringify(part))
            .join(" ");
    }

    async load(): Promise<void> {
        const token = ++this.loadToken;
        const [settings, agents, runtimes, shells, systemInfo, modelResults] = await Promise.all([
            this.net.request<AppSettings>(MSG.SETTINGS_GET),
            this.net.request<AgentListResponse>(MSG.AGENTS_LIST),
            this.net.request<RuntimeListResponse>(MSG.RUNTIMES_LIST),
            this.net.request<ShellListResponse>(MSG.SHELLS_LIST),
            this.net.request<SystemInfo>(MSG.SYSTEM_INFO),
            Promise.allSettled([
                this.net.request<CodexModelsResponse>(MSG.CODEX_MODELS),
                this.net.request<OpenCodeModelsResponse>(MSG.OPENCODE_MODELS),
                this.net.request<PiModelsResponse>(MSG.PI_MODELS),
                this.net.request<KimiModelsResponse>(MSG.KIMI_MODELS),
            ]),
        ]);
        if (this.disposed || token !== this.loadToken) return;
        const modelValue = (index: number): unknown => {
            const result = modelResults[index];
            return result?.status === "fulfilled" ? result.value : null;
        };
        const codex = modelValue(0) as CodexModelsResponse | null;
        const opencode = modelValue(1) as OpenCodeModelsResponse | null;
        const pi = modelValue(2) as PiModelsResponse | null;
        const kimi = modelValue(3) as KimiModelsResponse | null;
        this.settingsSnapshot = settings;
        this.choiceSnapshot = {
            agents: agents.agents
                .filter((agent) => agent.available)
                .map((agent) => ({ value: agent.type, label: AGENT_DISPLAY_NAMES[agent.type] })),
            runtimes: runtimes.runtimes.map((runtime) => ({
                value: runtime.name,
                label: `${runtime.name} ${runtime.version}`.trim(),
            })),
            shells: [
                { value: "system", label: "System default" },
                ...shells.shells.map((shell) => ({ value: shell.path, label: shell.name })),
            ],
            editors: [
                { value: "system", label: "System default" },
                ...systemInfo.editors
                    .filter((editor) => editor.type === "external")
                    .map((editor) => ({ value: editor.id, label: editor.name })),
            ],
            models: {
                codex:
                    codex?.models
                        .filter((model) => !model.hidden)
                        .map((model) => ({ value: model.model, label: model.displayName })) ?? [],
                opencode:
                    opencode?.models.map((model) => ({
                        value: model.id,
                        label: `${model.provider}/${model.id}`,
                    })) ?? [],
                pi:
                    pi?.models.map((model) => ({
                        value: `${model.provider}/${model.id}`,
                        label: `${model.provider}/${model.id}`,
                    })) ?? [],
                kimi:
                    kimi?.models.map((model) => ({
                        value: model.id,
                        label: model.displayName,
                    })) ?? [],
            },
            systemInfo,
        };
        this.notify();
    }

    async update(partial: SettingsUpdatePayload): Promise<AppSettings> {
        const settings = await this.net.request<AppSettings>(MSG.SETTINGS_UPDATE, partial);
        if (this.disposed) return settings;
        this.settingsSnapshot = settings;
        this.notify();
        return settings;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.loadToken++;
        this.listeners.clear();
    }
}

export { EMPTY_CHOICES, SettingsStore };
export type { Choice, SettingsChoices };
