import { describe, expect, it } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { ActionDefinition } from "@taskflow/shared";
import type { NetLike } from "../net/client";
import { ActionRunner } from "./action-runner";

const base: ActionDefinition = {
    id: "action",
    name: "Action",
    prompt: "echo ok",
    sessionType: "shell",
    standalone: true,
    createdAt: "now",
    updatedAt: "now",
};

function setup() {
    const requests: Array<{ type: string; payload: unknown }> = [];
    const creates: unknown[] = [];
    const net: NetLike = {
        request: async <T>(type: string, payload?: unknown) => {
            requests.push({ type, payload });
            if (type === MSG.SHELLS_LIST) {
                return {
                    shells: [{ name: "zsh", path: "/bin/zsh" }],
                    systemShellPath: "/bin/zsh",
                } as T;
            }
            return { success: true } as T;
        },
        on: () => () => undefined,
        onStatusChange: () => () => undefined,
    };
    const runner = new ActionRunner(net, {
        create: async (_owner, payload) => {
            creates.push(payload);
            return "session-1";
        },
    });
    return { creates, requests, runner };
}

describe("ActionRunner", () => {
    it("creates an agent session with the action label, prompt, and options", async () => {
        const test = setup();
        await test.runner.run(
            { kind: "project", projectId: "p1" },
            {
                ...base,
                sessionType: "codex",
                agentOptions: { type: "codex", reasoningEffort: "high" },
            },
        );
        expect(test.creates).toEqual([
            {
                projectId: "p1",
                type: "codex",
                label: "Action",
                prompt: "echo ok",
                agentOptions: { type: "codex", reasoningEffort: "high" },
            },
        ]);
    });

    it("creates a shell and sends the prompt after creation", async () => {
        const test = setup();
        await test.runner.run({ kind: "master" }, base);
        expect(test.creates).toEqual([
            { master: true, type: "shell", label: "Action", shell: "/bin/zsh" },
        ]);
        expect(test.requests.at(-1)).toEqual({
            type: MSG.SESSION_INPUT,
            payload: { sessionId: "session-1", data: "echo ok\r" },
        });
    });

    it("rejects non-standalone actions before any request", async () => {
        const test = setup();
        // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test .rejects.toThrow() returns a Promise at runtime
        await expect(
            test.runner.run({ kind: "master" }, { ...base, standalone: false }),
        ).rejects.toThrow("standalone");
        expect(test.requests).toHaveLength(0);
        expect(test.creates).toHaveLength(0);
    });
});
