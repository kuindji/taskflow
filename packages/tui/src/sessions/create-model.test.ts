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
} as AppSettings;

describe("session creation model", () => {
    it("puts the available default agent first and marks the resolved default shell", () => {
        expect(buildSessionPickerItems(agents, shells, settings)).toEqual([
            { kind: "agent", type: "codex", label: "Codex", isDefault: true },
            { kind: "agent", type: "claude", label: "Claude", isDefault: false },
            { kind: "agent", type: "pi", label: "Pi", isDefault: false },
            { kind: "shell", type: "shell", label: "zsh", path: "/bin/zsh", isDefault: true },
            { kind: "shell", type: "shell", label: "bash", path: "/bin/bash", isDefault: false },
        ]);
    });

    it("sends one task owner, agent prompt, and pane dimensions without agent options", () => {
        const payload = buildSessionCreatePayload({
            owner: { kind: "task", taskId: "t", projectId: "p" },
            item: { kind: "agent", type: "codex", label: "Codex", isDefault: true },
            cols: 90,
            rows: 30,
            taskDescription: "Do the work",
        });
        expect(payload).toEqual({
            taskId: "t",
            type: "codex",
            prompt: "Do the work",
            cols: 90,
            rows: 30,
        });
        expect("agentOptions" in payload).toBe(false);
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
                taskDescription: "ignored",
            }),
        ).toEqual({ master: true, type: "shell", shell: "/bin/zsh", cols: 80, rows: 24 });
    });
});
