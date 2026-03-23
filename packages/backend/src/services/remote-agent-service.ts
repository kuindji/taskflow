import { hostname, networkInterfaces } from "os";
import { MSG } from "@taskflow/shared";
import type { AgentAvailability, RemoteAgentStatusPayload, WsEvent } from "@taskflow/shared";
import type { SettingsStore } from "./settings-store";
import type { PtyManager } from "./pty-manager";
import type { CreateSessionOpts } from "./session-lifecycle";

const RESTART_DELAY_MS = 2000;

const REMOTE_AGENT_SYSTEM_PROMPT = `
You are a remote control agent for the Taskflow application. Your role is to receive instructions from a remote operator and execute them using the taskflow-cli tool.`;

interface RemoteAgentServiceDeps {
    settingsStore: SettingsStore;
    ptyManager: PtyManager;
    sessionLifecycle: {
        createSession: (opts: CreateSessionOpts) => Promise<string>;
    };
    broadcast: (event: WsEvent) => void;
    agents: AgentAvailability[];
}

class RemoteAgentService {
    private currentSessionId: string | null = null;
    private explicitlyStopped = false;
    private restartTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly deps: RemoteAgentServiceDeps;

    constructor(deps: RemoteAgentServiceDeps) {
        this.deps = deps;
    }

    get running(): boolean {
        return this.currentSessionId !== null;
    }

    getStatus(): RemoteAgentStatusPayload {
        return {
            running: this.running,
            sessionId: this.currentSessionId ?? undefined,
        };
    }

    async getAppName(): Promise<string> {
        const settings = await this.deps.settingsStore.get();
        if (settings.remoteAgent.appName) {
            return settings.remoteAgent.appName;
        }
        const host = hostname();
        const ip = getLocalIpAddress();
        return ip ? `Taskflow (${host} / ${ip})` : `Taskflow (${host})`;
    }

    async start(): Promise<RemoteAgentStatusPayload> {
        if (this.currentSessionId) {
            return this.getStatus();
        }

        if (!this.isClaudeAvailable()) {
            throw new Error("Claude is not available");
        }

        this.explicitlyStopped = false;
        this.clearRestartTimer();

        const settings = await this.deps.settingsStore.get();
        const appName = await this.getAppName();

        const sessionId = await this.deps.sessionLifecycle.createSession({
            owner: { master: true },
            type: "claude",
            label: "Remote Agent",
            sessionName: appName,
            agentOptions: {
                type: "claude",
                fullAccess: true,
                dontAskQuestions: true,
            },
            systemPrompt: REMOTE_AGENT_SYSTEM_PROMPT,
            internal: settings.remoteAgent.headless,
            onSessionExited: (_sessionId, _exitCode) => {
                this.handleSessionExit();
            },
        });

        this.currentSessionId = sessionId;
        this.broadcastStatus();
        return this.getStatus();
    }

    async stop(): Promise<RemoteAgentStatusPayload> {
        this.explicitlyStopped = true;
        this.clearRestartTimer();

        if (this.currentSessionId) {
            try {
                this.deps.ptyManager.close(this.currentSessionId);
            } catch {
                // Session may already be gone
            }
            this.currentSessionId = null;
        }

        this.broadcastStatus();
        return this.getStatus();
    }

    async autoStartIfEnabled(): Promise<void> {
        if (!this.isClaudeAvailable()) return;

        const settings = await this.deps.settingsStore.get();
        if (settings.remoteAgent.autoStart) {
            try {
                await this.start();
            } catch (err) {
                console.error("[remote-agent] Auto-start failed:", err);
            }
        }
    }

    private isClaudeAvailable(): boolean {
        return this.deps.agents.some((a) => a.type === "claude" && a.available);
    }

    private handleSessionExit(): void {
        this.currentSessionId = null;
        this.broadcastStatus();

        if (this.explicitlyStopped) return;

        // Auto-restart if not explicitly stopped
        void this.deps.settingsStore.get().then((settings) => {
            if (settings.remoteAgent.autoStart && !this.explicitlyStopped) {
                this.scheduleRestart();
            }
        });
    }

    private scheduleRestart(): void {
        this.clearRestartTimer();
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            void this.start().catch((err) => {
                console.error("[remote-agent] Restart failed:", err);
            });
        }, RESTART_DELAY_MS);
    }

    private clearRestartTimer(): void {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
    }

    private broadcastStatus(): void {
        this.deps.broadcast({
            type: MSG.REMOTE_AGENT_STATUS_CHANGED,
            payload: this.getStatus(),
        });
    }
}

function getLocalIpAddress(): string | null {
    const interfaces = networkInterfaces();
    for (const entries of Object.values(interfaces)) {
        if (!entries) continue;
        for (const entry of entries) {
            if (entry.family === "IPv4" && !entry.internal) {
                return entry.address;
            }
        }
    }
    return null;
}

export { RemoteAgentService };
export type { RemoteAgentServiceDeps };
