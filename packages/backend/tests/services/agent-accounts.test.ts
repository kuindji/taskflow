import { describe, expect, it } from "bun:test";
import { homedir } from "os";
import { join } from "path";
import type { AppSettings, Project } from "@taskflow/shared";
import {
    headlessClaudeEnv,
    headlessAgentEnv,
    inheritedAgentHome,
    mergeProjectAgentAccounts,
    resolveAgentAccount,
    resumeAccountOverride,
    accountEnv,
} from "../../src/services/agent-accounts";

function settingsWith(overrides: { claudeDefault?: string; codexDefault?: string }): AppSettings {
    return {
        claude: {
            defaultModel: "default",
            defaultEffort: "default",
            permissionMode: "default",
            accounts: [
                { id: "c-work", name: "work", homeDir: "/homes/claude-work" },
                { id: "c-alt", name: "alt", homeDir: "/homes/claude-alt" },
            ],
            defaultAccount: overrides.claudeDefault ?? "default",
        },
        codex: {
            defaultModel: "",
            defaultReasoningEffort: "default",
            sandbox: "workspace-write",
            approvalPolicy: "on-request",
            dangerouslyBypassApprovalsAndSandbox: false,
            accounts: [{ id: "x-work", name: "work", homeDir: "/homes/codex-work" }],
            defaultAccount: overrides.codexDefault ?? "default",
        },
    } as AppSettings;
}

function projectWith(agentAccounts?: Project["agentAccounts"]): Project {
    return {
        id: "p1",
        name: "p",
        path: "/p",
        sessions: [],
        attributes: [],
        createdAt: "",
        ...(agentAccounts && { agentAccounts }),
    };
}

const emptyEnv = {};

describe("resolveAgentAccount", () => {
    it("uses the built-in account when nothing is configured", () => {
        expect(resolveAgentAccount("claude", undefined, null, settingsWith({}), emptyEnv)).toEqual({
            accountId: "default",
            accountName: null,
            override: null,
            effectiveHomeDir: join(homedir(), ".claude"),
        });
    });

    it("treats an inherited env var as the built-in account's home", () => {
        const resolved = resolveAgentAccount("codex", undefined, null, settingsWith({}), {
            CODEX_HOME: "/inherited/codex",
        });
        expect(resolved.override).toBeNull();
        expect(resolved.effectiveHomeDir).toBe("/inherited/codex");
    });

    it("prefers options over project over global default", () => {
        const settings = settingsWith({ claudeDefault: "c-alt" });
        const project = projectWith({ claude: "c-work" });
        expect(resolveAgentAccount("claude", undefined, null, settings, emptyEnv).accountId).toBe(
            "c-alt",
        );
        expect(
            resolveAgentAccount("claude", undefined, project, settings, emptyEnv).accountId,
        ).toBe("c-work");
        expect(
            resolveAgentAccount(
                "claude",
                { type: "claude", account: "c-alt" },
                project,
                settings,
                emptyEnv,
            ).accountId,
        ).toBe("c-alt");
    });

    it("lets an explicit default option override a project account", () => {
        const resolved = resolveAgentAccount(
            "claude",
            { type: "claude", account: "default" },
            projectWith({ claude: "c-work" }),
            settingsWith({}),
            emptyEnv,
        );
        expect(resolved.accountId).toBe("default");
        expect(resolved.override).toBeNull();
    });

    it("resolves by id first, then by unique name", () => {
        const byName = resolveAgentAccount(
            "codex",
            { type: "codex", account: "work" },
            null,
            settingsWith({}),
            emptyEnv,
        );
        expect(byName).toEqual({
            accountId: "x-work",
            accountName: "work",
            override: "/homes/codex-work",
            effectiveHomeDir: "/homes/codex-work",
        });
    });

    it("ignores options that belong to another agent type", () => {
        const resolved = resolveAgentAccount(
            "codex",
            { type: "claude", account: "c-work" },
            null,
            settingsWith({}),
            emptyEnv,
        );
        expect(resolved.accountId).toBe("default");
    });

    it("throws naming the level for unknown accounts", () => {
        const settings = settingsWith({ claudeDefault: "gone" });
        expect(() =>
            resolveAgentAccount("claude", { type: "claude", account: "nope" }, null, settings),
        ).toThrow('Unknown Claude account "nope" (from launch options)');
        expect(() =>
            resolveAgentAccount("claude", undefined, projectWith({ claude: "nope" }), settings),
        ).toThrow('Unknown Claude account "nope" (from project)');
        expect(() => resolveAgentAccount("claude", undefined, null, settings)).toThrow(
            'Unknown Claude account "gone" (from global default)',
        );
    });
});

