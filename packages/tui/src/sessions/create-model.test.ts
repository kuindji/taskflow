import { describe, expect, it } from "bun:test";
import type { AgentListResponse, AppSettings, ShellListResponse } from "@taskflow/shared";
import { buildSessionCreatePayload, buildSessionPickerItems } from "./create-model";

const agents: AgentListResponse = {
    agents: [
        { type: "claude", available: true, path: "/claude", version: "1" },
        { type: "codex", available: true, path: "/codex", version: "1" },
        { type: "opencode", available: false, path: "", version: "" },
        { type: "pi", available: true, path: "/pi", version: "1" },
        { type: "kimi", available: false, path: "", version: "" },
    ],
};
const shells: ShellListResponse = {
    shells: [
        { name: "zsh", path: "/bin/zsh" },
        { name: "bash", path: "/bin/bash" },
    ],
    systemShellPath: "/bin/zsh",
};
const settings = {
    general: { defaultAgent: "codex" },
    terminal: { defaultShell: "system" },
    claude: { defaultModel: "default", defaultEffort: "default", permissionMode: "default" },
    codex: {
        defaultModel: "gpt-5",
        defaultReasoningEffort: "high",
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        dangerouslyBypassApprovalsAndSandbox: false,
    },
    opencode: { defaultModel: "", autoApprove: false },
    pi: { defaultModel: "", thinking: "off", tools: "" },
    kimi: { defaultModel: "", permissionMode: "manual" },
} as unknown as AppSettings;

describe("session creation model", () => {
    it("puts the available default agent first and marks the resolved default shell", () => {
        expect(buildSessionPickerItems(agents, shells, settings)).toEqual([
            {
                kind: "agent",
                type: "codex",
                label: "Codex",
                isDefault: true,
                agentOptions: {
                    type: "codex",
                    model: "gpt-5",
                    reasoningEffort: "high",
                    sandbox: "workspace-write",
                    approvalPolicy: "on-request",
                    dangerouslyBypassApprovalsAndSandbox: false,
                },
            },
            {
                kind: "agent",
                type: "claude",
                label: "Claude",
                isDefault: false,
                agentOptions: { type: "claude" },
            },
            {
                kind: "agent",
                type: "pi",
                label: "Pi",
                isDefault: false,
                agentOptions: { type: "pi", thinking: "off" },
            },
            { kind: "shell", type: "shell", label: "zsh", path: "/bin/zsh", isDefault: true },
            { kind: "shell", type: "shell", label: "bash", path: "/bin/bash", isDefault: false },
        ]);
    });

    it("starts a clean task agent with current default options", () => {
        const payload = buildSessionCreatePayload({
            owner: { kind: "task", taskId: "t", projectId: "p" },
            item: {
                kind: "agent",
                type: "codex",
                label: "Codex",
                isDefault: true,
                agentOptions: {
                    type: "codex",
                    model: "gpt-5",
                    reasoningEffort: "high",
                    sandbox: "workspace-write",
                    approvalPolicy: "on-request",
                    dangerouslyBypassApprovalsAndSandbox: false,
                },
            },
            cols: 90,
            rows: 30,
        });
        expect(payload).toEqual({
            taskId: "t",
            type: "codex",
            agentOptions: {
                type: "codex",
                model: "gpt-5",
                reasoningEffort: "high",
                sandbox: "workspace-write",
                approvalPolicy: "on-request",
                dangerouslyBypassApprovalsAndSandbox: false,
            },
            cols: 90,
            rows: 30,
        });
    });

    it("sends a full shell path and never infers prompts for master or project", () => {
        expect(
            buildSessionCreatePayload({
                owner: { kind: "master" },
                item: {
                    kind: "shell",
                    type: "shell",
                    label: "zsh",
                    path: "/bin/zsh",
                    isDefault: true,
                },
                cols: 80,
                rows: 24,
            }),
        ).toEqual({ master: true, type: "shell", shell: "/bin/zsh", cols: 80, rows: 24 });
    });
});
