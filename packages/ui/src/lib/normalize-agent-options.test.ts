import { describe, expect, it } from "bun:test";
import type { AgentLaunchOptions } from "@taskflow/shared";
import { normalizeAgentOptions } from "./normalize-agent-options";

describe("normalizeAgentOptions Claude migrations", () => {
    it("maps a legacy dangerous toggle to bypassPermissions", () => {
        const legacy = {
            type: "claude",
            dangerouslySkipPermissions: true,
        } as unknown as AgentLaunchOptions;

        expect(normalizeAgentOptions("claude", legacy)).toEqual({
            type: "claude",
            permissionMode: "bypassPermissions",
            model: undefined,
            effort: undefined,
        });
    });

    it("prefers an explicit permission mode over the legacy toggle", () => {
        const legacy = {
            type: "claude",
            dangerouslySkipPermissions: true,
            permissionMode: "manual",
        } as unknown as AgentLaunchOptions;

        const normalized = normalizeAgentOptions("claude", legacy);
        expect(normalized?.type).toBe("claude");
        if (normalized?.type !== "claude") throw new Error("Expected Claude options");
        expect(normalized.permissionMode).toBe("manual");
    });
});

describe("normalizeAgentOptions legacy data tolerance", () => {
    it("drops options for removed agent types", () => {
        const legacy = {
            type: "gemini",
            approvalMode: "yolo",
        } as unknown as AgentLaunchOptions;

        expect(normalizeAgentOptions("gemini" as never, legacy)).toBeUndefined();
    });

    it("drops the retired opencode variant field from persisted options", () => {
        const legacy = {
            type: "opencode",
            model: "opencode/big-pickle",
            variant: "high",
        } as unknown as AgentLaunchOptions;

        expect(normalizeAgentOptions("opencode", legacy)).toEqual({
            type: "opencode",
            model: "opencode/big-pickle",
            autoApprove: undefined,
        });
    });
});
