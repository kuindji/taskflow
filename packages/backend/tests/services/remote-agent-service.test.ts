import { describe, expect, it } from "bun:test";
import type { CreateSessionOpts } from "../../src/services/session-lifecycle";
import { RemoteAgentService } from "../../src/services/remote-agent-service";

function createHarness(options?: { version?: string; permissionMode?: string }) {
    const created: CreateSessionOpts[] = [];
    const closed: string[] = [];
    const service = new RemoteAgentService({
        settingsStore: {
            get: async () => ({
                remoteAgent: {
                    autoStart: false,
                    appName: "Taskflow Test",
                    headless: true,
                    permissionMode: options?.permissionMode ?? "default",
                },
            }),
        } as never,
        ptyManager: {
            close: (sessionId: string) => closed.push(sessionId),
        } as never,
        sessionLifecycle: {
            createSession: async (opts) => {
                created.push(opts);
                return "remote-session";
            },
        },
        broadcast: () => {},
        agents: [
            {
                type: "claude",
                available: true,
                path: "/usr/local/bin/claude",
                version: options?.version ?? "2.1.206 (Claude Code)",
            },
        ],
        isOnline: () => true,
    });
    return { service, created, closed };
}

describe("RemoteAgentService", () => {
    it("starts Claude with native Remote Control and a safe inherited permission mode", async () => {
        const { service, created, closed } = createHarness();

        await service.start();

        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({
            type: "claude",
            sessionName: "Taskflow Test",
            remoteControl: true,
            internal: true,
            agentOptions: { type: "claude", permissionMode: undefined },
        });
        expect(created[0].prompt).toBeUndefined();

        await service.stop();
        expect(closed).toEqual(["remote-session"]);
    });

    it("passes the configured Remote Agent permission mode", async () => {
        const { service, created } = createHarness({ permissionMode: "manual" });

        await service.start();
        expect(created[0].agentOptions).toEqual({ type: "claude", permissionMode: "manual" });
        await service.stop();
    });

    it("rejects Claude versions without native Remote Control", async () => {
        const { service } = createHarness({ version: "2.1.50 (Claude Code)" });

        let error: unknown;
        try {
            await service.start();
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("2.1.51 or later");
    });
});