describe("resumeAccountOverride", () => {
    it("sets no variable when the saved home is the inherited home", () => {
        expect(resumeAccountOverride("codex", join(homedir(), ".codex"), emptyEnv)).toBeNull();
        expect(resumeAccountOverride("codex", undefined, emptyEnv)).toBeNull();
    });

    it("sets the saved home when it differs", () => {
        expect(resumeAccountOverride("codex", "/homes/codex-work", emptyEnv)).toBe(
            "/homes/codex-work",
        );
    });
});

describe("accountEnv", () => {
    it("maps overrides to the agent's variable", () => {
        expect(accountEnv("claude", "/h")).toEqual({ CLAUDE_CONFIG_DIR: "/h" });
        expect(accountEnv("codex", "/h")).toEqual({ CODEX_HOME: "/h" });
        expect(accountEnv("claude", null)).toEqual({});
    });
    it("exposes the inherited home", () => {
        expect(inheritedAgentHome("claude", { CLAUDE_CONFIG_DIR: "/x" })).toBe("/x");
    });
});

describe("headlessClaudeEnv", () => {
    it("strips nested-session markers and applies the project account", () => {
        const env = headlessClaudeEnv(settingsWith({}), projectWith({ claude: "c-work" }), {
            CLAUDECODE: "1",
            CLAUDE_CODE_ENTRYPOINT: "cli",
            HOME: "/Users/me",
        });
        expect(env.CLAUDECODE).toBeUndefined();
        expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
        expect(env.HOME).toBe("/Users/me");
        expect(env.CLAUDE_CONFIG_DIR).toBe("/homes/claude-work");
        expect(typeof env.PATH).toBe("string");
    });

    it("throws for an unknown account", () => {
        expect(() => headlessClaudeEnv(settingsWith({ claudeDefault: "gone" }), null, {})).toThrow(
            /Unknown Claude account/,
        );
    });
});

describe("mergeProjectAgentAccounts", () => {
    it("sets, pins default, and clears per agent", () => {
        expect(mergeProjectAgentAccounts(undefined, { claude: "c-work" })).toEqual({
            claude: "c-work",
        });
        expect(
            mergeProjectAgentAccounts({ claude: "c-work" }, { codex: "default", claude: null }),
        ).toEqual({ codex: "default" });
        expect(mergeProjectAgentAccounts({ claude: "c-work" }, { claude: null })).toBeUndefined();
    });

    it("rejects invalid shapes", () => {
        expect(() => mergeProjectAgentAccounts(undefined, "x")).toThrow();
        expect(() => mergeProjectAgentAccounts(undefined, { opencode: "a" })).toThrow();
        expect(() => mergeProjectAgentAccounts(undefined, { claude: 5 })).toThrow();
        expect(() => mergeProjectAgentAccounts(undefined, { claude: "  " })).toThrow();
        expect(() => mergeProjectAgentAccounts(undefined, { claude: "inherit" })).toThrow();
        expect(() => mergeProjectAgentAccounts(undefined, { claude: "Inherit" })).toThrow();
    });
});

describe("headlessAgentEnv", () => {
    it("claude: strips nested-session markers and applies the action's account first", () => {
        const env = headlessAgentEnv(
            "claude",
            { type: "claude", account: "c-alt" },
            settingsWith({}),
            projectWith({ claude: "c-work" }),
            { CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", HOME: "/Users/me" },
        );
        expect(env.CLAUDECODE).toBeUndefined();
        expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
        expect(env.HOME).toBe("/Users/me");
        expect(env.CLAUDE_CONFIG_DIR).toBe("/homes/claude-alt");
        expect(typeof env.PATH).toBe("string");
    });

    it("claude: falls back to the project's account", () => {
        const env = headlessAgentEnv(
            "claude",
            undefined,
            settingsWith({}),
            projectWith({ claude: "c-work" }),
            {},
        );
        expect(env.CLAUDE_CONFIG_DIR).toBe("/homes/claude-work");
    });

    it("kimi: disables auto-update and sets no account variables", () => {
        const env = headlessAgentEnv("kimi", undefined, settingsWith({}), null, {});
        expect(env.KIMI_CODE_NO_AUTO_UPDATE).toBe("1");
        expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
        expect(env.CODEX_HOME).toBeUndefined();
    });
    it("codex: applies the action's codex account", () => {
        const env = headlessAgentEnv(
            "codex",
            { type: "codex", account: "x-work" },
            settingsWith({}),
            null,
            {},
        );
        expect(env.CODEX_HOME).toBe("/homes/codex-work");
    });
});
