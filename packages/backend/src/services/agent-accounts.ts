import { homedir } from "os";
import { join } from "path";
import {
    ACCOUNT_AGENT_TYPES,
    AGENT_DISPLAY_NAMES,
    DEFAULT_AGENT_ACCOUNT_ID,
    INHERIT_AGENT_ACCOUNT,
    isAccountAgentType,
} from "@taskflow/shared";
import type {
    AccountAgentType,
    AgentLaunchOptions,
    AgentType,
    AppSettings,
    Project,
} from "@taskflow/shared";
import { buildShellPath } from "./shell-path";

type AgentEnv = Record<string, string | undefined>;

interface ResolvedAgentAccount {
    accountId: string;
    accountName: string | null;
    /** Value for the agent's home-dir variable; null means "set nothing". */
    override: string | null;
    /** Directory the CLI will actually use. */
    effectiveHomeDir: string;
}

const HOME_ENV_VAR: Record<AccountAgentType, string> = {
    claude: "CLAUDE_CONFIG_DIR",
    codex: "CODEX_HOME",
};

const NATIVE_HOME_DIR: Record<AccountAgentType, string> = {
    claude: ".claude",
    codex: ".codex",
};

function inheritedAgentHome(type: AccountAgentType, env: AgentEnv = process.env): string {
    return env[HOME_ENV_VAR[type]] || join(homedir(), NATIVE_HOME_DIR[type]);
}

function optionAccount(
    type: AccountAgentType,
    options: AgentLaunchOptions | undefined,
): string | undefined {
    if (options?.type !== "claude" && options?.type !== "codex") return undefined;
    return options.type === type ? options.account : undefined;
}

function resolveAgentAccount(
    type: AccountAgentType,
    options: AgentLaunchOptions | undefined,
    project: Project | null | undefined,
    settings: AppSettings,
    env: AgentEnv = process.env,
): ResolvedAgentAccount {
    const levels: Array<[source: string, ref: string | undefined]> = [
        ["launch options", optionAccount(type, options)],
        ["project", project?.agentAccounts?.[type]],
        ["global default", settings[type].defaultAccount],
    ];
    const [source, ref] = levels.find(([, value]) => value) ?? [
        "global default",
        DEFAULT_AGENT_ACCOUNT_ID,
    ];
    if (ref === undefined || ref === DEFAULT_AGENT_ACCOUNT_ID) {
        return {
            accountId: DEFAULT_AGENT_ACCOUNT_ID,
            accountName: null,
            override: null,
            effectiveHomeDir: inheritedAgentHome(type, env),
        };
    }
    const accounts = settings[type].accounts;
    const account =
        accounts.find((candidate) => candidate.id === ref) ??
        accounts.find((candidate) => candidate.name === ref);
    if (!account) {
        throw new Error(`Unknown ${AGENT_DISPLAY_NAMES[type]} account "${ref}" (from ${source})`);
    }
    return {
        accountId: account.id,
        accountName: account.name,
        override: account.homeDir,
        effectiveHomeDir: account.homeDir,
    };
}

function resumeAccountOverride(
    type: AccountAgentType,
    savedHomeDir: string | undefined,
    env: AgentEnv = process.env,
): string | null {
    return savedHomeDir && savedHomeDir !== inheritedAgentHome(type, env) ? savedHomeDir : null;
}

function accountEnv(type: AccountAgentType, override: string | null): Record<string, string> {
    return override ? { [HOME_ENV_VAR[type]]: override } : {};
}

/**
 * Env for one-shot headless agent runs: no nested-session markers, full PATH,
 * and for Claude/Codex the account home resolved launch options → project → global default.
 */
function headlessAgentEnv(
    type: AgentType,
    options: AgentLaunchOptions | undefined,
    settings: AppSettings,
    project: Project | null,
    env: AgentEnv = process.env,
): AgentEnv {
    const { CLAUDECODE: _a, CLAUDE_CODE_ENTRYPOINT: _b, ...cleanEnv } = env;
    const base: AgentEnv = { ...cleanEnv, PATH: buildShellPath() };
    if (isAccountAgentType(type)) {
        const { override } = resolveAgentAccount(type, options, project, settings, env);
        return { ...base, ...accountEnv(type, override) };
    }
    if (type === "kimi") return { ...base, KIMI_CODE_NO_AUTO_UPDATE: "1" };
    return base;
}

/**
 * Thrown for a malformed `agentAccounts` patch. The merge runs inside
 * `TaskStore.updateProject`'s mutation lock, so its callers need to tell a bad
 * request (400) apart from a failed write (500) after the fact.
 */
class InvalidAgentAccountsError extends Error {}

function mergeProjectAgentAccounts(
    current: Project["agentAccounts"],
    patch: unknown,
): Project["agentAccounts"] {
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
        throw new InvalidAgentAccountsError("agentAccounts must be an object");
    }
    const merged: Partial<Record<AccountAgentType, string | null>> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        if (!isAccountAgentType(key)) {
            throw new InvalidAgentAccountsError(`agentAccounts does not support agent "${key}"`);
        }
        if (value === null) {
            merged[key] = null;
        } else if (typeof value === "string" && value.trim()) {
            const trimmed = value.trim();
            if (trimmed.toLowerCase() === INHERIT_AGENT_ACCOUNT) {
                throw new InvalidAgentAccountsError(
                    `agentAccounts.${key} must not be "inherit"; send null to clear the override`,
                );
            }
            merged[key] = trimmed;
        } else {
            throw new InvalidAgentAccountsError(
                `agentAccounts.${key} must be a non-empty string or null`,
            );
        }
    }
    const next: NonNullable<Project["agentAccounts"]> = {};
    for (const type of ACCOUNT_AGENT_TYPES) {
        const value = merged[type];
        if (value) next[type] = value;
    }
    return Object.keys(next).length > 0 ? next : undefined;
}

export {
    InvalidAgentAccountsError,
    accountEnv,
    headlessAgentEnv,
    inheritedAgentHome,
    mergeProjectAgentAccounts,
    resolveAgentAccount,
    resumeAccountOverride,
};
