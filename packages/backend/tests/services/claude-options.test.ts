import { describe, expect, it } from "bun:test";
import { normalizeClaudeLaunchOptions } from "../../src/services/claude-options";

describe("normalizeClaudeLaunchOptions", () => {
    it("migrates the legacy dangerous toggle to bypassPermissions", () => {
        expect(
            normalizeClaudeLaunchOptions({
                type: "claude",
                dangerouslySkipPermissions: true,
            }),
        ).toEqual({ type: "claude", permissionMode: "bypassPermissions" });
    });

    it("lets an explicit permission mode override the legacy dangerous toggle", () => {
        expect(
            normalizeClaudeLaunchOptions({
                type: "claude",
                dangerouslySkipPermissions: true,
                permissionMode: "manual",
            }),
        ).toEqual({ type: "claude", permissionMode: "manual" });
    });

    it("treats the legacy default sentinel as inheritance", () => {
        expect(normalizeClaudeLaunchOptions({ type: "claude", permissionMode: "default" })).toEqual(
            {
                type: "claude",
            },
        );
    });

    it("accepts manual mode and ultracode effort", () => {
        expect(
            normalizeClaudeLaunchOptions({
                type: "claude",
                permissionMode: "manual",
                effort: "ultracode",
                model: " opus ",
            }),
        ).toEqual({
            type: "claude",
            permissionMode: "manual",
            effort: "ultracode",
            model: "opus",
        });
    });

    it("rejects invalid or incorrectly typed permission values", () => {
        expect(() =>
            normalizeClaudeLaunchOptions({ type: "claude", permissionMode: "reckless" }),
        ).toThrow("permissionMode");
        expect(() =>
            normalizeClaudeLaunchOptions({
                type: "claude",
                dangerouslySkipPermissions: "false",
            }),
        ).toThrow("dangerouslySkipPermissions");
    });

    it("rejects invalid effort and model values", () => {
        expect(() => normalizeClaudeLaunchOptions({ type: "claude", effort: "turbo" })).toThrow(
            "effort",
        );
        expect(() => normalizeClaudeLaunchOptions({ type: "claude", model: 42 })).toThrow("model");
    });
});
