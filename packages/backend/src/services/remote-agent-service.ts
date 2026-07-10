import { hostname, networkInterfaces } from "os";
import { MSG } from "@taskflow/shared";
import { isVersionAtLeast } from "@taskflow/shared";
import type { AgentAvailability, RemoteAgentStatusPayload, WsEvent } from "@taskflow/shared";
import type { SettingsStore } from "./settings-store";
import type { PtyManager } from "./pty-manager";
import type { CreateSessionOpts } from "./session-lifecycle";

const RESTART_BASE_DELAY_MS = 2000;
const RESTART_MAX_DELAY_MS = 60_000;
const STABLE_SESSION_MS = 60_000;

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
    isOnline: () => boolean;
}

class RemoteAgentService {
    private currentSessionId: string | null = null;
    private explicitlyStopped = false;
    private restartTimer: ReturnType<typeof setTimeout> | null = null;
    private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
    private restartAttempts = 0;

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

        this.assertClaudeRemoteControlAvailable();
        if (!this.deps.isOnline()) {
            throw new Error("Cannot start remote agent while offline");
        }

        this.explicitlyStopped = false;
        this.restartAttempts = 0;
        this.clearRestartTimer();
        this.clearStabilityTimer();

        return this.startSession();
    }

    private async startSession(): Promise<RemoteAgentStatusPayload> {
        this.assertClaudeRemoteControlAvailable();
        if (!this.deps.isOnline()) {
            throw new Error("Cannot start remote agent while offline");
        }

        const settings = await this.deps.settingsStore.get();
        const appName = await this.getAppName();

        const sessionId = await this.deps.sessionLifecycle.createSession({
            owner: { master: true },
            type: "claude",
            label: "Remote Agent",
            sessionName: appName,
            agentOptions: {
                type: "claude",
                permissionMode:
                    settings.remoteAgent.permissionMode === "default"
                        ? undefined
                        : settings.remoteAgent.permissionMode,
            },
            systemPrompt: REMOTE_AGENT_SYSTEM_PROMPT,
            remoteControl: true,
            internal: settings.remoteAgent.headless,
            trayExclude: true,
            onSessionExited: (_sessionId, _exitCode) => {
                this.handleSessionExit();
            },
        });

        this.currentSessionId = sessionId;
        this.scheduleStabilityReset();
        this.broadcastStatus();
        return this.getStatus();
    }

    async stop(): Promise<RemoteAgentStatusPayload> {
        this.explicitlyStopped = true;
        this.clearRestartTimer();
        this.clearStabilityTimer();
        this.restartAttempts = 0;

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
        if (!this.deps.isOnline()) return;
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

    private getClaudeAgent(): AgentAvailability | undefined {
        return this.deps.agents.find((agent) => agent.type === "claude");
    }

    private isClaudeAvailable(): boolean {
        return this.getClaudeAgent()?.available ?? false;
    }

    private assertClaudeRemoteControlAvailable(): void {
        const claude = this.getClaudeAgent();
        if (!claude?.available) throw new Error("Claude is not available");
        if (claude.version && !isVersionAtLeast(claude.version, [2, 1, 51])) {
            throw new Error("Claude Remote Control requires Claude Code 2.1.51 or later");
        }
    }

    async retryAutoStartIfEnabled(): Promise<void> {
        if (this.explicitlyStopped) return;
        await this.autoStartIfEnabled();
    }

    private handleSessionExit(): void {
        this.currentSessionId = null;
        this.clearStabilityTimer();
        this.broadcastStatus();

        if (this.explicitlyStopped) return;

        // Auto-restart if not explicitly stopped and online
        if (!this.deps.isOnline()) return;

        void this.deps.settingsStore
            .get()
            .then((settings) => {
                if (settings.remoteAgent.autoStart && !this.explicitlyStopped) {
                    this.scheduleRestart();
                }
            })
            .catch((err: unknown) => {
                console.error("[remote-agent] Failed to read settings after session exit:", err);
            });
    }

    private scheduleRestart(): void {
        if (this.restartTimer || this.explicitlyStopped || !this.deps.isOnline()) return;
        const delay = Math.min(
            RESTART_BASE_DELAY_MS * Math.pow(2, this.restartAttempts),
            RESTART_MAX_DELAY_MS,
        );
        this.restartAttempts += 1;
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            void this.startSession().catch((err: unknown) => {
                console.error("[remote-agent] Restart failed:", err);
                void this.deps.settingsStore
                    .get()
                    .then((settings) => {
                        if (settings.remoteAgent.autoStart) this.scheduleRestart();
                    })
                    .catch((settingsError: unknown) => {
                        console.error(
                            "[remote-agent] Failed to read settings before retry:",
                            settingsError,
                        );
                    });
            });
        }, delay);
    }

    private scheduleStabilityReset(): void {
        this.clearStabilityTimer();
        this.stabilityTimer = setTimeout(() => {
            this.stabilityTimer = null;
            this.restartAttempts = 0;
        }, STABLE_SESSION_MS);
    }

    private clearRestartTimer(): void {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
    }

    private clearStabilityTimer(): void {
        if (this.stabilityTimer) {
            clearTimeout(this.stabilityTimer);
            this.stabilityTimer = null;
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
